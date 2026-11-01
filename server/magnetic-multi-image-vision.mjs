import {readFile} from 'node:fs/promises'
// Independent multi-image instruction. Existing single-image prompts stay byte-for-byte unchanged.
export const multiImagePromptVersion='magnetic-multi-image-analysis-v1.1-color-contract'
export const multiImagePrompt=`Analyze 2–4 magnetic-tile photographs jointly in ONE request. Follow the supplied analysisMode and its canonical output contract. Return ONE canonical inventory of physical tile instances in the target final state, not one inventory per image. The input lists stable image IDs, order, role (Final / Step / Alternate View / Unknown), direction and optional notes. Metadata are user hints, not proof. Use the designated referenceImageId for canonical image coordinates; prefer explicit Final. When roles are Unknown, infer cautiously and record unresolved chronology or target-state ambiguity.
COLOR CONTRACT: For EVERY observation, color MUST be a JSON string matching ^#[0-9a-fA-F]{6}$: exactly '#' followed by SIX hexadecimal digits. Example #12aB90 demonstrates format only, NEVER a default palette. Estimate an approximate observed body hue from the images, not an exact brand color. NEVER output names such as purple or blue, ambiguous labels such as red/pink, #RGB shorthand, alpha channels, RGB/HSL expressions, null or explanatory text in color. For ambiguous hues, transparency or lighting effects, still provide an approximate observed hex sample and explicitly preserve uncertainty in that observation's uncertainty/evidence; do not assert an exact hue. Never treat a textual color-name conversion or an example constant as a measured color.
Compare all frames before counting. Match the same physical tile across views/stages using outline, color, size, neighbors and construction context; color alone never proves identity. Keep one stable observation ID per physical tile. A tile may move or rotate between steps: do NOT merge step positions into the final structure, and do NOT add inventories of different stages. A piece visibly present in a step can support a final-occlusion hypothesis, but final membership requires evidence; preserve uncertainty about removals, replacements, counts or identity conflicts. Never invent unseen pieces to complete a familiar object, symmetry, enclosure or bottom.
For EVERY tile provide imageEvidence only for frames with actual visible evidence of that tile, each with imageId and normalized 0..1 TOP-LEFT coordinates in THAT image. Never put a box/polygon from one image onto another. referenceImageId is a supplied image ID. Canonical root bbox/features (3D) or outline (2D) refer ONLY to the reference image. For a 3D tile absent/fully hidden in that frame use bbox null and features []; retain real evidence from other frames. Distinguish direct observation, cross-frame identity inference, final-state spatial inference, uncertainty and alternatives. Internal bars/ribs/rims/reflections/transparent overlaps are not extra pieces. Features are one corner (one point) or a straight edge (two points); label estimated versus visible. No exact world XYZ/quaternion, no build steps, no claim of geometry validity or photo match.
Use the supplied authoritative versioned Profile Catalog. Reason about intrinsic shape under perspective separately from exact dimensions. Shape Family can be known while Exact Profile is Unknown. Never invent sizes or versions or force a catalog match. Final connections and fold angles must describe the target final arrangement; evidence observed only during a step is not automatically a final connection. Preserve competing explanations and unresolved constraints. Keep overall/hidden-structure hypotheses explanatory, never automatically add hypothetical hidden tiles.
3D output uses the existing Visible Evidence V2 and spatialInterpretation fields plus referenceImageId and per-observation imageEvidence (imageId,bbox,features,occlusion,evidence,uncertainty). Global interpretation evidenceRefs use canonical observation IDs or reference-image features; discuss other frame IDs in reasoning. 2D output uses existing planar evidence plus referenceImageId and imageEvidence (imageId,outline,evidence,uncertainty). Only tiles with an evidence-supported reference-image perimeter can supply canonical planar outlines. If perspective, final pose or reference boundary cannot be established, keep sourceKind unsupported and explain uncertainty; do not claim downstream planar reconstruction is safe. Preserve all distinguishable observations that can be located; unresolved unlocatable inventory belongs in reason rather than fabricated polygons. Return JSON only.`
export function multiImageSchema(base,kind,imageIds=[],referenceId=null){
 const schema=structuredClone(base);const str={type:'STRING'},obj=properties=>({type:'OBJECT',properties,required:Object.keys(properties)})
 schema.properties.referenceImageId=referenceId?{...str,enum:[referenceId]}:str;schema.required.push('referenceImageId')
 schema.properties.observations.maxItems=25
 const o=schema.properties.observations.items,p=o.properties
 // Replace the color node: base STRING nodes may be shared with IDs/text.
 p.color={...p.color,pattern:'^#[0-9a-fA-F]{6}$',minLength:7,maxLength:7,description:'Approximate observed body hue as #RRGGBB, exactly six hexadecimal digits. Names/ambiguous labels are invalid; explain uncertainty in uncertainty/evidence.'}
 const e=kind==='3d'?{imageId:imageIds.length?{...str,enum:imageIds}:str,bbox:p.bbox,features:p.features,occlusion:str,evidence:str,uncertainty:str}:{imageId:imageIds.length?{...str,enum:imageIds}:str,outline:p.outline,evidence:str,uncertainty:str}
 p.imageEvidence={type:'ARRAY',minItems:1,maxItems:4,items:obj(e)};o.required.push('imageEvidence');return schema
}
// Multi-image only. Keep single-image contracts and the shared DUPLO adapter unchanged.
export function openaiMultiImageFormat(schema,name='magnetic_multi_image_observation'){
 function lower(node){
  const {nullable,type,...rest}=node
  const value={...rest,type:type.toLowerCase()}
  if(node.properties){value.properties=Object.fromEntries(Object.entries(node.properties).map(([key,child])=>[key,lower(child)]));value.additionalProperties=false}
  if(node.items)value.items=lower(node.items)
  // OpenAI JSON Schema uses an explicit null alternative, not Gemini nullable.
  return nullable?{anyOf:[value,{type:'null'}]}:value
 }
 return {type:'json_schema',name,strict:true,schema:lower(schema)}
}
export function imageRequestParts(images){return images.flatMap((image,i)=>[{text:JSON.stringify({imageIndex:i+1,imageId:image.sourceId,name:image.name,width:image.width,height:image.height,role:image.role,direction:image.direction,note:image.note})},{inlineData:{mimeType:image.mimeType,data:image.imageBase64}}])}
export function openaiImageParts(images){return imageRequestParts(images).map(p=>p.text?{type:'input_text',text:p.text}:{type:'input_image',image_url:'data:'+p.inlineData.mimeType+';base64,'+p.inlineData.data,detail:'high'})}

const sourceFile=new URL(import.meta.url),loaded=await readFile(sourceFile,'utf8')
export async function multiImagePromptStatus(){return {current:loaded===await readFile(sourceFile,'utf8')}}
