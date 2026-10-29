import { useEffect, useState } from 'react'
export const stages = ['source','review','reconstruction','assembly','build','catalog'] as const
export const identityKeys = ['sourceId','analysisId','reviewId','reconstructionId','candidateId','observationId','assemblyId','buildId'] as const
export function readStudioUrl(href:string) {
 const p=new URL(href).searchParams, values:Record<string,string>={}, errors:string[]=[]
 for(const key of ['stage',...identityKeys])if(p.has(key)){
  const v=p.get(key)!
  if(key==='stage'?!stages.includes(v as typeof stages[number]):! /^[a-zA-Z0-9_-]{1,100}$/.test(v))errors.push(`URL ${key} 无效`)
  else values[key]=v
 }
 return {values,errors}
}
export function writeStudioUrl(values:Record<string,string|undefined>,push=false){
 const u=new URL(location.href)
 for(const [k,v] of Object.entries(values)){if(v)u.searchParams.set(k,v);else u.searchParams.delete(k)}
 if(u.href!==location.href)window.history[push?'pushState':'replaceState'](window.history.state,'',u)
}
// Only external navigation requests restoration. Our own writes never feed back into loaders.
export function useUrlRequest(){
 const [request,setRequest]=useState(()=>({href:location.href,sequence:0}))
 useEffect(()=>{const pop=()=>setRequest(r=>({href:location.href,sequence:r.sequence+1}));window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop)},[])
 return request
}
