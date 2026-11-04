import {parseVisibleEvidence} from '../src/magnetic-tiles/three-d/reconstruction/contracts.ts'
import {assertImageEvidence} from '../src/magnetic-tiles/intake/image-set.ts'

// Root bbox/features are the contract's canonical reference-image annotations.
// Normalize only their duplicate alias, never another frame or an inferred pose.
// Raw output and the projection receipt are both immutable Analysis provenance.
export function prepareAnalysisEvidence(value,source){
 const mismatches=[],raw=parseVisibleEvidence(value,id=>mismatches.push(id))
 if(source)assertImageEvidence(raw,source)
 const evidence=structuredClone(raw),diagnostics=[]
 for(const id of mismatches){
  const o=evidence.observations.find(o=>o.id===id),anchor=o.imageEvidence?.find(e=>e.imageId===raw.referenceImageId)
  // A missing frame association cannot be manufactured from coordinates.
  if(!anchor)throw Error('主图坐标缺少对应图片证据关联，无法安全规范化')
  anchor.bbox=structuredClone(o.bbox);anchor.features=structuredClone(o.features)
  diagnostics.push({code:'reference_annotation_mismatch',observationId:id,imageId:raw.referenceImageId,severity:'warning',message:'主图重复标注不一致；Review 使用模型已声明的主图 bbox/features，原图片级标注保留在 Raw Evidence。'})
 }
 // Projection must satisfy the original strict contract. No weakening of
 // Review/Planning/Execution validation, no coordinate invention or repair.
 parseVisibleEvidence(evidence)
 return {evidence,...(mismatches.length?{rawEvidence:raw}:{}),analysisValidation:{version:1,policy:'reference-alias-v1',state:diagnostics.length?'reviewable':'valid',diagnostics}}
}

export function validateAnalysisEvidence(value,source){
 try{
  if(value?.version!==2)throw Error('本次模型请求需要 Visible 3D V2 契约；V1 仅供历史读取和人工导入')
  const {analysisValidation}=prepareAnalysisEvidence(value,source)
  return {valid:true,issues:[],...analysisValidation}
 }catch(e){return {valid:false,state:'blocked',issues:[e.message]}}
}
