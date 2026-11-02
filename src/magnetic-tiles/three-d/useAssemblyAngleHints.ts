import {useEffect,useState} from 'react'
import {intakeApi} from '../intake/api.ts'
import type {Assembly3D} from './assembly.ts'
import type {PhotoOrigin3D} from './reconstruction/adopt-draft.ts'
import type {VisibleInput3D} from './reconstruction/contracts.ts'
import {angleHintSourceKey,bindAngleHintSource} from './assembly-angle-hints.ts'
import type {AngleHintSource,AnglePlanRecord,AngleExecutionRecord,AngleRefinementRecord} from './assembly-angle-hints.ts'
export type AssemblyAngleHintLoad={key:string;source?:AngleHintSource;error?:string}
/** One immutable-source read shared by hint display and explicit repair search. */
export function useAssemblyAngleHints(assembly:Assembly3D,origin:PhotoOrigin3D|null,active:boolean):AssemblyAngleHintLoad{
 const key=active?angleHintSourceKey(assembly,origin):'', [loaded,setLoaded]=useState<AssemblyAngleHintLoad>({key:''})
 useEffect(()=>{
  let alive=true
  if(!key||!origin)return
  const o=origin.origin,read=<T,>(route:string)=>intakeApi<{record:T}>(route).then(r=>r.record)
  let inFlight=false;const update=()=>{if(inFlight)return;inFlight=true;return Promise.all([intakeApi<Record<string,unknown>>(`visible3d/selected-origin/${encodeURIComponent(String(o.id))}`),intakeApi<{record:AnglePlanRecord;geometryReview:{input:VisibleInput3D}}>(`visible3d/plans/${encodeURIComponent(String(o.planId))}`),read<AngleExecutionRecord>(`visible3d/executions/${encodeURIComponent(String(o.executionId))}`),o.refinement?read<AngleRefinementRecord>(`visible3d/refinements/${encodeURIComponent(String((o.refinement as {id:string}).id))}`):undefined])
   .then(async([stored,plan,execution,refinement])=>{
    const source=bindAngleHintSource(origin,stored,plan.record,execution,refinement);source.reviewInput=plan.geometryReview?.input
    if(alive)setLoaded({key,source})
   })
   .catch(e=>{if(alive)setLoaded({key,error:String(e)})}).finally(()=>{inFlight=false})}
  void update();const timer=window.setInterval(()=>void update(),3000);window.addEventListener('focus',update);return()=>{alive=false;window.clearInterval(timer);window.removeEventListener('focus',update)}
 },[key])
 return key&&loaded.key===key?loaded:{key}
}
