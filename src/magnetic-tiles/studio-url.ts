import { useEffect, useState } from 'react'
export const workflowStages = ['source','review','reconstruction','assembly','build'] as const
export type WorkflowStage = typeof workflowStages[number]
export const stages = [...workflowStages,'catalog'] as const
// Old Catalog URLs keep every identity while resolving to a real work stage.
export function catalogWorkStage(values:Record<string,string>):WorkflowStage {
 return values.buildId?'build':values.assemblyId?'assembly':values.reconstructionId||values.candidateId?'reconstruction':values.reviewId||values.observationId?'review':values.analysisId||values.sourceId?'source':'assembly'
}
export const identityKeys = ['sourceId','analysisId','reviewId','reconstructionId','candidateId','observationId','assemblyId','buildId'] as const
export function readStudioUrl(href:string) {
 const p=new URL(href).searchParams, values:Record<string,string>={}, errors:string[]=[]
 for(const key of ['stage',...identityKeys])if(p.has(key)){
  const v=p.get(key)!
  if(key==='stage'?!stages.includes(v as typeof stages[number]):! /^[a-zA-Z0-9_-]{1,100}$/.test(v))errors.push(`URL ${key} 无效`)
  else values[key]=v
 }
 if(values.stage==='catalog')values.stage=catalogWorkStage(values)
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

export const PREFERENCES_KEY='magnetic-studio.intake-preferences.v1'
type ModelConfig={models:{id:string;provider:string}[];providers:Record<string,boolean>}
// Preference errors do not invalidate independent saved-work identities.
export function resolveIntakePreferences(href:string, saved:unknown, config:ModelConfig){
 const params=new URL(href).searchParams
 const previous=(saved&&typeof saved==='object'?saved:{}) as Record<string,unknown>
 const source=params.has('sourceType')?params.get('sourceType'):previous.sourceType??'uploaded'
 const wanted=params.has('model')?params.get('model'):previous.model??config.models.find(m=>m.id==='gpt-4.1'&&config.providers[m.provider])?.id??config.models.find(m=>config.providers[m.provider])?.id??''
 const sourceValid=source==='server'||source==='uploaded'
 const modelValid=typeof wanted==='string'&&config.models.some(m=>m.id===wanted&&config.providers[m.provider])
 return {sourceType:sourceValid?source as 'server'|'uploaded':'' as const,model:modelValid?wanted as string:'',warnings:{
  sourceType:sourceValid?'':`${params.has('sourceType')?'URL':'本地偏好'} sourceType 无效，请选择图片来源。`,
  model:modelValid?'':`${params.has('model')?'URL':'本地偏好 / 默认'} model 不可用或未配置，请明确选择下次识别模型。`
 }}
}
