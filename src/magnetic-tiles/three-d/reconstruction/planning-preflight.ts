import type {VisibleReview3D} from './contracts.ts'
/** Same participant rule as Spatial Hypothesis validation. Exact Profile Unknown
 * remains allowed; it does not confirm an instance or invent its dimensions. */
export function planningParticipation(review:VisibleReview3D){
 const pieces=review.pieces.filter(p=>p.confirmed&&!p.excluded)
 return {total:review.pieces.length,confirmed:pieces.length,knownProfiles:pieces.filter(p=>p.profileId!==null).length,ids:pieces.map(p=>p.id),
  blocker:pieces.length?null:`无法执行：0/${review.pieces.length} 个实例已确认，请返回 Review 完成确认并保存。`}
}
