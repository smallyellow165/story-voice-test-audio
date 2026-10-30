// Production bundle + real Magnetic API, with a private copy of persisted data.
// Test profiles/snapshots never reach the user's registry or historical records.
import http from 'node:http'
import {cp,mkdtemp,readFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
export async function startMagneticSandbox(){
 const root=fileURLToPath(new URL('../dist/',import.meta.url)),directory=await mkdtemp(path.join(os.tmpdir(),'magnetic-browser-'))
 await cp(new URL('../generated/magnetic-intake/',import.meta.url),directory,{recursive:true})
 const api=createMagneticIntake(directory),calls={recognize:0},mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.wasm':'application/wasm'}
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost')
   if(url.pathname.startsWith('/api/magnetic-intake/')){
    const route=url.pathname.slice('/api/magnetic-intake/'.length)
    if(route==='recognize'){calls.recognize++;throw Object.assign(Error('Paid calls disabled in isolated acceptance'),{statusCode:403})}
    let bytes='';for await(const chunk of req){bytes+=chunk;if(bytes.length>18*1024*1024)throw Error('Body too large')}
    const data=await api.dispatch(req.method,route,bytes?JSON.parse(bytes):{})
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));return
   }
   const name=decodeURIComponent(url.pathname).replace(/^\/story-voice-test-audio\//,'/'),file=path.resolve(root,'.'+name)
   if(!file.startsWith(root))throw Object.assign(Error('Forbidden'),{statusCode:403})
   const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data)
  }catch(e){res.writeHead(e.code==='ENOENT'?404:e.statusCode||422,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}))}
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 return {origin:`http://127.0.0.1:${server.address().port}`,directory,calls,close:async()=>{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true})}}
}
