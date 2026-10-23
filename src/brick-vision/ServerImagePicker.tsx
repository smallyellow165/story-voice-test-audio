import { useEffect, useRef, useState } from 'react'
import { requestJson } from '../brick-inventory/api.mjs'
import { prepareInventoryImage } from './upload'

export type PreparedSourceImage = Awaited<ReturnType<typeof prepareInventoryImage>> & {
  imageReference: { kind: 'server_library' | 'upload'; name: string }
}
type LibraryImage = { name: string; url: string }
// Shared by Reverse Assembly and Inventory. Only prepares an image; never calls a model.
export function ServerImagePicker({ disabled = false, onChange, onBusy }: {
  disabled?: boolean; onChange(image: PreparedSourceImage | null): void; onBusy(busy: boolean): void
}) {
  const [source, setSource] = useState<'server_library' | 'upload'>('server_library')
  const [images, setImages] = useState<LibraryImage[]>([]), [selected, setSelected] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const gate = useRef(false), mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    void requestJson<{ images: LibraryImage[] }>('/api/test-images', { signal: controller.signal }, '测试图片目录').then(value => {
      if (!controller.signal.aborted) setImages(value.images)
    }).catch(e => { if (!controller.signal.aborted) setError(String(e)) })
    return () => { mounted.current = false; controller.abort() }
  }, [])
  async function choose(file: File | null, item?: LibraryImage) {
    if (gate.current || disabled) return
    gate.current = true; setBusy(true); onBusy(true); setError(''); onChange(null)
    try {
      if (item) {
        const response = await fetch(item.url, { signal: AbortSignal.timeout(30000) })
        if (!response.ok) throw new Error('测试图片读取失败：' + response.status)
        const blob = await response.blob()
        file = new File([blob], item.name, { type: blob.type })
      }
      if (file) {
        const image = await prepareInventoryImage(file)
        if (mounted.current) onChange({ ...image, imageReference: { kind: item ? 'server_library' : 'upload', name: file.name } })
      }
    } catch (e) { if (mounted.current) setError(String(e)) }
    finally { gate.current = false; if (mounted.current) { setBusy(false); onBusy(false) } }
  }
  return <div className="server-image-picker">
    <label>Image Source<select disabled={disabled || busy} value={source} onChange={e => {
      setSource(e.target.value as typeof source); setSelected(''); setError(''); onChange(null)
    }}><option value="server_library">Server Library</option><option value="upload">Upload</option></select></label>
    {source === 'server_library' ? <label>Server Image<select value={selected} disabled={disabled || busy} onChange={e => {
      const name = e.target.value; setSelected(name)
      void choose(null, images.find(i => i.name === name))
    }}><option value="">请选择测试图片</option>{images.map(i => <option key={i.name} value={i.name}>{i.name}</option>)}</select></label>
      : <label>本地图片<input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy}
        onChange={e => { void choose(e.target.files?.[0] || null) }} /></label>}
    {source === 'server_library' && !images.length && !error && <small>public/test-images/ 中没有可选图片。</small>}
    {busy && <small>读取并准备预览…</small>}
    {error && <p role="alert">{error}</p>}
  </div>
}
