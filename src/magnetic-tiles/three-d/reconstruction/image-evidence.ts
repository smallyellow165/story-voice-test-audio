import type {VisibleEvidence3D} from './contracts.ts'
export function evidenceForImage(evidence:VisibleEvidence3D|undefined,imageId:string,referenceId:string):VisibleEvidence3D|undefined{
 if(!evidence)return undefined
 return {...evidence,observations:evidence.observations.flatMap(o=>{
  if(!o.imageEvidence)return imageId===referenceId?[o]:[]
  const e=o.imageEvidence.find(e=>e.imageId===imageId);return e?[{...o,bbox:e.bbox,features:e.features,occlusion:e.occlusion,evidence:e.evidence,uncertainty:e.uncertainty}]:[]
 })}
}
