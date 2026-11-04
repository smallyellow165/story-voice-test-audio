import {readdir,open} from 'node:fs/promises'
import {constants} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {validateImage} from './brick-image-validation.mjs'
const defaultDirectory=fileURLToPath(new URL('../public/test-images/maganetic/',import.meta.url))
const types={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'}
const limit=6*1024*1024
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode})}
const segment=s=>!!s&&!s.startsWith('.')&&!/[\\/\x00-\x1f\x7f]/.test(s)
const relative=name=>typeof name==='string'&&name.length>0&&name.length<=255&&!path.posix.isAbsolute(name)&&!/^[a-z]:/i.test(name)&&name.split('/').every(segment)
const dirFlags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW
// Linux directory descriptors provide openat-style traversal with Node's fs API.
// Each untrusted component is opened separately with NOFOLLOW. A directory swap
// between discovery and read cannot redirect an already opened parent descriptor.
const at=(handle,name)=>'/proc/self/fd/'+handle.fd+'/'+name
export function createMagneticImageLibrary(directory=defaultDirectory){
 const root=path.resolve(directory),mime=name=>types[path.posix.extname(name).toLowerCase()],allowed=name=>relative(name)&&!!mime(name)
 async function openRoot(){
  let handle=await open('/',dirFlags)
  try{for(const part of root.split('/').filter(Boolean)){const next=await open(at(handle,part),dirFlags);await handle.close();handle=next}return handle}
  catch(e){await handle.close();throw e}
 }
 return {
  async list(){
   const images=[],folders=[]
   async function walk(handle,prefix=''){
    const entries=await readdir('/proc/self/fd/'+handle.fd,{withFileTypes:true})
    for(const entry of entries){
     const name=prefix+entry.name
     if(!relative(name))continue
     if(entry.isFile()&&allowed(name))images.push({name,mimeType:mime(name)})
     else if(entry.isDirectory()){
      let child
      try{child=await open(at(handle,entry.name),dirFlags)}catch(e){if(['ENOENT','ENOTDIR','ELOOP','EACCES'].includes(e.code))continue;throw e}
      try{folders.push(name);await walk(child,name+'/')}finally{await child.close()}
     }
     // Symlinks (including links to directories inside the library) are not inputs.
    }
   }
   let handle
   try{handle=await openRoot();await walk(handle)}catch(e){if(e.code==='ENOENT'&&!handle)return {images:[],folders:[]};if(['ELOOP','ENOTDIR'].includes(e.code))fail('Server Library 不允许符号链接或非目录路径');throw e}finally{await handle?.close()}
   return {images:images.sort((a,b)=>a.name.localeCompare(b.name)),folders:folders.sort((a,b)=>a.localeCompare(b))}
  },
  async read(name){
   if(!allowed(name))fail('无效的 Server Library 图片相对路径')
   let directoryHandle,handle
   try{
    directoryHandle=await openRoot()
    const parts=name.split('/'),filename=parts.pop()
    for(const part of parts){const next=await open(at(directoryHandle,part),dirFlags);await directoryHandle.close();directoryHandle=next}
    handle=await open(at(directoryHandle,filename),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
    const stat=await handle.stat()
    if(!stat.isFile()||!stat.size||stat.size>limit)fail('请选择不超过 6 MB 的普通图片文件')
    // Bounded read also handles a file growing while it is being selected.
    const buffer=Buffer.alloc(limit+1);let size=0
    while(size<buffer.length){const r=await handle.read(buffer,size,buffer.length-size,null);if(!r.bytesRead)break;size+=r.bytesRead}
    const image=validateImage({mimeType:mime(name),imageBase64:buffer.subarray(0,size).toString('base64')})
    return {name,...image}
   }catch(e){if(e.code==='ENOENT')fail('图片已删除或改名，请刷新 Server Library',404);if(['ELOOP','ENOTDIR'].includes(e.code))fail('Server Library 不允许符号链接或非目录路径');throw e}
   finally{await handle?.close();await directoryHandle?.close()}
  }
 }
}
