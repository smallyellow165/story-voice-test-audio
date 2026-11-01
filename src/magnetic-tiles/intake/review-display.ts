import {useEffect,useMemo,useState} from 'react'
import {sourceImages} from './image-set.ts'
import type {Source,Observation} from './contracts.ts'

// Display preferences only. Never part of Recognition, Review or approval data.
export type EvidenceLink={id:string;imageEvidence?:{imageId:string}[]}
export type ReviewDisplayState={manualSelection?:boolean;moduleFilter?:string;reconstructionGroup?:string;reconstructionImage?:string;imageIds:string[]|null;markedIds:string[];annotationScope:string|null;query:string;filter:'All'|'Known'|'Unknown'|'Excluded';sort:'original'|'id'|'confidence'|'status'}
export const reviewDisplayDefaults=():ReviewDisplayState=>({imageIds:null,markedIds:[],annotationScope:null,query:'',filter:'All',sort:'original'})
export function normalizeReviewDisplay(raw:unknown,imageIds:readonly string[],observationIds:readonly string[]):ReviewDisplayState{
 const v=raw&&typeof raw==='object'?raw as Partial<ReviewDisplayState>:{},unique=(a:unknown,allowed:readonly string[])=>Array.isArray(a)?[...new Set(a.filter((id):id is string=>typeof id==='string'&&allowed.includes(id)))]:[]
 return {...(typeof v.reconstructionGroup==='string'?{reconstructionGroup:v.reconstructionGroup.slice(0,100)}:{}),...(typeof v.reconstructionImage==='string'?{reconstructionImage:v.reconstructionImage.slice(0,100)}:{}),...(typeof v.manualSelection==='boolean'?{manualSelection:v.manualSelection}:{}),...(typeof v.moduleFilter==='string'?{moduleFilter:v.moduleFilter.slice(0,100)}:{}),imageIds:Array.isArray(v.imageIds)?unique(v.imageIds,imageIds):null,markedIds:unique(v.markedIds,observationIds),annotationScope:typeof v.annotationScope==='string'?v.annotationScope.slice(0,10000):null,query:typeof v.query==='string'?v.query.slice(0,300):'',filter:['All','Known','Unknown','Excluded'].includes(v.filter??'')?v.filter!:'All',sort:['original','id','confidence','status'].includes(v.sort??'')?v.sort!:'original'}
}
export function observationImageIds(o:EvidenceLink,referenceId:string){return o.imageEvidence?o.imageEvidence.map(e=>e.imageId):[referenceId]}
export function imageFilteredIds(observations:readonly EvidenceLink[],images:readonly string[],referenceId:string){const selected=new Set(images);return observations.filter(o=>observationImageIds(o,referenceId).some(id=>selected.has(id))).map(o=>o.id)}
export function preferredReviewImage(o:EvidenceLink|undefined,images:readonly string[],activeId:string,referenceId:string){const linked=o?observationImageIds(o,referenceId):[];return images.includes(activeId)&&linked.includes(activeId)?activeId:images.find(id=>linked.includes(id))??activeId}
export const reviewStatus=(o:Pick<Observation,'excluded'|'profileId'>)=>o.excluded?'Excluded':o.profileId==='unknown'?'Unknown':'Known'
export function filteredReviewRows<T extends Observation>(observations:readonly T[],visibleIds:readonly string[],state:ReviewDisplayState,profileName:(o:T)=>string=()=> ''):T[]{
 const ids=new Set(visibleIds),query=state.query.trim().toLowerCase()
 const rows=observations.filter(o=>ids.has(o.id)&&(state.filter==='All'||reviewStatus(o)===state.filter)&&[o.id,profileName(o),o.profileId,o.evidence,o.uncertainty].join(' ').toLowerCase().includes(query))
 if(state.sort!=='original')rows.sort((a,b)=>state.sort==='confidence'?a.confidence-b.confidence:state.sort==='status'?reviewStatus(a).localeCompare(reviewStatus(b))||a.id.localeCompare(b.id):a.id.localeCompare(b.id,undefined,{numeric:true}))
 return rows
}
/** One UI selection for the actual frame and visible table. A matching scope
 * restores manual subsets (including explicit empty); a new scope selects its
 * evidenced rows. Sorting alone does not reset a manual selection. */
export function reviewImageSelection(state:ReviewDisplayState,imageId:string,evidencedIds:readonly string[],visibleIds:readonly string[],persistent=false){
 const visible=[...new Set(visibleIds)].sort(),evidenced=new Set(imageId?evidencedIds:[]),eligibleIds=visible.filter(id=>evidenced.has(id)),scope=JSON.stringify([imageId,visible,eligibleIds]),eligible=new Set(eligibleIds)
 if(persistent&&state.manualSelection)return {scope:JSON.stringify(['manual', [...state.markedIds].sort()]),eligibleIds:visible,markedIds:state.markedIds}
 return {scope,eligibleIds:persistent?visible:eligibleIds,markedIds:state.annotationScope===scope?state.markedIds.filter(id=>eligible.has(id)):eligibleIds}
}
export type ReviewDisplay=ReturnType<typeof useReviewDisplay>
export function useReviewDisplay(scope:string,source:Source|null,observations:readonly EvidenceLink[]){
 const key=scope?'magnetic-review-display.v1:'+scope:'',entries=sourceImages(source),imageKey=entries.map(e=>e.sourceId).join('\0'),observationKey=observations.map(o=>o.id).join('\0')
 const [local,setLocal]=useState<{key:string;value:unknown}>({key:'',value:null})
 const raw=useMemo(()=>{if(local.key===key)return local.value;try{return key?JSON.parse(localStorage.getItem(key)??'null'):null}catch{return null}},[key,local])
 const state=useMemo(()=>normalizeReviewDisplay(raw,imageKey?imageKey.split('\0'):[],observationKey?observationKey.split('\0'):[]),[raw,imageKey,observationKey])
 useEffect(()=>{if(key)try{localStorage.setItem(key,JSON.stringify(state))}catch{/* Optional view preferences never block saving real Review data. */}},[key,state])
 const imageIds=state.imageIds??entries.map(e=>e.sourceId),referenceId=source?.primaryImageId??source?.id??''
 return {state,imageIds,visibleIds:imageFilteredIds(observations,imageIds,referenceId),idsForImage:(id:string)=>imageFilteredIds(observations,[id],referenceId),update:(patch:Partial<ReviewDisplayState>)=>setLocal({key,value:{...state,...patch}})}
}
