import {mkdir,readFile,readdir,writeFile,rename,unlink} from 'node:fs/promises'
import {randomUUID,createHash} from 'node:crypto'
import path from 'node:path'
import {loadBrickRules} from './brick-rules.mjs'
import {brickLibraryRoot} from './brick-library.mjs'
const fail=(s,code=422)=>{throw Object.assign(Error(s),{statusCode:code})}
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s)
const check=(ok,s)=>{if(!ok)fail(s)}
export function aggregateGalleryParts(source,rules,colors){
 const groups=new Map()
 for(const b of source.assembly.bricks){
  const identity=source.identities.find(i=>i.id===b.id),part=rules.PARTS.find(p=>p.id===b.part),color=colors.get(b.color)
  check(identity&&part&&color,'零件来源、Geometry Profile 或正式颜色缺失')
  const key=JSON.stringify([identity.partNumber,b.part,b.color])
  if(!groups.has(key))groups.set(key,{partNumber:identity.partNumber,geometryPart:b.part,name:part.label,colorCode:b.color,colorName:color.name,colorHex:color.hex,quantity:0})
  groups.get(key).quantity++
 }
 return [...groups.values()]
}
export function createGalleryStore(directory,{buildOrder,reverse,sourceImages,selectedSpatial,loadRules=loadBrickRules}){
 const folder=path.join(directory,'brick-gallery')
 const file=id=>{check(uuid(id),'Gallery ID 无效');return path.join(folder,id+'.json')}
 const readJson=async f=>JSON.parse(await readFile(f,'utf8'))
 async function records(){return (await readdir(folder).catch(e=>{if(e.code==='ENOENT')return [];throw e})).filter(f=>uuid(f.slice(0,-5))&&f.endsWith('.json'))}
 function metadata(value){
  check(typeof value.title==='string'&&value.title.trim().length>0&&value.title.length<=80,'名称需要 1–80 个字符')
  check(typeof value.description==='string'&&value.description.length<=500,'介绍最多 500 个字符')
  check(value.cover?.kind==='source-image'&&typeof value.cover.imageId==='string','请选择正式 Source Image 封面')
  return {title:value.title.trim(),description:value.description,cover:{kind:'source-image',imageId:value.cover.imageId}}
 }
 function record(value){
  check(value.schemaVersion===1&&uuid(value.id)&&uuid(value.layoutSelectionId)&&(value.buildPlanId===null||uuid(value.buildPlanId))&&Number.isSafeInteger(value.revision)&&value.revision>0&&typeof value.createdAt==='string'&&typeof value.updatedAt==='string','Gallery 正式记录无效')
  metadata(value);return value
 }
 async function resolve(layoutSelectionId,buildPlanId){
  check(uuid(layoutSelectionId)&&(buildPlanId===null||uuid(buildPlanId)),'需要明确的 Layout / Build Plan ID')
  const loaded=await buildOrder.readForGallery(layoutSelectionId,buildPlanId)
  const {geometryEvidence,...source}=loaded.source
  check(source.id===layoutSelectionId,'Build Plan 与 Gallery Layout 不一致')
  if(buildPlanId)check(loaded.validation.valid&&loaded.validation.complete,'Build Plan 必须正式保存且完整；不能使用临时或不完整草稿')
  const scope=await selectedSpatial.inspect(source.planId)
  check(scope.eligible&&scope.identity.analysisId===source.analysisId,'Layout 的 Spatial / Analysis 来源不一致或无效')
  const spatial=await readJson(path.join(directory,'brick-spatial-traces',source.planId+'.json'))
  const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
  check(geometryEvidence.version==='geometry-execution-v1'&&!geometryEvidence.revisionId,'此布局的修订来源尚不能完整验证')
  check(geometryEvidence.sourcePlan&&geometryEvidence.sourceInput&&hash(geometryEvidence.sourcePlan)===source.sourcePlanHash&&hash(spatial.plan)===source.sourcePlanHash&&hash(geometryEvidence.sourceInput)===hash(spatial.requestInput),'Geometry 实际输入与 Spatial 的正式来源不一致或缺失')
  check(new Set(geometryEvidence.candidateIds).size===geometryEvidence.candidateIds.length,'Geometry Candidate 身份重复')
  const rules=await loadRules(),geometry=rules.validateFinalAssembly(source.assembly.bricks)
  check(geometry.valid,'布局未通过当前 Geometry Validator')
  const config=await readFile(path.join(brickLibraryRoot(),'LDConfig.ldr'),'utf8'),colors=new Map()
  for(const match of config.matchAll(/^0\s+!COLOUR\s+(\S+)\s+CODE\s+(\d+)\s+VALUE\s+(#[a-f0-9]{6})\b/gmi))colors.set(match[2],{name:match[1].replaceAll('_',' '),hex:match[3]})
  return {source,plan:loaded?.plan??null,sourceImageId:scope.identity.sourceImageId,parts:aggregateGalleryParts(source,rules,colors),brickCount:source.assembly.bricks.length,stepCount:loaded.plan?.steps.length??0,canBuild:!!loaded.plan}
 }
 async function detail(id){const item=record(await readJson(file(id)));check(item.id===id,'Gallery 地址与身份不一致');const resolved=await resolve(item.layoutSelectionId,item.buildPlanId);await sourceImages.read(item.cover.imageId);return {item,...resolved}}
 async function save(body){
  const display=metadata(body),creating=body.id===undefined
  check(creating?body.expectedRevision===null:Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision>0,'需要明确的保存版本')
  await mkdir(folder,{recursive:true});const lock=path.join(folder,'write.lock')
  try{await writeFile(lock,JSON.stringify({pid:process.pid}),{flag:'wx'})}catch(e){if(e.code==='EEXIST')fail('Gallery 正在保存，请重试；持续冲突需检查锁文件',409);throw e}
  try{
   let old=null
   if(!creating){old=record(await readJson(file(body.id)));check(old.id===body.id,'Gallery 地址与身份不一致');if(old.revision!==body.expectedRevision)fail('作品已被其他页面修改，请重新打开后保存',409);check(body.layoutSelectionId===old.layoutSelectionId&&body.buildPlanId===old.buildPlanId,'展示编辑不能更换作品来源')}
   await resolve(body.layoutSelectionId,body.buildPlanId);await sourceImages.read(display.cover.imageId)
   if(creating)for(const name of await records()){
    const existing=record(await readJson(path.join(folder,name)));check(existing.id===name.slice(0,-5),'Gallery 地址与身份不一致')
    if(existing.layoutSelectionId===body.layoutSelectionId&&existing.buildPlanId===body.buildPlanId)return {item:existing,created:false}
   }
   const now=new Date().toISOString(),item={schemaVersion:1,id:old?.id??randomUUID(),layoutSelectionId:body.layoutSelectionId,buildPlanId:body.buildPlanId,...display,revision:(old?.revision??0)+1,createdAt:old?.createdAt??now,updatedAt:now}
   const target=file(item.id),temp=target+'.'+randomUUID()+'.tmp'
   try{await writeFile(temp,JSON.stringify(item,null,2),{flag:'wx'});await rename(temp,target)}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e})}
   return {item,created:creating}
  }finally{await unlink(lock)}
 }
 return {detail,resolve,save,async list(){const items=[],warnings=[];for(const name of await records())try{const d=await detail(name.slice(0,-5));items.push({item:d.item,brickCount:d.brickCount,stepCount:d.stepCount,canBuild:d.canBuild})}catch(e){warnings.push({id:name.slice(0,-5),error:e.message})}return {items,warnings}},async cover(id){const item=record(await readJson(file(id)));check(item.id===id,'Gallery 地址与身份不一致');return (await sourceImages.read(item.cover.imageId)).original}}
}
