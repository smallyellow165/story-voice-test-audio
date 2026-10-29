import { useEffect, useRef, useState } from 'react'
import { BuildPlayer } from './BuildPlayer.tsx'
import { contentHash, generateBuild } from './build-plan.ts'
import type { BuildProgress } from './build-plan.ts'
import { BUILD_KEY, bundleFor, emptyLibrary, loadLibrary, saveLibrary, storeBundle } from './build-storage.ts'
import type { BuildLibrary } from './build-storage.ts'
import type { Assembly, Profile } from './geometry.ts'
import { validate } from './geometry.ts'
function download(value: string, name: string) {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function BuildPanel({ assembly, profiles, dragging }: { assembly: Assembly; profiles: readonly Profile[]; dragging: boolean }) {
  const [library, setLibrary] = useState<BuildLibrary>(emptyLibrary)
  const [busy, setBusy] = useState(true), [blocked, setBlocked] = useState(false), [notice, setNotice] = useState('正在恢复教程…'), [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const lock = useRef(true), file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let alive = true
    loadLibrary(localStorage, profiles).then(l => { if (alive) { setLibrary(l); setSelectedId(l.plans[0]?.id ?? ''); setNotice('预览与已保存教程分别管理；修改画布不会改变教程。') } }).catch(e => { if (alive) { setBlocked(true); setError(`无法恢复教程，原存档未覆盖：${String(e)}`) } }).finally(() => { if (alive) { lock.current = false; setBusy(false) } })
    return () => { alive = false }
  }, [profiles])
  async function run(action: () => Promise<BuildLibrary>, message: string) {
    if (lock.current || blocked) return
    lock.current = true; setBusy(true); setError('')
    try { const next = await saveLibrary(localStorage, await action(), profiles); setLibrary(next); setSelectedId(next.plans.some(p => p.id === next.activeId) ? next.activeId! : next.plans[0]?.id ?? ''); setNotice(message) }
    catch (e) { setError(`操作未保存，原教程保留：${String(e)}`) }
    finally { lock.current = false; setBusy(false) }
  }
  const bundle = bundleFor(library, library.activeId)
  const progress = bundle ? library.progress[bundle.plan.id] : null
  async function activate(l: BuildLibrary, id: string) {
    const b = bundleFor(l, id)!
    if (!l.progress[id]) l.progress[id] = { planHash: await contentHash(b.plan), step: 0, completed: false }
    l.activeId = id
    return l
  }
  const disabled = busy || blocked
  return <section className="tiles-panel build-panel" aria-label="Build Steps">
    <h2>一片一片搭 · Build Steps</h2>
    <p>把当前作品变成教程。先预览，满意后保存；原画布仍可继续编辑。</p>
    <div className="button-row"><button className="primary" disabled={disabled || dragging || !validate(assembly.instances, profiles).valid} onClick={() => void run(async () => {
      const b = await generateBuild(assembly, profiles), l = structuredClone(library)
      if (l.preview) delete l.progress[l.preview.plan.id]
      l.preview = b
      return activate(l, b.plan.id)
    }, '已生成预览，尚未加入已保存教程。预览及播放进度会在刷新后恢复。')}>生成搭建步骤</button>
    <button disabled={disabled || !bundle || !library.preview || bundle.plan.id !== library.preview.plan.id} onClick={() => void run(() => storeBundle(library, bundle, profiles), '教程已保存，来源快照已固定。')}>保存教程</button>
    <button disabled={disabled || !bundle} onClick={() => download(JSON.stringify(bundle, null, 2), 'magnetic-tiles-build.json')}>导出教程 JSON</button>
    <button disabled={disabled} onClick={() => file.current?.click()}>导入教程 JSON</button><input ref={file} data-testid="build-import" type="file" accept=".json,application/json" hidden onChange={e => {
      const f = e.target.files?.[0]; e.target.value = ''
      if (f) void run(async () => { if (f.size > 1_000_000) throw Error('文件超过 1 MB'); const l = await storeBundle(library, JSON.parse(await f.text()), profiles); return activate(l, l.activeId!) }, '已验证并保存导入教程，可以重播。')
    }}/></div>
    {!validate(assembly.instances, profiles).valid && <p className="hint">当前画布需要非空、几何合法且整体连通，才能生成教程。已有教程仍可播放。</p>}
    <div className="build-saved"><label>已保存教程<select value={selectedId} onChange={e => setSelectedId(e.target.value)}><option value="">选择教程</option>{library.plans.map(p => <option key={p.id} value={p.id}>{p.title} · {p.steps.length} 步 · {p.id.slice(0, 8)}</option>)}</select></label><button disabled={disabled || !selectedId} onClick={() => void run(() => activate(structuredClone(library), selectedId), '已打开保存教程并恢复播放进度。')}>打开教程</button></div>
    <p className="build-notice" aria-live="polite">{notice}</p>{error && <p className="storage-error" role="alert">{error}</p>}
    {blocked && <div className="button-row"><button onClick={() => download(localStorage.getItem(BUILD_KEY) ?? '', 'magnetic-tiles-build-recovery.json')}>备份无法读取的教程存档</button><button onClick={async () => {
      if (!confirm('只重置 Build 教程存档？已保存教程及其进度将被清除；原 Assembly 工作区不受影响。')) return
      try { await saveLibrary(localStorage, emptyLibrary(), profiles); setLibrary(emptyLibrary()); setBlocked(false); setError(''); setNotice('教程存档已重置。') } catch (e) { setError(String(e)) }
    }}>重置教程存档</button></div>}
    {bundle && progress && <><p className="hint">{library.preview?.plan.id === bundle.plan.id ? '未保存预览' : '已保存教程'} · 方案版本 {bundle.plan.revision} · 来源 {bundle.snapshot.assembly.name} / revision {bundle.snapshot.assembly.revision} · Hash {bundle.snapshot.hash.slice(0, 12)}</p><BuildPlayer key={bundle.plan.id} bundle={bundle} progress={progress} profiles={profiles} disabled={disabled} onProgress={(p: BuildProgress) => void run(async () => ({ ...library, progress: { ...library.progress, [bundle.plan.id]: p } }), p.completed ? '已记录完成；这不会自动判断实物搭建。' : '播放进度已保存。')}/></>}
  </section>
}
