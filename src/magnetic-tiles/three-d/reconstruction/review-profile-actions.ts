import type {Profile} from '../../geometry.ts'
import type {ReviewedPiece3D,VisibleEvidence3D,VisibleObservation3D,VisibleReview3D} from './contracts.ts'
import {editReviewedPiece} from './rebase-plan.ts'

type ProfileChoice={profileId:string;profileVersion:number}
/** Keep the model's order; the default single-item and batch action agree. */
export function availableAISuggestions(observation:VisibleObservation3D|undefined,profiles:readonly Profile[]){
 return (observation?.profileCandidates??[]).filter(c=>profiles.some(p=>p.id===c.profileId&&p.version===c.profileVersion))
}
export function acceptedProfilePatch(choice:ProfileChoice|null):Partial<ReviewedPiece3D>{
 return {profileId:choice?.profileId??null,profileVersion:choice?.profileVersion??null,confirmed:!!choice}
}
export function planAIReview(review:VisibleReview3D,evidence:VisibleEvidence3D,profiles:readonly Profile[]){
 const actions:{id:string;choice:ProfileChoice}[]=[],skips={excluded:0,confirmed:0,profile:0,noCandidate:0}
 for(const piece of review.pieces){
  if(piece.excluded){skips.excluded++;continue}
  if(piece.confirmed){skips.confirmed++;continue}
  // No provenance field is needed: preserve every existing reviewed Profile,
  // including a manual correction whose existence confirmation was revoked.
  if(piece.profileId!==null||piece.profileVersion!==null){skips.profile++;continue}
  const choice=availableAISuggestions(evidence.observations.find(o=>o.id===piece.id),profiles)[0]
  if(!choice){skips.noCandidate++;continue}
  actions.push({id:piece.id,choice:{profileId:choice.profileId,profileVersion:choice.profileVersion}})
 }
 return {actions,skips,adopted:actions.length,skipped:review.pieces.length-actions.length}
}
export function adoptAllAIReview(review:VisibleReview3D,evidence:VisibleEvidence3D,profiles:readonly Profile[]){
 const plan=planAIReview(review,evidence,profiles),changed=new Set(plan.actions.map(a=>a.id))
 let result=structuredClone(review)
 for(const action of plan.actions)result=editReviewedPiece(result,action.id,acceptedProfilePatch(action.choice))
 // Skipped instances stay byte-for-byte equivalent, including legacy metadata.
 result.pieces=result.pieces.map(p=>changed.has(p.id)?p:structuredClone(review.pieces.find(o=>o.id===p.id)!))
 return {...plan,review:result}
}
