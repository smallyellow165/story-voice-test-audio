import {mkdir,readdir,readFile,writeFile,link,unlink} from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {canonical} from '../src/magnetic-tiles/build-plan.ts'

const fail=(message,statusCode=422)=>{throw Object.assign(Error(message),{statusCode})}
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex')
const isHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
function reference(value){
 if(!value||Object.keys(value).some(k=>!['id','version','hash'].includes(k))||typeof value.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value.id)||['__proto__','constructor','prototype'].includes(value.id)||!Number.isSafeInteger(value.version)||value.version<1||!isHash(value.hash))fail('需要明确的 Saved Assembly ID、Version 和 Hash')
 return {id:value.id,version:value.version,hash:value.hash}
}

/** Display metadata only. Geometry remains in the append-only Assembly library. */
export function createMagneticGallery(directory,{readAssembly}){
 const file=id=>{if(!isHash(id))fail('Gallery ID 无效');return path.join(directory,id+'.json')}
 function record(item){
  if(!item||item.schemaVersion!==1||typeof item.description!=='string'||!item.description.trim()||item.description.length>500||typeof item.createdAt!=='string'||item.id!==digest(reference(item.assemblyRef)))fail('Gallery 记录损坏',409)
  return item
 }
 async function readItem(id){return record(JSON.parse(await readFile(file(id),'utf8')))}
 async function resolve(ref){
  const r=reference(ref),saved=await readAssembly(r.id,r.version)
  if(!saved)fail('Saved Assembly 固定版本不存在',404)
  if(saved.hash!==r.hash)fail('Saved Assembly 固定版本 Hash 不一致',409)
  return saved
 }
 return {async dispatch(method,route,body={}){
  if(method==='GET'&&route==='items'){
   const names=await readdir(directory).catch(e=>{if(e.code==='ENOENT')return [];throw e}),items=[],warnings=[]
   for(const name of names.filter(n=>/^[a-f0-9]{64}\.json$/.test(n)))try{
    const item=await readItem(name.slice(0,-5));if(item.id!==name.slice(0,-5))fail('Gallery 身份不一致',409);items.push(item)
   }catch(e){warnings.push({id:name.slice(0,-5),error:e.message})}
   return {items:items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)),warnings}
  }
  if(method==='GET'&&/^items\/[a-f0-9]{64}$/.test(route)){
   const id=route.slice(6),item=await readItem(id);if(item.id!==id)fail('Gallery 身份不一致',409)
   const saved=await resolve(item.assemblyRef)
   // Opening never restores editor state, consults Selected lineage or rebuilds parents.
   return {item,assembly:saved.snapshot.assembly,cameraView:saved.snapshot.photoOrigin?.cameraView??null}
  }
  if(method==='GET'&&/^edit-context\/[a-f0-9]{64}$/.test(route)){
   const item=await readItem(route.slice(13)),saved=await resolve(item.assemblyRef)
   const head=await readAssembly(item.assemblyRef.id)
   return {item,saved,saveHead:{id:head.assembly.id,version:head.version,hash:head.hash}}
  }
  if(method==='POST'&&route==='publish'){
   if(!body||Object.keys(body).some(k=>!['description','assemblyRef'].includes(k))||typeof body.description!=='string'||!body.description.trim()||body.description.length>500)fail('请填写 1–500 个字符的作品描述')
   const assemblyRef=reference(body.assemblyRef),saved=await resolve(assemblyRef)
   if(!saved.snapshot.assembly.pieces.length)fail('空 Assembly 不能加入 Gallery')
   const item={schemaVersion:1,id:digest(assemblyRef),description:body.description.trim(),assemblyRef,createdAt:new Date().toISOString()}
   await mkdir(directory,{recursive:true})
   const target=file(item.id),temp=target+'.'+randomUUID()+'.tmp'
   try{
    await writeFile(temp,JSON.stringify(item,null,2),{flag:'wx',mode:0o600})
    try{await link(temp,target)}catch(e){if(e.code!=='EEXIST')throw e;return {item:await readItem(item.id),created:false}}
   }finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e})}
   return {item,created:true}
  }
  fail('未知 Gallery 操作',404)
 }}
}
