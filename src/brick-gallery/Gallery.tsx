import {useEffect,useRef,useState} from 'react'
import {BrickViewer} from '../brick-test/viewer'
import {stepScene} from '../brick-build/plan.mjs'
import type {BuildPlan,BuildSource} from '../brick-build/plan.mjs'
import {InfoHint} from '../brick-vision/InfoHint'
import './gallery.css'
import type { GalleryActivity } from './activity'
export type Item={id:string;title:string;description:string;cover:{kind:'source-image';imageId:string};layoutSelectionId:string;buildPlanId:string|null;revision:number}
export type Detail={item:Item;source:BuildSource;plan:BuildPlan|null;sourceImageId:string;brickCount:number;stepCount:number;canBuild:boolean;parts:{partNumber:string;name:string;colorName:string;colorHex:string;quantity:number}[]}
const page=()=>import.meta.env.BASE_URL+'brick-gallery.html'
export const galleryUrl=(id:string,mode='detail')=>page()+'?'+new URLSearchParams({id,mode})
async function api(route:string,body?:unknown){const r=await fetch('/api/brick-gallery/'+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw Error(value.error);return value}
function ErrorNotice({error}:{error:string}){return error?<div className="gallery-error" role="alert">暂时无法完成操作，请家长查看。<details><summary>查看原因</summary>{error}</details></div>:null}
// Read-only presentation over the SAME stepScene + BrickViewer motion engine as Build Order.
function GalleryModel({source,plan,step=0,activity}:{source:BuildSource;plan?:BuildPlan|null;step?:number;activity?:GalleryActivity}){
 const host=useRef<HTMLDivElement>(null),viewer=useRef<BrickViewer|null>(null)
 const [error,setError]=useState(''),[phase,setPhase]=useState('loading'),[replay,setReplay]=useState(0)
 useEffect(()=>{const v=new BrickViewer(host.current!,activity?.libraryUrl??import.meta.env.BASE_URL+'brick-ldraw/',message=>{setError(message);activity?.visualDone(message)});viewer.current=v;return()=>{v.dispose();viewer.current=null}},[])
 useEffect(()=>{const v=viewer.current!,renderVersion=activity?.renderVersion;let active=true;setError('');setPhase('loading');v.reset()
 void(async()=>{
  if(plan&&plan.steps.length){const scene=stepScene(plan,source.assembly.bricks,step);const ready=await v.prepareBuildStep(scene.target,scene.moving,scene.step.motion||{offsetLdu:{x:0,y:120,z:0},startYawDegrees:0},()=>{if(active){setPhase('done');activity?.visualDone(undefined,renderVersion)}});if(active&&ready){setPhase('playing');v.playBuildStep()}}
  else {const ready=await v.replace(source.assembly.bricks);if(active&&ready){v.fit();setPhase('ready');activity?.visualDone(undefined,renderVersion)}}
 })().catch(e=>{if(active){setError(String(e));setPhase('error');activity?.visualDone(String(e),renderVersion)}})
 return()=>{active=false;v.reset()}
 },[source,plan,step,replay,activity?.replay])
 return <><div className="gallery-model" ref={host} aria-label={plan?'三维搭建动画':'完成后的三维模型'}/><ErrorNotice error={error}/><div className="gallery-model-controls"><button onClick={()=>viewer.current?.fit()}>看清整个模型</button>{plan&&plan.steps.length>0&&<button disabled={phase==='loading'||phase==='playing'||!!error} onClick={()=>activity?activity.request('replay_step'):setReplay(n=>n+1)}>重播动画</button>}<span role="status">{phase==='loading'?'积木正在准备中…':phase==='playing'?'一起看看怎样装上去':phase==='done'?'装好了吗？可以继续下一步':'拖动模型转一转，缩放看看细节'}</span></div></>
}
function GalleryForm({id,selectionId,buildPlanId}:{id:string|null;selectionId:string|null;buildPlanId:string|null}){
 const [data,setData]=useState<Detail|null>(null),[title,setTitle]=useState(''),[description,setDescription]=useState(''),[cover,setCover]=useState(''),[images,setImages]=useState<{id:string;name:string}[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const lock=useRef(false)
 useEffect(()=>{let active=true;void(async()=>{
  const d=await api(id?'items/'+id:'context?'+new URLSearchParams({selectionId:selectionId||'',...(buildPlanId?{buildPlanId}:{})}))
  if(!active)return;setData(d);setTitle(id?d.item.title:d.plan?.title||'');setDescription(id?d.item.description:'');setCover(id?d.item.cover.imageId:d.sourceImageId)
  const r=await fetch('/api/brick-reverse/history'),h=await r.json();if(!r.ok)throw Error(h.error)
  if(active)setImages([...new Map<string,{id:string;name:string}>(h.items.map((a:any)=>[a.sourceImageId,{id:a.sourceImageId,name:a.image_reference?.name||'来源图片'}])).values()])
 })().catch(e=>{if(active)setError(String(e))});return()=>{active=false}},[id,selectionId,buildPlanId])
 async function save(){if(!data||lock.current)return;lock.current=true;setBusy(true);setError('');try{
  const result=await api('save',{...(id?{id}:{}),expectedRevision:id?data.item.revision:null,layoutSelectionId:data.source.id,buildPlanId:data.plan?.build_plan_id??null,title,description,cover:{kind:'source-image',imageId:cover}})
  location.assign(galleryUrl(result.item.id))
 }catch(e){setError(String(e));lock.current=false;setBusy(false)}}
 return <section className="gallery-form"><h1>{id?'编辑作品信息':'加入作品库'}</h1><p>修改名称、封面和介绍，不会改变积木布局或搭建步骤。</p><ErrorNotice error={error}/>{data?<form onSubmit={e=>{e.preventDefault();void save()}}><fieldset disabled={busy}><label>作品名称<input required maxLength={80} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>一句话介绍<textarea maxLength={500} value={description} onChange={e=>setDescription(e.target.value)}/></label><label>封面图片 <InfoHint label="封面图片">选择已正式保存的原图，不会生成或复制图片。</InfoHint><select required value={cover} onChange={e=>setCover(e.target.value)}>{!images.some(i=>i.id===cover)&&<option value={cover}>当前来源图片</option>}{images.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>{!data.plan&&<p role="status">尚无已保存的搭建步骤；此作品只能查看模型，不能开始搭建。</p>}<button className="gallery-primary" type="submit">{busy?'正在保存…':'保存作品'}</button></fieldset></form>:!error&&<p role="status">正在核对作品来源…</p>}</section>
}
export function Gallery({activity}:{activity?:GalleryActivity}={}){
 const params=new URL(location.href).searchParams,id=activity?activity.id:params.get('id'),mode=activity?activity.mode:params.get('mode')||'detail'
 const [localItems,setItems]=useState<{item:Item;brickCount:number;stepCount:number;canBuild:boolean}[]>([]),[localWarnings,setWarnings]=useState<any[]>([]),[localData,setData]=useState<Detail|null>(null),[localError,setError]=useState(''),[localLoading,setLoading]=useState(true),[localStep,setStep]=useState(0)
 const [,redraw]=useState(0)
 useEffect(()=>activity?.subscribe(()=>redraw(n=>n+1)),[activity])
 const items=activity?.items??localItems,warnings=activity?.warnings??localWarnings,data=activity?activity.data:localData,error=activity?.error??localError,loading=activity?.loading??localLoading,step=activity?.step??localStep
 useEffect(()=>{if(activity)return;if(mode==='add'||mode==='edit')return;let active=true;void api(id?'items/'+id:'items').then(v=>{if(!active)return;if(id)setData(v);else{setItems(v.items);setWarnings(v.warnings)};setLoading(false)}).catch(e=>{if(active){setError(String(e));setLoading(false)}});return()=>{active=false}},[id,mode])
 return <main className="gallery-page" onClick={event=>{
 if(!activity)return
 const anchor=(event.target as HTMLElement).closest('a')
 if(!anchor)return
 event.preventDefault()
 const target=new URL(anchor.href)
 if(target.pathname.endsWith('brick-gallery.html')){
  const selected=target.searchParams.get('id'),view=target.searchParams.get('mode')
  if(view==='edit'||view==='add')return
  activity.request(view==='play'?'start_build':selected?'select_model':'back_to_gallery',selected?{galleryId:selected}:{})
 }
 }}><header className="gallery-header"><a className="gallery-brand" href={page()}>瑞瑞 · 积木作品库</a>{!activity&&<a href={import.meta.env.BASE_URL+'brick-test.html?workflow=build'}>家长制作入口</a>}</header>
 {mode==='add'||mode==='edit'?<GalleryForm id={mode==='edit'?id:null} selectionId={params.get('selectionId')} buildPlanId={params.get('buildPlanId')}/>:<><ErrorNotice error={error}/>{loading&&<p role="status">正在准备作品…</p>}{activity?.busy&&<p role="status">正在加载或播放，请稍等…</p>}{!id&&!loading&&<><div className="gallery-intro"><span>一起动手，一起发现</span><h1>今天想搭什么？</h1><p>选一个喜欢的造型，和家人一起把它搭出来。</p></div><div className="gallery-grid">{items.map(({item,brickCount,stepCount,canBuild})=><a className="gallery-card" key={item.id} href={galleryUrl(item.id)}><img loading="lazy" src={(activity?.apiBase??'/api/brick-gallery/')+'items/'+item.id+'/cover'} alt={item.title}/><div><h2>{item.title}</h2><p>{brickCount} 块积木 · {canBuild?stepCount+' 个步骤':'欣赏模型'}</p></div></a>)}</div>{items.length===0&&<p className="gallery-empty">作品库还没有作品。家长可在保存搭建步骤后，点击 Add to Gallery。</p>}{warnings.length>0&&<details className="gallery-error"><summary>{warnings.length} 个作品暂不可用，请家长检查来源</summary>{warnings.map(w=><p key={w.id}>{w.id}：{w.error}</p>)}</details>}</>}
 {data&&(mode==='play'?<section className="gallery-player"><a href={galleryUrl(data.item.id)}>← 返回作品</a><h1>{data.item.title}</h1>{data.canBuild&&data.plan?<><p className="gallery-step">{data.plan.steps.length?'第 '+(step+1)+' 步，共 '+data.plan.steps.length+' 步':'作品已经完成'}</p><GalleryModel activity={activity} source={data.source} plan={data.plan} step={step}/><p className="gallery-instruction">{data.plan.steps[step]?.description}</p><nav className="gallery-step-nav" aria-label="搭建步骤"><button disabled={step===0||!!activity?.busy||activity?.enabled===false} onClick={()=>activity?activity.request('previous_step'):setStep(n=>n-1)}>← 上一步</button><button className="gallery-primary" disabled={step>=data.plan.steps.length-1||!!activity?.busy||activity?.enabled===false} onClick={()=>activity?activity.request('next_step'):setStep(n=>n+1)}>下一步 →</button></nav><p className="gallery-parent-note">请家长陪同。动画是安装示意，请确认积木连接牢固。</p></>:<p>这个作品尚无保存的完整搭建步骤。</p>}</section>:<article className="gallery-detail"><a href={page()}>← 所有作品</a><h1>{data.item.title}</h1><p>{data.item.description}</p><GalleryModel activity={activity} source={data.source}/><div className="gallery-detail-actions">{data.canBuild?<a className="gallery-primary" href={galleryUrl(data.item.id,'play')}>开始搭建 →</a>:<p>搭建步骤尚未准备好，先看看模型吧。</p>}{!activity&&<a href={galleryUrl(data.item.id,'edit')}>家长编辑作品信息</a>}</div><h2>先准备这些积木</h2><p>{data.brickCount} 块积木{data.canBuild?' · '+data.stepCount+' 个步骤':''}</p><ul className="gallery-parts">{data.parts.map((p,i)=><li key={i}><span className="gallery-color" style={{background:p.colorHex}}/><div><strong>{p.name}</strong><small>{p.colorName} · 型号 {p.partNumber}</small></div><b>× {p.quantity}</b></li>)}</ul><p className="gallery-parent-note">请家长陪同搭建。三维模型中的印花可能未显示，请按零件型号准备。</p></article>)}</>}
 </main>
}
