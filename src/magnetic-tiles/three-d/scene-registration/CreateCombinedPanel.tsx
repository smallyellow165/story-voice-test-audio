import {useEffect,useMemo,useRef,useState} from 'react'
import {Vector3} from 'three'
import {intakeApi} from '../../intake/api.ts'
import {currentWorkspace} from '../../workspace-context.ts'
import type {SavedAssemblySummary} from '../assembly-library.ts'
import {createViewerModel} from '../viewer-model.ts'
import {MagnetScene3D,ViewerErrorBoundary} from '../vendor/components/MagnetScene3D.tsx'
import {projectRegistrationPoint} from './fit.ts'
import {registrationInspectionView} from './inspection-camera.ts'
import type {RegistrationOptions,RegistrationResult} from './contracts.ts'

export function CreateCombinedPanel({saved,visible,currentId,busy,onCreate}:{saved:SavedAssemblySummary[];visible:Record<string,boolean>;currentId:string;busy:boolean;onCreate:(name:string,ids:string[],registration?:{id:string;hash:string})=>Promise<void>}){
 const [name,setName]=useState('Combined Assembly'),[ids,setIds]=useState(()=>saved.filter(a=>a.id===currentId||visible[a.id]).slice(0,8).map(a=>a.id)),[options,setOptions]=useState<RegistrationOptions|null>(null),[imageId,setImageId]=useState(''),[image,setImage]=useState(''),[result,setResult]=useState<RegistrationResult|null>(null),[error,setError]=useState(''),[availability,setAvailability]=useState(''),[running,setRunning]=useState(false),[loading,setLoading]=useState(false)
 const seq=useRef(0),resultRequest=useRef(0),scope=currentWorkspace(),parents=ids.map(id=>saved.find(a=>a.id===id)).filter((a):a is SavedAssemblySummary=>!!a).map(a=>({id:a.id,version:a.version,hash:a.hash})),key=JSON.stringify(parents),projectId=scope?.mode==='create'?scope.id:undefined
 const [restoring,setRestoring]=useState(false)
 useEffect(()=>{
  const token=++seq.current;resultRequest.current++;setRunning(false);setRestoring(false);setOptions(null);setImageId('');setResult(null);setImage('');setAvailability('');setError('')
  if(parents.length<2){setLoading(false);return}
  setLoading(true)
  void intakeApi<RegistrationOptions>('scene-registration/options',{parents,projectId}).then(o=>{if(seq.current!==token)return;setOptions(o);setImageId(o.images.length===1?o.images[0].id:'');if(!o.images.length)setAvailability('没有包含全部成员证据的共同照片')}).catch(e=>{if(seq.current===token)setAvailability(String(e.message))}).finally(()=>{if(seq.current===token)setLoading(false)})
  return()=>{seq.current++}
 },[key,projectId])
 const photo=options?.images.find(i=>i.id===imageId)
 const selectionKey=key+'|'+imageId,currentSelection=useRef(selectionKey);currentSelection.current=selectionKey
 useEffect(()=>{
  const token=seq.current;let canceled=false;setImage('');setResult(null);setError('')
  if(photo)void intakeApi<{mimeType:string;imageBase64:string}>('scene-registration/image',{parents,projectId,image:photo}).then(v=>{if(!canceled&&token===seq.current)setImage(`data:${v.mimeType};base64,${v.imageBase64}`)}).catch(e=>{if(!canceled&&token===seq.current)setError(String(e.message))})
  return()=>{canceled=true}
 },[key,imageId])
 async function run(){
  if(!photo)return;resultRequest.current++;const token=seq.current,selection=selectionKey;setRunning(true);setError('');setResult(null)
  try{const r=await intakeApi<RegistrationResult>('scene-registration/run',{parents,projectId,image:photo});if(token===seq.current&&selection===currentSelection.current){setResult(r);setOptions(o=>o?{...o,results:[{id:r.id,hash:r.hash,createdAt:r.computedAt,imageId:r.input.image.id,rmse:r.solution.quality.pointRmsePx},...o.results]}:o)}}catch(e){if(token===seq.current)setError(String(e))}finally{if(token===seq.current)setRunning(false)}
 }
 async function loadResult(id:string){const request=++resultRequest.current,token=seq.current,selection=selectionKey;setRestoring(true);setError('');setResult(null);try{const r=await intakeApi<RegistrationResult>('scene-registration/records/'+id);if(request!==resultRequest.current||token!==seq.current||selection!==currentSelection.current)return;if(r.hash!==options?.results.find(r=>r.id===id)?.hash||r.input.image.id!==imageId||JSON.stringify(r.input.members.map(m=>({id:m.ref.id,version:m.ref.version,hash:m.ref.hash})))!==key)throw Error('配准记录与当前输入不一致；请重新运行');setResult(r)}catch(e){if(request===resultRequest.current&&token===seq.current&&selection===currentSelection.current)setError(String(e))}finally{if(request===resultRequest.current)setRestoring(false)}}
 const locked=busy||running||restoring
 const inspectionView=useMemo(()=>result?registrationInspectionView(result.preview,result.solution.camera):undefined,[result])
 return <section className="module-transform-panel scene-registration-panel" aria-label="创建 Combined Assembly">
  <div className="module-fields"><label>组合名称<input aria-label="组合名称" value={name} disabled={locked} onChange={e=>setName(e.target.value)}/></label><label>共同参考照片<select aria-label="Scene Registration 参考照片" value={imageId} disabled={locked||loading||!options} onChange={e=>setImageId(e.target.value)}><option value="">选择共同照片</option>{options?.images.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label></div>
  <div className="registration-members" role="group" aria-label="Combined 来源作品">{saved.map(a=><label key={a.id}><input type="checkbox" aria-label={'组合来源 '+a.name} disabled={locked||(!ids.includes(a.id)&&ids.length>=8)} checked={ids.includes(a.id)} onChange={e=>setIds(e.target.checked?[...ids,a.id]:ids.filter(id=>id!==a.id))}/>{a.name} · {a.tiles} Tiles · v{a.version}</label>)}</div>
  {!!options?.results.some(r=>r.imageId===imageId)&&<label>已保存配准<select aria-label="已保存 Scene Registration" disabled={locked} value={result?.id??''} onChange={e=>{if(e.target.value)void loadResult(e.target.value);else setResult(null)}}><option value="">选择独立配准结果</option>{options.results.filter(r=>r.imageId===imageId).map(r=><option key={r.id} value={r.id}>{r.createdAt.slice(0,16).replace('T',' ')} UTC · RMSE {r.rmse.toFixed(2)} px</option>)}</select></label>}
  <div className="button-row"><span title={loading?'正在核对来源':availability||(!photo?'请选择共同参考照片':!image?'正在加载参考照片':'')}><button disabled={locked||loading||!photo||!image} onClick={()=>void run()}>Auto Align from Photo</button></span><button disabled={locked||!name.trim()||parents.length<2||!!error||(!!result&&!image)} onClick={()=>{setError('');void onCreate(name,ids,result?{id:result.id,hash:result.hash}:undefined).catch(e=>setError(String(e)))}}>{result?'采用布局并创建':'创建 Combined Assembly'}</button>{result&&<button disabled={locked} onClick={()=>{resultRequest.current++;setResult(null)}}>取消预览</button>}</div>
  {availability&&<small>{availability}；仍可按原有方式创建组合并手动定位。</small>}
  {loading&&<small role="status">正在核对保存版本与照片来源…</small>}
  {running&&<small role="status">正在进行确定性配准，不调用模型…</small>}
  {restoring&&<small role="status">正在恢复独立配准结果…</small>}
  {error&&<p role="alert" className="magnetic-3d-blocker">{error}</p>}
  {result&&<><p role="status" data-testid="scene-registration-quality">边段 RMSE {result.solution.quality.pointRmsePx.toFixed(2)} px · BBox 交叉验证 {result.solution.quality.bboxCrosscheckPointRmsePx.toFixed(2)} px · Geometry {result.geometryValid?'Valid':'Invalid'} · {result.preview.pieces.length} Tiles</p><small>V1：共同竖直与地面假设。近似布局，真实深度及对称朝向仍有不确定性。来源作品尚未修改。</small><div className="registration-comparison"><figure><figcaption>照片与可见 Tile 投影</figcaption><RegistrationProjection result={result} image={image}/></figure><figure><figcaption>完整 3D 场景预览 · 正交检查视角</figcaption><ViewerErrorBoundary><MagnetScene3D key={result.id} assembly={result.preview} selected={null} onSelect={()=>{}} showTileIds={false} initialCameraView={inspectionView}/></ViewerErrorBoundary></figure></div></>}
 </section>
}

function RegistrationProjection({result,image}:{result:RegistrationResult;image:string}){
 const polygons=useMemo(()=>result.input.members.flatMap(m=>{
  const delta=result.solution.transforms.find(t=>t.memberId===m.ref.id)!.delta,visible=new Set(result.input.boxes.filter(b=>b.memberId===m.ref.id).map(b=>b.pieceId))
  return createViewerModel(m.assembly).filter(p=>visible.has(p.id)).map(p=>({id:m.ref.id+':'+p.id,color:p.color,points:p.shape.vertices.map(x=>projectRegistrationPoint(new Vector3(x.x,x.y,0).applyQuaternion(p.transform.quaternion).add(p.transform.position).toArray(),delta,result.solution.camera).join(',')).join(' ')}))
 }),[result])
 return <svg role="img" aria-label="Scene Registration 照片投影" viewBox={`0 0 ${result.input.image.width} ${result.input.image.height}`}><image href={image} width={result.input.image.width} height={result.input.image.height}/>{polygons.map(p=><polygon key={p.id} points={p.points} fill={p.color} fillOpacity=".06" stroke={p.color} strokeWidth="1"/>)}{result.input.points.map((p,i)=><circle key={i} cx={p.pixel[0]} cy={p.pixel[1]} r="1.7" fill="white" stroke="#333" strokeWidth=".6"/>)}</svg>
}
