import { useEffect, useRef, useState } from 'react'
import { requestJson } from '../brick-inventory/api.mjs'
import { prepareInventoryImage } from './upload'
import type { ExplorerScene, SceneImageSelection } from '../brick-inventory/explorer-scene.mjs'

export type PreparedSourceImage = Awaited<ReturnType<typeof prepareInventoryImage>> & {
  imageReference: { kind: 'server_library' | 'upload'; name: string }
}
type LibraryImage = { name: string; url: string }
// Shared by Reverse Assembly and Inventory. Only prepares an image; never calls a model.
export function ServerImagePicker({ disabled = false, onChange, onBusy, initialScene, restoredSelection, onSelectionChange, onReady }: {
  disabled?: boolean; onChange(image: PreparedSourceImage | null): void; onBusy(busy: boolean): void
  initialScene?: ExplorerScene; restoredSelection?: SceneImageSelection
  onSelectionChange?(selection: SceneImageSelection): void; onReady?(): void
}) {
  const [source, setSource] = useState<'server_library' | 'upload'>(() => initialScene?.imageSource || 'server_library')
  const [images, setImages] = useState<LibraryImage[]>([]), [selected, setSelected] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const gate = useRef(false), mounted = useRef(true)
  const initialApplied = useRef(false)
  const [listReady, setListReady] = useState(false)
  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    void requestJson<{ images: LibraryImage[] }>('/api/test-images', { signal: controller.signal }, '测试图片目录').then(value => {
      if (!controller.signal.aborted) setImages(value.images)
    }).catch(e => { if (!controller.signal.aborted) setError(String(e)) })
      .finally(() => { if (!controller.signal.aborted) setListReady(true) })
    return () => { mounted.current = false; controller.abort() }
  }, [])
  useEffect(() => {
    if (!listReady || disabled || initialApplied.current) return
    initialApplied.current = true
    const name = initialScene?.image
    if (name && source === 'server_library') {
      const item = images.find(image => image.name === name)
      if (!item) { setError('URL 图片不在服务器测试图片列表中；请手动选择。'); onReady?.(); return }
      setSelected(item.name); onSelectionChange?.({ source, name: item.name })
      void choose(null, item).finally(() => { if (mounted.current) onReady?.() })
    } else {
      onSelectionChange?.({ source, name: '' }); onReady?.()
    }
  }, [listReady, disabled])
  useEffect(() => {
    if (!restoredSelection) return
    // Restore the controls only: the history loader owns its saved image bytes.
    setSource(restoredSelection.source); setSelected(restoredSelection.name)
    onSelectionChange?.(restoredSelection)
  }, [restoredSelection?.source, restoredSelection?.name])
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
    <label>Image Source<select disabled={disabled || busy || !listReady} value={source} onChange={e => {
      setSource(e.target.value as typeof source); setSelected(''); setError(''); onChange(null)
      onSelectionChange?.({ source: e.target.value as typeof source, name: '' })
    }}><option value="server_library">Server Library</option><option value="upload">Upload</option></select></label>
    {source === 'server_library' ? <label>Server Image<select value={selected} disabled={disabled || busy || !listReady} onChange={e => {
      const name = e.target.value; setSelected(name)
      onSelectionChange?.({ source, name })
      void choose(null, images.find(i => i.name === name))
    }}><option value="">请选择测试图片</option>{selected && !images.some(i => i.name === selected) && <option value={selected}>{selected}（历史引用）</option>}{images.map(i => <option key={i.name} value={i.name}>{i.name}</option>)}</select></label>
      : <label>本地图片<input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy || !listReady}
        onChange={e => { setSelected(e.target.files?.[0]?.name || ''); onSelectionChange?.({ source, name: e.target.files?.[0]?.name || '' }); void choose(e.target.files?.[0] || null) }} /></label>}
    {source === 'upload' && selected && <small>图片引用：{selected}；历史预览使用已保存原图，本地文件需手动选择。</small>}
    {source === 'server_library' && !images.length && !error && <small>public/test-images/ 中没有可选图片。</small>}
    {busy && <small>读取并准备预览…</small>}
    {error && <p role="alert">{error}</p>}
  </div>
}
