import {useEffect,useRef,useState} from 'react'
import {intakeApi} from '../magnetic-tiles/intake/api.ts'
import type {Assembly3D} from '../magnetic-tiles/three-d/assembly.ts'
import type {SavedAssembly} from '../magnetic-tiles/three-d/assembly-library.ts'
import type {CameraView3D} from '../magnetic-tiles/three-d/camera-view.ts'
import {MagnetScene3D} from '../magnetic-tiles/three-d/vendor/components/MagnetScene3D.tsx'
import {magneticGalleryUrl,openGalleryItemUrl,createMagneticWorkspaceUrl,editMagneticWorkspaceUrl} from './links.ts'
import type {AssemblyReference} from './links.ts'
import '../brick-gallery/gallery.css'
import '../magnetic-tiles/three-d/viewer.css'
import './gallery.css'

export type MagneticGalleryItem = {schemaVersion:1;id:string;description:string;assemblyRef:AssemblyReference;createdAt:string}
type OpenItem = {item:MagneticGalleryItem;assembly:Assembly3D;cameraView:CameraView3D|null}
type FixedAssembly = Pick<SavedAssembly,'assembly'|'version'|'hash'|'snapshot'>

export function MagneticGallery(){
 const params=new URL(location.href).searchParams,id=params.get('id'),adding=params.get('mode')==='add'
 const [items,setItems]=useState<MagneticGalleryItem[]>([]),[warnings,setWarnings]=useState<{id:string;error:string}[]>([])
 const [opened,setOpened]=useState<OpenItem|null>(null),[source,setSource]=useState<FixedAssembly|null>(null)
 const [description,setDescription]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const publishing=useRef(false)
 useEffect(()=>{
  let alive=true
  void(async()=>{
   if(adding){
    const assemblyId=params.get('assemblyId'),version=Number(params.get('version')),hash=params.get('hash')
    if(!assemblyId||!Number.isSafeInteger(version)||version<1||!hash||!/^[a-f0-9]{64}$/.test(hash))throw Error('请从 Studio 的已保存 Assembly 点击 Add to Gallery。')
    const saved=await intakeApi<FixedAssembly>('assembly3d/records/'+encodeURIComponent(assemblyId)+'/versions/'+version)
    if(saved.assembly.id!==assemblyId||saved.version!==version||saved.hash!==hash)throw Error('保存版本与链接不一致，请从 Studio 重新打开发布入口。')
    if(alive)setSource(saved)
   }else if(id){
    const result=await intakeApi<OpenItem>('gallery/items/'+encodeURIComponent(id))
    if(alive)setOpened(result)
   }else{
    const result=await intakeApi<{items:MagneticGalleryItem[];warnings:{id:string;error:string}[]}>('gallery/items')
    if(alive){setItems(result.items);setWarnings(result.warnings)}
   }
  })().catch(e=>{if(alive)setError(String(e))}).finally(()=>{if(alive)setLoading(false)})
  return()=>{alive=false}
 },[id,adding])
 async function publish(){
  if(!source||publishing.current)return
  publishing.current=true;setBusy(true);setError('')
  try{
   const result=await intakeApi<{item:MagneticGalleryItem}>('gallery/publish',{description,assemblyRef:{id:source.assembly.id,version:source.version,hash:source.hash}})
   location.assign(openGalleryItemUrl(result.item.id))
  }catch(e){setError(String(e));publishing.current=false;setBusy(false)}
 }
 return <main className="gallery-page magnetic-gallery">
  <header className="gallery-header"><a className="gallery-brand" href={magneticGalleryUrl()}>Magnetic Tiles · 我的作品集</a><a href={createMagneticWorkspaceUrl()}>家长制作入口 / Create New</a></header>
  {error&&<p className="gallery-error" role="alert">{error}</p>}
  {loading&&<p role="status">正在打开作品…</p>}
  {!loading&&adding&&source&&<section className="gallery-form">
   <h1>Add to Gallery · 加入作品集</h1>
   <p>发布已保存的版本 v{source.version}。之后在 Studio 保存新版本，这件作品仍保持当前版本。</p>
   <form onSubmit={e=>{e.preventDefault();void publish()}}><fieldset disabled={busy}>
    <label>作品描述<textarea required maxLength={500} value={description} onChange={e=>setDescription(e.target.value)} placeholder="例如：我搭的小房子和花园"/></label>
    <button className="gallery-primary" type="submit" disabled={!description.trim()}>{busy?'正在加入…':'加入 Gallery'}</button>
   </fieldset></form>
  </section>}
  {!loading&&!adding&&!id&&<>
   <div className="gallery-intro"><span>一起动手，一起发现</span><h1>今天想看哪个作品？</h1><p>从 Studio 保存 Assembly 后，点击 Add to Gallery，把作品留在这里。</p></div>
   <div className="gallery-grid">{items.map(item=><article className="gallery-card magnetic-gallery-card" key={item.id}>
    <div><p className="magnetic-gallery-description">{item.description}</p><p>固定版本 v{item.assemblyRef.version}</p><a className="magnetic-gallery-open" href={openGalleryItemUrl(item.id)} aria-label={'打开作品：'+item.description}>Open Assembly · 打开作品 →</a><p><a href={editMagneticWorkspaceUrl(item.id,item.assemblyRef)} aria-label={'Edit 作品：'+item.description}>Edit · 编辑作品 →</a></p></div>
   </article>)}</div>
   {items.length===0&&<p className="gallery-empty">还没有作品。请从家长制作入口保存作品，再加入 Gallery。</p>}
   {warnings.length>0&&<details className="gallery-error"><summary>{warnings.length} 条作品记录无法读取</summary>{warnings.map(w=><p key={w.id}>{w.error}</p>)}</details>}
  </>}
  {!loading&&!adding&&opened&&<section>
   <a href={magneticGalleryUrl()}>← 所有作品</a><h1>作品预览</h1><a href={editMagneticWorkspaceUrl(opened.item.id,opened.item.assemblyRef)}>Edit · 编辑作品</a>
   <p className="magnetic-gallery-description">{opened.item.description}</p><p>固定保存版本 v{opened.item.assemblyRef.version} · 只读查看</p>
   <MagnetScene3D assembly={opened.assembly} selected={null} onSelect={()=>{}} initialCameraView={opened.cameraView??undefined}/>
  </section>}
  {!loading&&(adding||id)&&<p><a href={magneticGalleryUrl()}>返回作品集</a></p>}
 </main>
}
