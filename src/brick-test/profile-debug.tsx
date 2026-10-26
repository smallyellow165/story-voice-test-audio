import {createRoot} from 'react-dom/client'
import {useEffect,useRef,useState} from 'react'
import {BrickViewer} from './viewer'
import {geometrySupport,PARTS} from './catalog'
import type {Connector} from './part-geometry'
import type {DebugScene,DebugInstance,DebugPose} from './profile-interaction'
import './profile-debug.css'
const base=import.meta.env.BASE_URL
const format=(v:number)=>Number(v.toFixed(3))
type Pick={id:string;face:'top'|'bottom';index:number;p:Connector}
const pickKey=(p:Pick)=>`${p.id}:${p.face}[${p.index}]`
function PoseInput({label,value,commit}:{label:string;value:number;commit(value:number):void}){
 const [draft,setDraft]=useState(String(format(value)))
 useEffect(()=>setDraft(String(format(value))),[value])
 return <input aria-label={label} inputMode="decimal" value={draft} onChange={e=>setDraft(e.target.value)} onBlur={()=>{const n=Number(draft);if(draft.trim()&&Number.isFinite(n))commit(n);else setDraft(String(format(value)))}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/>
}
function ProfileDebug(){
 const host=useRef<HTMLDivElement>(null),viewer=useRef<BrickViewer|null>(null),token=useRef(0),initial=useRef<DebugInstance[]>([])
 const [id,setId]=useState(new URL(location.href).searchParams.get('part')||'3437'),[kind,setKind]=useState(new URL(location.href).searchParams.get('kind')==='rebrickable'?'rebrickable':'ldraw'),[loaded,setLoaded]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [top,setTop]=useState(true),[bottom,setBottom]=useState(false),[picks,setPicks]=useState<Pick[]>([]),[view,setView]=useState('默认 3D')
 const [scene,setScene]=useState<DebugScene>({instances:[],selected:null,mode:'none'})
 const selected=scene.instances.find(p=>p.id===scene.selected),info=loaded.find(p=>p.id===scene.selected),capability=geometrySupport(info?.part||''),g=capability.supported?capability.geometry??undefined:undefined
 const picked=picks.at(-1)
 const world=(p:Pick)=>viewer.current?.getProfileWorldPoint(p.id,p.p)
 function pick(instanceId:string,face:'top'|'bottom',index:number,p:Connector){
  viewer.current?.selectProfileInstance(instanceId)
  setPicks(previous=>{const next={id:instanceId,face,index,p};if(previous.some(a=>pickKey(a)===pickKey(next)))return previous;return [...previous.filter(a=>a.id!==instanceId).slice(-1),next]})
 }
 async function load(){
  const request=++token.current;setBusy(true);setError('');setLoaded([]);setPicks([]);initial.current=[];viewer.current?.selectProfileInstance(null);viewer.current?.clearProfileMarkers();viewer.current?.reset();setScene({instances:[],selected:null,mode:'none'})
  try{
   const parts=id.split(',').map(p=>p.trim());if(parts.length>32||parts.some(p=>!/^[a-z0-9_-]{1,80}$/i.test(p)))throw Error('请输入 1–32 个有效 Part ID，使用英文逗号分隔；不能有空项。')
   const metadata=new Map(await Promise.all([...new Set(parts)].map(async part=>{const response=await fetch(`${base}brick-profile?part=${encodeURIComponent(part)}&kind=${kind}`),data=await response.json();if(!response.ok)throw Error(part+'：'+(data.error||data.inspection?.errors?.join('; ')||'加载失败'));return [part,data] as const})))
   if(request!==token.current)return
   const entries=parts.map((part,i)=>({...metadata.get(part),id:'instance-'+(i+1)})),poses=await viewer.current?.inspectInstances(entries)
   if(request!==token.current)return
   if(poses){initial.current=poses;setLoaded(entries);setView('默认 3D');const url=new URL(location.href);url.searchParams.set('part',parts.join(','));url.searchParams.set('kind',kind);history.replaceState(null,'',url)}
  }catch(e){if(request===token.current)setError(String(e))}finally{if(request===token.current)setBusy(false)}
 }
 useEffect(()=>{const engine=new BrickViewer(host.current!,`${base}brick-ldraw/`,setError);viewer.current=engine;engine.enableProfileEditing(setScene);void load();return()=>{++token.current;engine.dispose()}},[])
 useEffect(()=>{if(loaded.length)viewer.current?.showInstanceConnectors(top,bottom,picked?pickKey(picked):null,scene.selected,pick)},[loaded,top,bottom,picks,scene.selected])
 function camera(name:string,dir:{x:number;y:number;z:number}){setView(name);viewer.current?.fit(dir)}
 function pose(values:Partial<DebugPose>){if(selected)viewer.current?.setProfilePose(selected.id,{x:selected.x,y:selected.y,z:selected.z,rotation:selected.rotation,...values})}
 function resetAll(){viewer.current?.setProfileMode('none');for(const pose of initial.current)viewer.current?.setProfilePose(pose.id,pose);setPicks([]);camera('默认 3D',{x:1,y:.85,z:1.2})}
 const pair=picks.length===2?picks.map(p=>world(p)):null
 const delta=pair?.[0]&&pair[1]?{x:pair[1].x-pair[0].x,y:pair[1].y-pair[0].y,z:pair[1].z-pair[0].z}:null
 return <main className="profile-debug"><header><h1>Geometry Profile Debug Viewer</h1><a href={base+'brick-test.html'}>返回 Design Lab</a><p>临时场景 · 真实 DAT / 共享 Profile · 所有变换仅用于调试，不保存、不判断 Geometry Valid。</p></header>
 <form onSubmit={e=>{e.preventDefault();void load()}}><label>编号体系 <select aria-label="编号体系" value={kind} disabled={busy} onChange={e=>setKind(e.target.value)}><option value="ldraw">LDraw</option><option value="rebrickable">Rebrickable（正式直接 Mapping）</option></select></label><label>Part ID <input aria-label="Part ID" list="profile-parts" value={id} placeholder="3437,40666" disabled={busy} onChange={e=>setId(e.target.value)}/></label><datalist id="profile-parts">{PARTS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</datalist><button disabled={busy}>{busy?'加载中…':'加载零件'}</button><button type="button" disabled={!loaded.length} onClick={resetAll}>重置整个场景</button></form>
 {error&&<p role="alert">{error}</p>}
 <div className="profile-columns"><section><div className="profile-toolbar"><button onClick={()=>camera('默认 3D',{x:1,y:.85,z:1.2})}>重置 3D</button><button onClick={()=>camera('顶视：从世界 +Y 看向场景，屏幕上方为 −Z',{x:0,y:1,z:.00001})}>顶视图</button><button onClick={()=>camera('底视：从世界 −Y 看向场景，屏幕上方为 +Z',{x:0,y:-1,z:.00001})}>底视图</button><button onClick={()=>camera('正面：从世界 +Z 看向场景，+Y 向上',{x:0,y:0,z:1})}>正面</button></div>
 <div className="profile-help" aria-label="鼠标与快捷键"><strong>鼠标与快捷键</strong> · 左键拖拽：旋转镜头 · 滚轮：缩放 · 右键拖拽：平移镜头<br/>点击积木：选择 · Shift + 左键拖拽：移动积木（世界 X/Z） · G：精细移动（X/Y/Z） · R：旋转（世界 Y） · Esc：取消选择 / 退出模式<br/><small>点击画布获得快捷键焦点；输入框中不响应。控制柄操作时相机暂停。Connector 标签可点击。</small></div>
 <p data-testid="interaction-mode">{scene.mode==='translate'?'G · 精细移动 X/Y/Z':scene.mode==='rotate'?'R · 绕世界 Y 旋转':'浏览 / 选择'} · {selected?`${selected.id} / ${selected.part}`:'未选中'} · {loaded.length} 个实例</p>
 <p data-testid="view-direction">{view} · 视角变化不改变编号</p><div ref={host} className="profile-canvas"/><p>坐标轴属于当前选中实例：X 红 / Y 绿 / Z 蓝。场景变换采用世界 X/Y/Z；模型保持真实原色，蓝框表示选择。</p></section>
 <aside>
 {!!loaded.length&&<><label>当前实例 <select aria-label="当前实例" value={scene.selected??''} onChange={e=>viewer.current?.selectProfileInstance(e.target.value||null)}><option value="">未选中</option>{loaded.map(row=><option key={row.id} value={row.id}>{row.id} · {row.inputId} → {row.part}</option>)}</select></label>
 <label><input type="checkbox" checked={top} onChange={e=>setTop(e.target.checked)}/>显示 Top Stud</label><label><input type="checkbox" checked={bottom} onChange={e=>setBottom(e.target.checked)}/>显示 Bottom Socket</label><p>Top：Stud 接合位置；Bottom：逻辑接合位置，<strong>不是实体 Tube 数量或中心</strong>。标记显示在模型前方，不证明接合或碰撞。</p></>}
 {selected&&info&&<><h2>{info.id} · {info.inputId} → {info.part}.dat</h2>
 <section className="profile-pose" data-testid="instance-pose"><h3>世界位置 LDU / Y 旋转（度）</h3><p className="pose-hint">数值输入后按 Enter 或移开焦点应用。</p>{(['x','y','z','rotation'] as const).map(axis=><label key={selected.id+axis}>{axis==='rotation'?'Y 旋转':axis.toUpperCase()} <PoseInput label={'实例 '+axis} value={selected[axis]} commit={value=>pose({[axis]:value})}/></label>)}
 <button onClick={()=>viewer.current?.setProfileMode('translate')}>G · 移动控制柄</button><button onClick={()=>viewer.current?.setProfileMode('rotate')}>R · 旋转控制柄</button><button onClick={()=>{const p=initial.current.find(p=>p.id===selected.id);if(p)viewer.current?.setProfilePose(p.id,p)}}>重置选中零件</button></section>
 <p data-testid="profile-status">{g?'已审核共享 Geometry Profile':'Unsupported：仅显示 DAT，接口信息不可用'}</p><p>{g?'本地坐标：砖体底部中心原点，+Y 向上，单位 LDU。':'本地原始 LDraw 入口原点，+Y 向下；显示 Rx(π)，不推断接口。'}</p><p>DAT：parts/{info.part}.dat · 完整依赖 {info.inspection.checkedFiles} 文件</p>
 <details><summary>Mapping 来源 / MOVED 与引用证据</summary><pre>{JSON.stringify({mapping:info.mapping,entryReferences:info.inspection.entryReferences,transform:g?.ldraw??'Raw LDraw Rx(π), no profile offset'},null,2)}</pre></details>
 </>}
 {picked&&<section data-testid="connector-detail"><h3>{picked.id} · {picked.face}[{picked.index}]</h3><p>Part ID：{loaded.find(r=>r.id===picked.id)?.part}</p><p>本地 LDU：({picked.p.x}, {picked.p.y}, {picked.p.z})</p><p>当前世界 LDU：{JSON.stringify(world(picked),(_k,v)=>typeof v==='number'?format(v):v)}</p><p>方向：{picked.p.direction}（本地） · 类型：{picked.p.type} · {picked.face==='bottom'?'逻辑接合位置（非 Tube 中心）':'顶部 Stud 接合面'}</p></section>}
 {!!picks.length&&<section data-testid="connector-pair"><h3>Connector Pair 测量</h3><p>依次点击不同实例的 Connector；同一实例的新选择会替换旧点。</p>{picks.map(p=><p key={pickKey(p)}>{p.id} · {p.face}[{p.index}]<br/>世界 LDU：{JSON.stringify(world(p),(_k,v)=>typeof v==='number'?format(v):v)}</p>)}{delta&&<p data-testid="pair-distance">第二点 − 第一点：X {format(delta.x)} / Y {format(delta.y)} / Z {format(delta.z)} LDU<br/>三维距离：{format(Math.hypot(delta.x,delta.y,delta.z))} LDU</p>}<p>仅测量距离；距离为零也不代表接口兼容、无碰撞或 Geometry Valid。</p><button onClick={()=>setPicks([])}>清除 Connector 选择</button></section>}
 {selected&&info&&<> {g&&(['top','bottom'] as const).map(face=><details key={face} open><summary>{face} · {g[face].length} 个接口</summary><table><thead><tr><th>编号</th><th>X</th><th>Y</th><th>Z</th></tr></thead><tbody>{g[face].map((p,index)=><tr key={index}><td><button onClick={()=>{if(face==='top')setTop(true);else setBottom(true);pick(selected.id,face,index,p)}}>{face}[{index}]</button></td><td>{p.x}</td><td>{p.y}</td><td>{p.z}</td></tr>)}</tbody></table></details>)}
 <details><summary>Profile 原始数据</summary><pre>{JSON.stringify(g??null,null,2)}</pre></details></>}
 </aside></div></main>
}
const root=createRoot(document.getElementById('profile-debug-root')!);root.render(<ProfileDebug/>);if(import.meta.hot)import.meta.hot.dispose(()=>root.unmount())
