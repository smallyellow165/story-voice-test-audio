import {createHash} from 'node:crypto'
import {planningReview} from '../src/brick-vision/review-parts.mjs'
import {prepareInput} from '../experiments/spatial-planning/input.mjs'
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail=(message,statusCode=422)=>{throw Object.assign(Error(message),{statusCode})}
export function reviewedSource(saved){
 const effective=planningReview(saved),rows=effective.rows
 const errors=[...effective.errors]
 if(saved.analysis.status!=='complete'||!saved.updatedAt)errors.push('需要已完成 Analysis 和已保存人工审核')
 if(!rows.some(r=>!r.excluded))errors.push('没有可用识别项')
 for(const r of rows.filter(r=>!r.excluded))if(!r.confirmedPart||r.quantity!==1)errors.push(r.id+'：需确认型号/颜色，且每个 Observation 恰好一块（V1 不猜测重复实例位置）')
 return {analysisId:saved.analysis.id,updatedAt:saved.updatedAt,rows,errors,ready:!errors.length,reviewVersion:hash({updatedAt:saved.updatedAt,rows,hiddenParts:effective.hiddenParts,manualRelations:effective.manualRelations}),warnings:saved.warnings||[]}
}
export function prepareReviewedSource(saved,mapping,rules,includeEvidence=true,allowUnknownGeometry=false){
 const source=reviewedSource(saved);if(!source.ready)fail(source.errors.join('；'),422)
 const effective=planningReview(saved)
 const kept=new Set(source.rows.filter(r=>!r.excluded).map(r=>r.id))
 const analysis={...saved.analysis,analysis:{...saved.analysis.analysis,observations:effective.observations.filter(o=>kept.has(o.id)),relations:(saved.analysis.analysis.relations||[]).filter(r=>kept.has(r.from)&&kept.has(r.to))}}
 const inventory=new Map()
 for(const m of mapping.mapping.rows){if(!m.target||m.errors.length)fail('正式 Mapping 不可用：'+m.source.part_num+' / RB Color '+m.source.color_id+'：'+m.errors.join('；'),422);const key=m.target.part+':'+m.target.color;const row=inventory.get(key)||{part:m.target.part,color:m.target.color,quantity:0};row.quantity+=m.source.quantity;inventory.set(key,row)}
 // Adapt the saved Review + official Mapping snapshot to the existing audited input builder.
 // This is not a legacy schema fallback and does not use any prior LLM placement.
 const snapshot={id:mapping.id,reference:{analysisId:analysis.id,review:Object.fromEntries(source.rows.filter(r=>!r.excluded).map(r=>[r.id,r]))},inventorySource:{reviewId:mapping.id,mapping:mapping.mapping.rows},requestInput:{inventory:[...inventory.values()]}}
 const prepared=prepareInput(analysis,snapshot,rules,{includeEvidence,allowUnknownGeometry})
 const byId=new Map(effective.observations.map(o=>[o.id,o]))
 prepared.input.observations=prepared.input.observations.map(o=>{
   const provenance=byId.get(o.id).provenance
   if(provenance.source==='manual'){
     if(!o.geometry)fail('人工隐藏零件缺少已审核 Geometry Profile：'+o.id,422)
     const {visionEvidence,...confirmed}=o
     return {...confirmed,provenance}
   }
   return {...o,provenance}
 })
 if(includeEvidence)prepared.input.analysis={...saved.analysis.analysis,observations:saved.analysis.analysis.observations.filter(o=>kept.has(o.id)),relations:analysis.analysis.relations}
 prepared.input.manualRelations=effective.manualRelations
 prepared.input.manualReviewGuidance='Instances with provenance.source=manual are human-confirmed hidden parts, not photo observations. Include every supplied instance exactly once; do not invent a BBox or observed image evidence for hidden parts. manualRelations are human structural hints. symmetric has no specified axis or exact mirror plane: infer poses and interfaces from the photo and reviewed geometry, explain ambiguity/conflicts, and do not treat this hint as a verified connector or automatic hard coordinate constraint. fromInstanceIds/toInstanceIds identify the members of each review row; when quantities exceed one, determine and explain the correspondence rather than assuming all-to-all mating. Geometry Execution remains the authority for physical validation.'
 prepared.input.provenance={analysisId:analysis.id,reviewId:mapping.id,reviewVersion:source.reviewVersion,savedReviewAt:source.updatedAt,excludedIds:source.rows.filter(r=>r.excluded).map(r=>r.id),mappingSource:'saved Part Explorer review + official inventory mapping review'}
 return prepared
}
