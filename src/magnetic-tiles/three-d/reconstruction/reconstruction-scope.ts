import type {Source} from '../../intake/contracts.ts'
import {sourceImages} from '../../intake/image-set.ts'
import {validateVisibleInput} from './contracts.ts'
import type {VisibleInput3D} from './contracts.ts'
import type {ModulePlanRecord} from './module-plan.ts'

/** Optional provenance on the existing Plan/Execution, never a second geometry model. */
export type ReconstructionScope={version:1;groupId:string;groupName:string;imageId:string;imageName:string;observationIds:string[];groupObservationIds?:string[];modulePlan?:{id:string;hash:string}}
export type ReconstructionSelection={groupId?:string;imageId?:string}
export function subsetVisibleInput(input:VisibleInput3D,ids:readonly string[]):VisibleInput3D{
    const keep=new Set(ids),result=structuredClone(input)
    if(keep.size!==ids.length||ids.some(id=>!input.review.pieces.some(p=>p.id===id)))throw Error('重建范围包含未知或重复 Observation')
    result.evidence.observations=result.evidence.observations.filter(o=>keep.has(o.id))
    result.review.pieces=result.review.pieces.filter(p=>keep.has(p.id))
    result.review.constraints=result.review.constraints.filter(c=>keep.has(c.pieceA)&&keep.has(c.pieceB)).map(c=>({...c,evidenceRefs:c.evidenceRefs.filter(r=>keep.has(r.split(':')[0]))}))
    if(result.review.spatialChecks)result.review.spatialChecks=result.review.spatialChecks.filter(c=>keep.has(c.pieceA)&&keep.has(c.pieceB)).map(c=>({...c,evidenceRefs:c.evidenceRefs.filter(r=>keep.has(r.split(':')[0]))}))
    const used=new Set(result.review.pieces.filter(p=>p.profileId!==null).map(p=>`${p.profileId}@${p.profileVersion}`))
    result.profiles=result.profiles.filter(s=>used.has(`${s.profile.id}@${s.profile.version}`))
    const spatial=result.evidence.spatialInterpretation
    if(spatial){
        const refs=(values:string[])=>values.filter(r=>keep.has(r.split(':')[0]))
        spatial.faces=spatial.faces.filter(f=>keep.has(f.pieceId)).map(f=>({...f,evidenceRefs:refs(f.evidenceRefs)}))
        spatial.connections=spatial.connections.filter(c=>keep.has(c.pieceA)&&keep.has(c.pieceB)).map(c=>({...c,evidenceRefs:refs(c.evidenceRefs)}))
        spatial.overallShapeHypotheses=spatial.overallShapeHypotheses.filter(h=>h.visiblePieceIds.every(id=>keep.has(id))).map(h=>({...h,evidenceRefs:refs(h.evidenceRefs)}))
        spatial.alternatives=spatial.alternatives.filter(a=>a.evidenceRefs.every(r=>keep.has(r.split(':')[0])))
    }
    return validateVisibleInput(result)
}
export function reconstructionInput(input:VisibleInput3D,source:Source,selection:ReconstructionSelection={},modulePlan:ModulePlanRecord|null=null){
    const groupId=selection.groupId??'all',imageId=selection.imageId??'all',images=sourceImages(source)
    const group=groupId==='all'?null:modulePlan?.modules.find(m=>m.id===groupId)
    if(groupId!=='all'&&!group)throw Error('所选模块不存在，请选择当前模块')
    const image=imageId==='all'?null:images.find(i=>i.sourceId===imageId)
    if(imageId!=='all'&&!image)throw Error('所选图片不属于当前来源')
    const members=new Set(group?.observationIds??input.review.pieces.map(p=>p.id))
    const admitted=input.review.pieces.filter(p=>p.confirmed&&!p.excluded&&members.has(p.id))
    const observations=new Map(input.evidence.observations.map(o=>[o.id,o])),allowedImages=new Set(image?[image.sourceId]:images.map(i=>i.sourceId))
    const ids=admitted.filter(p=>{
        const o=observations.get(p.id)!
        return o.imageEvidence?o.imageEvidence.some(e=>allowedImages.has(e.imageId)&&(e.bbox!==null||e.features.length>0)):allowedImages.has(source.primaryImageId??source.id)&&(o.bbox!==null||o.features.length>0)
    }).map(p=>p.id)
    const scope:ReconstructionScope={version:1,groupId,groupName:group?.name??'全部模块',imageId,imageName:image?.name??'所有图片',observationIds:ids,groupObservationIds:[...members].sort(),...(group&&modulePlan?{modulePlan:{id:modulePlan.id,hash:modulePlan.hash}}:{})}
    return {scope,input:subsetVisibleInput(input,ids),groupCount:admitted.length}
}
/** Only an explicit compatible input scope can supply a current result. */
export function reconstructionScopeMatches(saved:ReconstructionScope|undefined,current:ReconstructionScope|null,_unused?:readonly string[]){
    if(!saved||!current)return false
    return saved.version===1&&saved.groupId===current.groupId&&saved.imageId===current.imageId&&
      JSON.stringify([...(saved.groupObservationIds??[])].sort())===JSON.stringify([...(current.groupObservationIds??[])].sort())&&
      JSON.stringify([...saved.observationIds].sort())===JSON.stringify([...current.observationIds].sort())
}
