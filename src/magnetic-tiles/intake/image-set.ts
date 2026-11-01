import type {Source} from './contracts.ts'
export const imageRoles=['Unknown','Final','Step','Alternate View'] as const
export const imageDirections=['Unknown','Front','Back','Left','Right','Top','Oblique'] as const
export type AnalysisImage = {sourceId:string;sourceHash:string;name:string;view:Source['view'];origin:'upload'|'server'|'unknown';role:typeof imageRoles[number];direction:typeof imageDirections[number];note:string}
export function sourceImages(source:Source|null):AnalysisImage[]{return source?.images??(source?[{sourceId:source.id,sourceHash:source.hash,name:source.name,view:source.view,origin:'unknown',role:'Unknown',direction:'Unknown',note:''}]:[])}
export function assertImageMetadata(entries:unknown): asserts entries is AnalysisImage[]{
 if(!Array.isArray(entries)||entries.length<1||entries.length>4)throw Error('Analysis 需要 1–4 张图片')
 const ids=new Set<string>()
 for(const e of entries){if(!e||typeof e.sourceId!=='string'||typeof e.sourceHash!=='string'||typeof e.name!=='string'||!e.name.length||e.name.length>255||ids.has(e.sourceId)||!['upload','server','unknown'].includes(e.origin)||!imageRoles.includes(e.role)||!imageDirections.includes(e.direction)||typeof e.note!=='string'||e.note.length>500)throw Error('图片集合包含重复图片或无效元数据');ids.add(e.sourceId)}
}
export function assertImageEvidence(value:{referenceImageId?:string;observations: {outline?:unknown;imageEvidence?:{imageId:string;outline?:unknown}[]}[]},source:Source){
 const ids=new Set(sourceImages(source).map(e=>e.sourceId))
 if(value.referenceImageId!==undefined&&value.referenceImageId!==(source.primaryImageId??source.id))throw Error('参考图片来源不一致')
 if(source.images&&source.images.length>1&&value.referenceImageId!==source.primaryImageId)throw Error('参考图片来源不一致')
 for(const o of value.observations)if(o.imageEvidence){const seen=new Set<string>();for(const e of o.imageEvidence){if(!ids.has(e.imageId)||seen.has(e.imageId))throw Error('图片证据来源无效或重复');seen.add(e.imageId)}if(o.outline&&source.images&&source.images.length>1){const anchor=o.imageEvidence.find(e=>e.imageId===source.primaryImageId);if(!anchor||JSON.stringify(anchor.outline)!==JSON.stringify(o.outline))throw Error('二维主图轮廓必须与对应图片证据一致')}}
 if(source.images&&source.images.length>1&&value.observations.some(o=>!o.imageEvidence?.length))throw Error('多图识别的每个实例必须关联图片级证据')
}
