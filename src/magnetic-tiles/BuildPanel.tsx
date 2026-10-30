import { workflowTerms } from './studio-terms.ts'
import { InfoHint } from '../brick-vision/InfoHint.tsx'
import { readStudioUrl, useUrlRequest, writeStudioUrl } from './studio-url.ts'
import { AssemblyPreview } from './AssemblyPreview.tsx'
import { assemblySaveStatus, sameAssemblyContents } from './assembly-source.ts'
import { StudioSlot, useStudio } from './StudioLayout.tsx'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BuildPlayer } from './BuildPlayer.tsx'
import { contentHash, generateBuild } from './build-plan.ts'
import type { BuildProgress } from './build-plan.ts'
import { BUILD_KEY, bundleFor, emptyLibrary, loadLibrary, saveLibrary, storeBundle } from './build-storage.ts'
import type { BuildLibrary } from './build-storage.ts'
import type { Assembly, Profile } from './geometry.ts'
import { checkArtwork, modeLabel, workMode } from './artwork.ts'
function download(value: string, name: string) {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function BuildPanel({ assembly, savedAssemblies, workspaceError, profiles, dragging }: { assembly: Assembly; savedAssemblies: readonly Assembly[]; workspaceError: string; profiles: readonly Profile[]; dragging: boolean }) {
  const {stage,navigate}=useStudio()
  const urlRequest=useUrlRequest()
  const [loaded,setLoaded]=useState(false)
  const previousStage=useRef(stage), initialAssembly=useRef(assembly), firstEntry=useRef(true)
  const [viewer,setViewer]=useState<'source'|'tutorial'>('tutorial')
  const [sourceId,setSourceId]=useState('current')
  useLayoutEffect(()=>{
    if(stage==='build'&&previousStage.current==='assembly'&&!readStudioUrl(location.href).values.buildId){
      setSourceId('current')
      // Initial entry can restore the persisted active tutorial. Subsequent
      // returns from the editor explicitly preview the current work.
      if(!firstEntry.current||assembly!==initialAssembly.current){setViewer('source');writeStudioUrl({buildId:undefined})}
      firstEntry.current=false
    }
    previousStage.current=stage
  },[stage,assembly])
  // Saved sources are read directly for generation; selecting them never loads
  // over the live editor or touches its undo stack.
  const source=sourceId==='current'?assembly:savedAssemblies.find(a=>a.id===sourceId.slice(6))
  const [library, setLibrary] = useState<BuildLibrary>(emptyLibrary)
  const [busy, setBusy] = useState(true), [blocked, setBlocked] = useState(false), [notice, setNotice] = useState('正在恢复教程…'), [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  // Registry is loaded before mount and only appends immutable versions.
  // An addition must not reload the tutorial or reset its in-memory selection.
  const bootProfiles=useRef(profiles)
  const lock = useRef(true), file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let alive = true
    loadLibrary(localStorage, bootProfiles.current).then(l => { if (alive) { setLibrary(l); setSelectedId(l.plans[0]?.id ?? ''); setNotice('预览与已保存教程分别管理；修改画布不会改变教程。') } }).catch(e => { if (alive) { setBlocked(true); setError(`无法恢复教程，原存档未覆盖：${String(e)}`) } }).finally(() => { if (alive) { lock.current = false; setBusy(false);setLoaded(true) } })
    return () => { alive = false }
  }, [])
  useEffect(()=>{
    if(!loaded)return
    const {values:v,errors}=readStudioUrl(urlRequest.href)
    if(errors.length)return
    if(!v.buildId){setBusy(false);if(urlRequest.sequence>0)setViewer('source');return}
    if(!library.plans.some(p=>p.id===v.buildId)){setViewer('source');setError('URL 教程不存在于当前浏览器已保存教程中：'+v.buildId);return}
    let alive=true
    setBusy(true);lock.current=true
    // Restore from existing snapshots/progress without writing a different active
    // plan into storage while a newer Back/Forward request may be in flight.
    void activate(structuredClone(library),v.buildId).then(next=>{if(alive){setLibrary(next);setSelectedId(v.buildId);setViewer('tutorial');setError('');setNotice('已按 URL 恢复保存教程及其播放进度。')}}).catch(e=>{if(alive)setError('URL 教程恢复失败：'+String(e))}).finally(()=>{if(alive){setBusy(false);lock.current=false}})
    return()=>{alive=false;lock.current=false}

  },[loaded,urlRequest])
  async function run(action: () => Promise<BuildLibrary>, message: string, showTutorial = false) {
    if (lock.current || blocked) return
    lock.current = true; setBusy(true); setError('')
    try { const next = await saveLibrary(localStorage, await action(), profiles); setLibrary(next); setSelectedId(next.plans.some(p => p.id === next.activeId) ? next.activeId! : next.plans[0]?.id ?? ''); setNotice(message); if(showTutorial)setViewer('tutorial'); if(showTutorial||viewer==='tutorial')writeStudioUrl({buildId:next.plans.some(p=>p.id===next.activeId)?next.activeId??undefined:undefined}) }
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
  const playing=viewer==='tutorial'&&!!bundle&&!!progress
  const disabled = busy || blocked
  return <><StudioSlot column="inspector" stages={['build']}>
    <section className="build-source" aria-label="生成教程的作品来源">
      <h2>{workflowTerms.build.label}</h2>
      <label className="compact-field">教程来源作品<select aria-label="教程来源作品" value={sourceId} disabled={disabled || dragging} onChange={e=>{setSourceId(e.target.value);setViewer('source');writeStudioUrl({buildId:undefined})}}>
        <option value="current">使用当前作品 · {assembly.name}</option>
        <optgroup label="已保存作品">{savedAssemblies.map(a=><option key={a.id} value={`saved:${a.id}`}>{a.name} · {a.instances.length} 块 · revision {a.revision}</option>)}</optgroup>
      </select></label>
      {source?<><div className="context-notice-row"><p className="context-notice" title={`${source.name} · ${source.instances.length} 块 · ${modeLabel(workMode(source))}`}>{source.name} · {source.instances.length} 块 · {modeLabel(workMode(source))}</p><InfoHint label="搭建教程来源"><p>来源 ID {source.id} · revision {source.revision}</p><p>当前有效草稿无需先保存作品，也可生成预览。保存教程会固定独立来源快照；旧教程及播放进度保持不变。</p>{sourceId!=='current'&&<p>所选保存快照不会覆盖作品编辑中的未保存修改。{assembly.id===source.id&&!sameAssemblyContents(assembly,source)?'编辑器中的同名作品已有不同内容。':''}</p>}</InfoHint></div>
      <p className="context-notice" data-testid="build-source-status" title={sourceId==='current'?assemblySaveStatus(assembly,savedAssemblies):'已保存作品快照 · 使用保存时的内容'}>{sourceId==='current'?assemblySaveStatus(assembly,savedAssemblies):'已保存作品快照 · 使用保存时的内容'}</p>
      </>:<p role="alert">所选作品已不可用，请重新选择来源。</p>}
      {workspaceError&&<p role="alert" className="storage-error">作品存储有错误，不能确认当前内容已写入浏览器：{workspaceError}</p>}
      <button onClick={()=>navigate('assembly')}>返回作品编辑（Assembly）</button>
    </section></StudioSlot>
    <StudioSlot column="inspector" stages={['build']}><section className="tiles-panel build-panel" aria-label="搭建教程（Build）">
    {!playing&&<p>作品预览 · 尚未生成教程。点击生成后开始分步骤搭建。</p>}
    {!playing&&bundle&&<button disabled={disabled} onClick={()=>{setViewer('tutorial');writeStudioUrl({buildId:library.plans.some(p=>p.id===library.activeId)?library.activeId??undefined:undefined})}}>继续上次教程</button>}
    <div className="button-row"><button className="primary" disabled={disabled || dragging || !source || !checkArtwork(source, profiles).ready} onClick={() => void run(async () => {
      const b = await generateBuild(source!, profiles), l = structuredClone(library)
      if (l.preview) delete l.progress[l.preview.plan.id]
      l.preview = b
      return activate(l, b.plan.id)
    }, '已生成预览，尚未加入已保存教程。预览及播放进度会在刷新后恢复。', true)}>生成搭建步骤</button>
    <button disabled={disabled || !playing || !bundle || !library.preview || bundle.plan.id !== library.preview.plan.id} onClick={() => void run(() => storeBundle(library, bundle, profiles), '教程已保存，来源快照已固定。')}>保存教程</button>
    <button disabled={disabled || !playing || !bundle} onClick={() => download(JSON.stringify(bundle, null, 2), 'magnetic-tiles-build.json')}>导出教程 JSON</button>
    <button disabled={disabled} onClick={() => file.current?.click()}>导入教程 JSON</button><input ref={file} data-testid="build-import" type="file" accept=".json,application/json" hidden onChange={e => {
      const f = e.target.files?.[0]; e.target.value = ''
      if (f) void run(async () => { if (f.size > 1_000_000) throw Error('文件超过 1 MB'); const l = await storeBundle(library, JSON.parse(await f.text()), profiles); return activate(l, l.activeId!) }, '已验证并保存导入教程，可以重播。', true)
    }}/></div>
    {(!source || !checkArtwork(source, profiles).ready) && <p className="hint">所选来源作品需要非空、几何合法并满足所选作品模式，才能生成教程。已有教程仍可播放。</p>}
    <div className="build-saved"><label>已保存教程<select value={selectedId} onChange={e => setSelectedId(e.target.value)}><option value="">选择教程</option>{library.plans.map(p => <option key={p.id} value={p.id}>{p.title} · {p.steps.length} 步 · {p.id.slice(0, 8)}</option>)}</select></label><button disabled={disabled || !selectedId} onClick={() => void run(() => activate(structuredClone(library), selectedId), '已打开保存教程并恢复播放进度。', true)}>打开教程</button></div>
    <p className="build-notice" aria-live="polite">{notice}</p>{error && <p className="storage-error" role="alert">{error}</p>}
    {blocked && <div className="button-row"><button onClick={() => download(localStorage.getItem(BUILD_KEY) ?? '', 'magnetic-tiles-build-recovery.json')}>备份无法读取的教程存档</button><button onClick={async () => {
      if (!confirm('只重置 Build 教程存档？已保存教程及其进度将被清除；原 Assembly 工作区不受影响。')) return
      try { await saveLibrary(localStorage, emptyLibrary(), profiles); setLibrary(emptyLibrary()); setBlocked(false); setError(''); setNotice('教程存档已重置。') } catch (e) { setError(String(e)) }
    }}>重置教程存档</button></div>}
    {playing && bundle && progress && <><p className="hint" data-testid="build-playback-source"><b>当前播放教程的固定来源</b><br/>{bundle.snapshot.assembly.name} · {bundle.snapshot.assembly.instances.length} 块 · {modeLabel(workMode(bundle.snapshot.assembly))}<br/>{library.preview?.plan.id === bundle.plan.id ? '未保存预览' : '已保存教程'} · 方案版本 {bundle.plan.revision} · 来源 ID {bundle.snapshot.assembly.id} / revision {bundle.snapshot.assembly.revision} · Hash {bundle.snapshot.hash.slice(0, 12)}</p></>}
  </section></StudioSlot><StudioSlot column="workspace" stages={['build']}>{playing && bundle && progress ? <BuildPlayer key={bundle.plan.id} bundle={bundle} progress={progress} profiles={profiles} disabled={disabled} onProgress={(p: BuildProgress) => void run(async () => ({ ...library, progress: { ...library.progress, [bundle.plan.id]: p } }), p.completed ? '已记录完成；这不会自动判断实物搭建。' : '播放进度已保存。')}/> : <section aria-label="Build 作品预览"><h3>作品预览 · 尚未生成教程</h3>{source?<><p>{source.name} · {source.instances.length} 块 · {modeLabel(workMode(source))}</p><AssemblyPreview assembly={source} profiles={profiles} className="build-board"/>{!source.instances.length&&<p>当前作品为空，请先在作品编辑器中添加磁力片。</p>}</>:<p>请在右栏 Inspector 选择教程来源作品。</p>}</section>}</StudioSlot></>
}
