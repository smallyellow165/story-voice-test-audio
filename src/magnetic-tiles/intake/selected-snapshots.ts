import type { IntakeHistory, SelectedSnapshot, SelectedStage } from './contracts.ts'

export function selectedFor(history: IntakeHistory, sourceId: string, stage: SelectedStage): SelectedSnapshot {
 return history.selectedSnapshots.find(s=>s.sourceId===sourceId&&s.stage===stage)??{schemaVersion:1,sourceId,stage,snapshotId:null,revision:0,updatedAt:null,valid:true}
}
export function selectedFirst<T extends {id:string}>(snapshots:readonly T[],selectedId:string|null):T[]{
 // Stable partition: retain the server's existing time order for every other row.
 return [...snapshots.filter(s=>s.id===selectedId),...snapshots.filter(s=>s.id!==selectedId)]
}
export function sourceReviews(history:IntakeHistory,sourceId:string){
 const analyses=new Set(history.analyses.filter(a=>a.sourceId===sourceId).map(a=>a.id))
 return history.reviews.filter(r=>analyses.has(r.analysisId))
}

export function resolveSelectedDefaults(history:IntakeHistory,sourceId:string,stage:string,hasDraft:(analysisId:string)=>boolean):{analysisId?:string;reviewId?:string;draftBlocked?:boolean}{
 if(!['source','review','reconstruction'].includes(stage))return {}
 const pending=history.analyses.find(a=>a.sourceId===sourceId&&hasDraft(a.id))
 // Preserve the existing explicit local-draft recovery action; never replace it
 // with a Selected Review or silently apply draft content over a saved snapshot.
 if(pending)return {analysisId:pending.id,draftBlocked:true}
 const order:SelectedStage[]=stage==='source'?['analysis','review']:['review','analysis']
 for(const kind of order){
  const selection=selectedFor(history,sourceId,kind)
  if(!selection.valid)throw Error(selection.error||`Selected ${kind} 无效；未选择其他版本`)
  if(!selection.snapshotId)continue
  if(kind==='review'){
   const review=history.reviews.find(r=>r.id===selection.snapshotId),analysis=history.analyses.find(a=>a.id===review?.analysisId)
   if(!review||!analysis||analysis.sourceId!==sourceId||analysis.hash!==review.analysisHash)throw Error('Selected Review 来源不完整；未选择其他版本')
   return {reviewId:review.id,analysisId:analysis.id}
  }
  const analysis=history.analyses.find(a=>a.id===selection.snapshotId)
  if(!analysis||analysis.sourceId!==sourceId)throw Error('Selected Analysis 来源不完整；未选择其他版本')
  return {analysisId:analysis.id}
 }
 return {}
}

export function mergeSelectedHistory(previous:IntakeHistory,next:IntakeHistory):IntakeHistory {
 return {...next,selectedSnapshots:next.selectedSnapshots.map(incoming=>{
  const prior=previous.selectedSnapshots.find(s=>s.sourceId===incoming.sourceId&&s.stage===incoming.stage)
  return prior?.revision!=null&&incoming.revision!=null&&prior.revision>incoming.revision?prior:incoming
 })}
}
