import {readdir,open,lstat} from 'node:fs/promises'
import {constants} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {validateImage} from './brick-image-validation.mjs'
const defaultDirectory=fileURLToPath(new URL('../public/test-images/maganetic/',import.meta.url))
const types={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'}
const limit=6*1024*1024
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode})}
// Flat, allowlisted library. File bytes are snapshotted by the normal Source API.
export function createMagneticImageLibrary(directory=defaultDirectory){
 const mime=name=>types[path.extname(name).toLowerCase()]
 const allowed=name=>typeof name==='string'&&name.length<=255&&!name.startsWith('.')&&!/[\\/\x00-\x1f]/.test(name)&&!!mime(name)
 async function checkDirectory(){const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())fail('Server Library 目录无效')}
 return {
  async list(){
   await checkDirectory().catch(e=>{if(e.code!=='ENOENT')throw e})
   const entries=await readdir(directory,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e})
   return {images:entries.filter(e=>e.isFile()&&allowed(e.name)).map(e=>({name:e.name,mimeType:mime(e.name)})).sort((a,b)=>a.name.localeCompare(b.name))}
  },
  async read(name){
   if(!allowed(name))fail('无效的 Server Library 图片文件名')
   let handle
   try{
    await checkDirectory()
    handle=await open(path.join(directory,name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
    const stat=await handle.stat()
    if(!stat.isFile()||!stat.size||stat.size>limit)fail('请选择不超过 6 MB 的普通图片文件')
    // Bounded read also handles a file growing while it is being selected.
    const buffer=Buffer.alloc(limit+1);let size=0
    while(size<buffer.length){const r=await handle.read(buffer,size,buffer.length-size,null);if(!r.bytesRead)break;size+=r.bytesRead}
    const image=validateImage({mimeType:mime(name),imageBase64:buffer.subarray(0,size).toString('base64')})
    return {name,...image}
   }catch(e){if(e.code==='ENOENT')fail('图片已删除或改名，请刷新 Server Library',404);if(e.code==='ELOOP')fail('Server Library 不允许符号链接');throw e}
   finally{await handle?.close()}
  }
 }
}
