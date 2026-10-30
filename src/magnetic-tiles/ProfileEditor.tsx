import {useState} from 'react'
import type {Profile} from './geometry.ts'
import {useProfileRegistry} from './ProfileRegistry.tsx'
import {dimensionNames,parametersFor,parametricProfile,profileAngles,shapeFields} from './parametric-profile.ts'
import type {ProfileInput,Shape} from './parametric-profile.ts'
import {profileSpec,profileViewBox} from './profiles.ts'
import {InfoHint} from '../brick-vision/InfoHint.tsx'
export function ProfileEditor({mode,profile,onClose,onSaved}:{mode:'create'|'version'|'copy';profile?:Profile;onClose:()=>void;onSaved:(p:Profile)=>void}){
 const {registry,save,refresh}=useProfileRegistry()
 const [revision,setRevision]=useState(registry.revision)
 const [input,setInput]=useState<ProfileInput>(()=>({id:mode==='version'?profile!.id:'',name:profile?.name??'',parameters:profile?parametersFor(profile)??{shape:'square',dimensions:{side:1}}:{shape:'square',dimensions:{side:1}},connectableEdges:profile?[...profile.connectableEdges]:['e0','e1','e2','e3'],estimated:!!profile?.sizeEvidence,source:profile?.geometrySource??profile?.sizeEvidence?.source??'用户参数化尺寸；标准正方形边长 = 1'}))
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 const versions=registry.profiles.filter(p=>p.id===input.id).map(p=>p.version),version=mode==='version'?Math.max(...versions)+1:1
 let preview:Profile|undefined,invalid=''
 try{preview=parametricProfile({...input,id:'preview',name:'预览'},version)}catch(e){invalid=String((e as Error).message)}
 let validation=invalid;try{parametricProfile(input,version)}catch(e){validation=String((e as Error).message)}
 const change=(patch:Partial<ProfileInput>)=>{setInput(v=>({...v,...patch}));setError('')}
 const type=input.parameters.shape,n=type==='square'||type==='rectangle'?4:3
 async function submit(){
  setBusy(true);setError('')
  try{onSaved(await save(input,mode==='version'?'version':'create',revision))}catch(e){setError(String((e as Error).message))}finally{setBusy(false)}
 }
 return <section className="profile-editor" aria-label="参数化 Profile 编辑器">
  <div className="catalog-actions"><strong>{mode==='version'?'编辑 · 保存新版本':mode==='copy'?'复制为新 Profile':'新增 Profile'}</strong><span title="保存时生成的新版本，不覆盖历史几何">@{version}</span><InfoHint label="参数化几何">相对单位：标准正方形边长 = 1。尺寸为有限正数；沿用 Validator 的坐标范围、最小边长和严格凸多边形标准。所有版本只追加，不覆盖历史。编辑已保存的规格时会创建该 ID 的下一版本。</InfoHint></div>
  <fieldset disabled={busy}>
   <label>Profile 名称<input aria-label="Profile 名称" maxLength={100} value={input.name} onChange={e=>change({name:e.target.value})}/></label>
   <label>Profile ID<input aria-label="Profile ID" maxLength={80} disabled={mode==='version'} value={input.id} placeholder="narrow-isosceles-triangle" onChange={e=>change({id:e.target.value})}/></label>
   <label>形状<select aria-label="参数化形状" value={type} onChange={e=>{const shape=e.target.value as Shape;change({parameters:{shape,dimensions:Object.fromEntries(shapeFields[shape].fields.map(k=>[k,1]))},connectableEdges:Array.from({length:shape==='square'||shape==='rectangle'?4:3},(_,i)=>`e${i}`)})}}>{Object.entries(shapeFields).map(([key,s])=><option key={key} value={key}>{s.name}</option>)}</select></label>
   <div className="profile-dimensions">{shapeFields[type].fields.map(k=><label key={k}>{dimensionNames[k]}<input aria-label={dimensionNames[k]} type="number" min="0" step="any" value={Number.isNaN(input.parameters.dimensions[k])?'':input.parameters.dimensions[k]} onChange={e=>change({parameters:{shape:type,dimensions:{...input.parameters.dimensions,[k]:e.target.value===''?0:Number(e.target.value)}}})}/></label>)}</div>
   <label className="profile-estimated"><input type="checkbox" checked={input.estimated} onChange={e=>change({estimated:e.target.checked})}/>Estimated Geometry</label>
   <label>几何来源说明<input aria-label="几何来源说明" maxLength={2000} value={input.source} onChange={e=>change({source:e.target.value})}/></label>
   <div className="catalog-actions" aria-label="连接边配置"><span>可连接边</span>{Array.from({length:n},(_,i)=>`e${i}`).map(id=><label className="profile-edge" key={id}><input aria-label={`允许连接 ${id}`} type="checkbox" checked={input.connectableEdges.includes(id)} onChange={e=>change({connectableEdges:e.target.checked?[...input.connectableEdges,id].sort():input.connectableEdges.filter(k=>k!==id)})}/>{id}</label>)}</div>
  </fieldset>
  {preview?<div className="profile-live-preview" data-testid="profile-live-preview"><svg viewBox={profileViewBox(preview)} aria-label="参数化实时预览"><g transform="scale(1 -1)"><polygon points={preview.vertices.map(v=>v.join(',')).join(' ')} fill="#f5b942" stroke="#596e64" strokeWidth="1" vectorEffect="non-scaling-stroke"/>{profileSpec(preview).edges.filter(e=>e.connectable).map(e=><line key={e.id} x1={preview.vertices[e.from][0]} y1={preview.vertices[e.from][1]} x2={preview.vertices[e.to][0]} y2={preview.vertices[e.to][1]} stroke="#267b69" strokeWidth="2" vectorEffect="non-scaling-stroke"/>)}</g></svg><small>{n} 顶点 · {n} 边 · 角度 {profileAngles(preview).map(v=>Number(v.toFixed(3))+'°').join(' / ')}</small><div className="profile-computed">{preview.vertices.map((v,i)=><small key={i}>v{i} [{v.map(x=>Number(x.toFixed(6))).join(', ')}] · e{i} 长 {Number(profileSpec(preview).edges[i].length.toFixed(6))} · {preview.connectableEdges.includes(`e${i}`)?'可连接':'不连接'}</small>)}</div></div>:<p role="status">{invalid}</p>}
  {preview&&validation&&<p role="status">{validation}</p>}
  {profile&&!parametersFor(profile)&&<p role="alert">原规格无法转换为 V1 参数形状；当前为正方形初始参数，请明确选择所需形状。历史规格保持不变。</p>}
  {(error||revision!==registry.revision)&&<p role="alert">{error||'Catalog 有更新；请读取最新版本后再保存。编辑内容保留。'}<button disabled={busy} onClick={()=>void refresh().then(r=>{setRevision(r.revision);setError('')}).catch(e=>setError(String(e)))}>读取最新 Catalog</button></p>}
  <div className="catalog-actions"><button className="primary" disabled={busy||!!validation||!preview||revision!==registry.revision} onClick={()=>void submit()}>{busy?'保存中…':mode==='version'?'保存新版本':'保存 Profile'}</button><button disabled={busy} onClick={onClose}>取消</button></div>
 </section>
}
