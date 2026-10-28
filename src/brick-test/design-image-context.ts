import {imageHistoryGroups,historyForImage} from '../brick-vision/image-history.mjs'
export type ImageAnalysis = {id:string;sourceImageId:string}
// URL scope is resolved only against the existing, verified History response.
// null means no explicit filter; '' explicitly means all images, including on reload.
export function designImageContext(records:ImageAnalysis[],analysisId='',requestedImageId:string|null=null){
 const groups=imageHistoryGroups(records)
 if(requestedImageId && !groups.some(g=>g.imageId===requestedImageId))throw Error('图片上下文没有可验证的 Analysis History；未推断关联')
 const analysis=records.find(a=>a.id===analysisId)
 if(analysisId&&!analysis){
  if(requestedImageId)throw Error('Analysis 无法验证属于当前 Source Image')
  return {imageId:requestedImageId??'',analysisId:'',warning:'该 Analysis 不在正式图片 History 中；仅可查看已有历史来源，不能作为当前审核输入。'}
 }
 if(analysis&&requestedImageId&&analysis.sourceImageId!==requestedImageId)throw Error('Analysis 与 Source Image 上下文不一致')
 return {imageId:requestedImageId??analysis?.sourceImageId??'',analysisId:analysis?.id??'',warning:''}
}
export function analysisInImage(records:ImageAnalysis[],imageId:string,analysisId:string){
 imageHistoryGroups(records)
 return historyForImage(records,imageId).some(a=>a.id===analysisId)
}
