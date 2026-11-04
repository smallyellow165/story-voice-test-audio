import {studioStorage} from '../workspace-context.ts'
import {useEffect,useRef,useState} from 'react'
import {intakeApi} from './api.ts'
import {sourceImages} from './image-set.ts'
import type {Source} from './contracts.ts'
const cache=new Map<string,Promise<string>>()
export function sourceImageUrl(id:string,library=false):Promise<string>{const key=(library?'library:':'source:')+id;let value=cache.get(key);if(!value){value=intakeApi<{mimeType:string;imageBase64:string}>(library?'library-image':'image/'+id,library?{name:id}:undefined).then(i=>'data:'+i.mimeType+';base64,'+i.imageBase64).catch(e=>{cache.delete(key);throw e});cache.set(key,value)}return value}
export function clearLibraryImageCache(){for(const key of cache.keys())if(key.startsWith('library:'))cache.delete(key)}
export function SourceThumbnail({id,library=false}:{id:string;library?:boolean}){const ref=useRef<HTMLSpanElement>(null),[url,setUrl]=useState('');useEffect(()=>{let live=true;const load=()=>void sourceImageUrl(id,library).then(u=>{if(live)setUrl(u)}).catch(()=>{}),observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){load();observer.disconnect()}});if(ref.current)observer.observe(ref.current);return()=>{live=false;observer.disconnect()}},[id,library]);return <span ref={ref} className="source-thumbnail">{url&&<img src={url} alt=""/>}</span>}
/** Viewing a frame never changes the Analysis source identity or its evidence. */
export function useSourceFrame(source:Source|null,scope:'2d'|'visible3d'='2d',availableIds?:readonly string[]){
 const entries=sourceImages(source),available=availableIds?entries.filter(e=>availableIds.includes(e.sourceId)):entries,primary=source?.primaryImageId??source?.id??'',fallback=available.some(e=>e.sourceId===primary)?primary:available[0]?.sourceId??''
 const [choice,setChoice]=useState({group:'',id:''}),[loaded,setLoaded]=useState({id:'',url:''}),[error,setError]=useState('')
 let remembered='';try{remembered=source?studioStorage().getItem('magnetic-source-frame:'+scope+':'+source.id)??'':''}catch{/* metadata remains server-side */}
 const wanted=choice.group===source?.id?choice.id:remembered,activeId=available.some(e=>e.sourceId===wanted)?wanted:fallback
 const entry=entries.find(e=>e.sourceId===activeId)
 useEffect(()=>{let live=true;setError('');if(activeId)void sourceImageUrl(activeId).then(url=>{if(live)setLoaded({id:activeId,url})}).catch(e=>{if(live)setError(String(e))});return()=>{live=false}},[activeId])
 const select=(id:string)=>{if(!source||!available.some(e=>e.sourceId===id))return;setChoice({group:source.id,id});try{studioStorage().setItem('magnetic-source-frame:'+scope+':'+source.id,id)}catch{/* view selection only */}}
 // In Review, a filter can force a different frame. Keep that frame when the
 // filter is expanded again, instead of jumping back to a previously hidden one.
 const restricted=availableIds!==undefined
 useEffect(()=>{if(restricted&&activeId&&activeId!==wanted)select(activeId)},[restricted,source?.id,activeId,wanted,scope])
 return {entries,activeId,select,image:loaded.id===activeId?loaded.url:'',error,displaySource:entry?{id:entry.sourceId,name:entry.name,view:entry.view}:null}
}
export function SourceImageStrip({source,activeId,onSelect}:{source:Source|null;activeId:string;onSelect:(id:string)=>void}){const entries=sourceImages(source);return entries.length>1?<div className="source-frame-strip" role="group" aria-label="查看来源图片">{entries.map((e,i)=><button key={e.sourceId} aria-pressed={e.sourceId===activeId} onClick={()=>onSelect(e.sourceId)} title={e.name+' · '+e.role+' / '+e.direction+' · '+e.note}>{i+1} · {e.name}<small>{e.role} · {e.direction}</small></button>)}</div>:null}
