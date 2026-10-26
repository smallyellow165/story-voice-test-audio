import {createRoot} from 'react-dom/client'
import {useEffect,useRef,useState} from 'react'
import {BrickViewer} from './viewer'
import {geometrySupport,PARTS} from './catalog'
import type {Connector} from './part-geometry'
import './profile-debug.css'
const base=import.meta.env.BASE_URL
function ProfileDebug(){
 const host=useRef<HTMLDivElement>(null),viewer=useRef<BrickViewer|null>(null),token=useRef(0)
 const [id,setId]=useState(new URL(location.href).searchParams.get('part')||'3437'),[kind,setKind]=useState(new URL(location.href).searchParams.get('kind')==='rebrickable'?'rebrickable':'ldraw'),[loaded,setLoaded]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [top,setTop]=useState(true),[bottom,setBottom]=useState(false),[picked,setPicked]=useState<{face:'top'|'bottom';index:number;p:Connector}|null>(null),[view,setView]=useState('默认 3D')
 const capability=geometrySupport(loaded?.part||''),g=capability.supported?capability.geometry??undefined:undefined
 async function load(){
  const request=++token.current;setBusy(true);setError('');setLoaded(null);setPicked(null);viewer.current?.clearProfileMarkers();viewer.current?.reset()
  try{const response=await fetch(`${base}brick-profile?part=${encodeURIComponent(id)}&kind=${kind}`),data=await response.json();if(!response.ok)throw Error(data.error||data.inspection?.errors?.join('; ')||'加载失败')
   if(request!==token.current)return
   if(await viewer.current?.inspectPart(data.part)){setLoaded(data);setView('默认 3D');const url=new URL(location.href);url.searchParams.set('part',id);url.searchParams.set('kind',kind);history.replaceState(null,'',url)}
  }catch(e){if(request===token.current)setError(String(e))}finally{if(request===token.current)setBusy(false)}
 }
 useEffect(()=>{const engine=new BrickViewer(host.current!,`${base}brick-ldraw/`,setError);viewer.current=engine;void load();return()=>{++token.current;engine.dispose()}},[])
 useEffect(()=>{if(loaded)viewer.current?.showProfileMarkers(g,top,bottom,picked?`${picked.face}[${picked.index}]`:null,(face,index,p)=>setPicked({face,index,p}))},[loaded,top,bottom,picked])
 function camera(name:string,dir:{x:number;y:number;z:number}){setView(name);viewer.current?.fit(g?dir:{x:dir.x,y:-dir.y,z:-dir.z})}
 return <main className="profile-debug"><header><h1>Geometry Profile Debug Viewer</h1><a href={base+'brick-test.html'}>返回 Design Lab</a><p>只读 · 真实 DAT / 共享 Profile · 标记显示在模型前方，不代表可见性或碰撞。</p></header>
 <form onSubmit={e=>{e.preventDefault();void load()}}><label>编号体系 <select aria-label="编号体系" value={kind} disabled={busy} onChange={e=>setKind(e.target.value)}><option value="ldraw">LDraw</option><option value="rebrickable">Rebrickable（正式直接 Mapping）</option></select></label><label>Part ID <input aria-label="Part ID" list="profile-parts" value={id} disabled={busy} onChange={e=>setId(e.target.value)}/></label><datalist id="profile-parts">{PARTS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</datalist><button disabled={busy}>{busy?'加载中…':'加载零件'}</button></form>
 {error&&<p role="alert">{error}</p>}
 <div className="profile-columns"><section><div className="profile-toolbar"><button onClick={()=>camera('默认 3D',{x:1,y:.85,z:1.2})}>重置 3D</button><button onClick={()=>camera('顶视：从 +Y 看向原点，屏幕上方为 −Z',{x:0,y:1,z:.00001})}>顶视图</button><button onClick={()=>camera('底视：从 −Y 看向原点，屏幕上方为 +Z',{x:0,y:-1,z:.00001})}>底视图</button><button onClick={()=>camera('正面：从 +Z 看向原点，+Y 向上',{x:0,y:0,z:1})}>正面</button></div>
 <p data-testid="view-direction">{view} · 视角变化不改变编号</p><div ref={host} className="profile-canvas"/><p>左键旋转 · 滚轮缩放 · 右键平移。X 红 / Y 绿 / Z 蓝，正负轴均有标签。</p></section>
 <aside>{loaded&&<><h2>{loaded.inputId} → {loaded.part}.dat</h2><p data-testid="profile-status">{g?'已审核共享 Geometry Profile':'Unsupported：仅显示 DAT，接口信息不可用'}</p><p>{g?'坐标：Profile 本地坐标，砖体底部中心原点，+Y 向上，单位 LDU。':'坐标：原始 LDraw 入口原点，+Y 向下；显示仅绕 X 旋转 180°，未推断砖体原点。'}</p><p>DAT：parts/{loaded.part}.dat · 完整依赖 {loaded.inspection.checkedFiles} 文件</p>
 <details><summary>Mapping 来源 / MOVED 与引用证据</summary><pre>{JSON.stringify({mapping:loaded.mapping,entryReferences:loaded.inspection.entryReferences,transform:g?.ldraw??'Raw LDraw Rx(π), no profile offset'},null,2)}</pre></details>
 <label><input type="checkbox" checked={top} disabled={!g} onChange={e=>setTop(e.target.checked)}/>显示 Top Stud</label><label><input type="checkbox" checked={bottom} disabled={!g} onChange={e=>setBottom(e.target.checked)}/>显示 Bottom Socket</label>
 <p>Top 标记：Profile 中的凸点接合位置。Bottom 标记：逻辑接合位置，<strong>不是实体 Tube 数量或中心</strong>。编号严格按数组顺序，旋转和切换视角不重排。</p>
 {picked&&<section data-testid="connector-detail"><h3>{picked.face}[{picked.index}]</h3><p>本地 LDU：({picked.p.x}, {picked.p.y}, {picked.p.z})</p><p>方向：{picked.p.direction} · 类型：{picked.p.type} · {picked.face==='bottom'?'逻辑接合位置（非 Tube 中心）':'顶部 Stud 接合面'}</p><pre>{JSON.stringify(picked.p,null,2)}</pre></section>}
 {g&&(['top','bottom'] as const).map(face=><details key={face} open><summary>{face} · {g[face].length} 个接口</summary><table><thead><tr><th>编号</th><th>X</th><th>Y</th><th>Z</th></tr></thead><tbody>{g[face].map((p,index)=><tr key={index}><td><button onClick={()=>{if(face==='top')setTop(true);else setBottom(true);setPicked({face,index,p})}}>{face}[{index}]</button></td><td>{p.x}</td><td>{p.y}</td><td>{p.z}</td></tr>)}</tbody></table></details>)}
 <details><summary>Profile 原始数据</summary><pre>{JSON.stringify(g??null,null,2)}</pre></details></>}</aside></div></main>
}
const root=createRoot(document.getElementById('profile-debug-root')!);root.render(<ProfileDebug/>);if(import.meta.hot)import.meta.hot.dispose(()=>root.unmount())
