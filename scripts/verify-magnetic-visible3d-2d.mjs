// Run the legacy Review browser suite ONLY against a temporary copy of its one fixture.
// The legacy suite writes immutable Review records; never point it at the user's service.
import {mkdtemp,mkdir,readFile,writeFile,cp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(path.join(tmpdir(),'visible3d-2d-regression-')),originalOrigin=process.env.MAGNETIC_ORIGIN
let server
try{
 const fixture=JSON.parse(await readFile(path.join(root,'test/fixtures/magnetic-intake/rose-relative-size.json'),'utf8'))
 for(const [kind,id] of [['sources',fixture.sourceId],['analyses',fixture.analysisId],['reviews',fixture.reviewId]]){await mkdir(path.join(directory,kind),{recursive:true});await cp(path.join(root,'generated/magnetic-intake',kind,id+'.json'),path.join(directory,kind,id+'.json'))}
 const source=JSON.parse(await readFile(path.join(directory,'sources',fixture.sourceId+'.json'),'utf8'))
 await mkdir(path.join(directory,'assets'));for(const id of new Set([source.originalHash,source.view.hash]))await cp(path.join(root,'generated/magnetic-intake/assets',id+'.json'),path.join(directory,'assets',id+'.json'))
 await cp(path.join(root,'generated/magnetic-intake/profile-registry'),path.join(directory,'profile-registry'),{recursive:true})
 const api=createMagneticIntake(directory)
 server=await createServer({configFile:false,root,base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-legacy-review-api',configureServer(s){s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
  const route=req.url.slice(1).split('?')[0]
  if(req.method!=='GET'&&!['reviews','selected'].includes(route)){res.statusCode=403;res.end(JSON.stringify({error:'Only temporary review/selection writes are allowed'}));return}
  try{let raw='';for await(const c of req)raw+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch(req.method,route,raw?JSON.parse(raw):{})))}catch(e){res.statusCode=e.statusCode||422;res.end(JSON.stringify({error:e.message}))}
 })}}]});await server.listen();process.env.MAGNETIC_ORIGIN=`http://127.0.0.1:${server.httpServer.address().port}`
 await import('./verify-magnetic-review-ui.mjs')
 await writeFile('/tmp/magnetic-review-ui/isolation.json',JSON.stringify({temporary:true,sourceFixture:fixture.sourceId,productionWrites:0,paidCalls:0}))
}finally{if(originalOrigin===undefined)delete process.env.MAGNETIC_ORIGIN;else process.env.MAGNETIC_ORIGIN=originalOrigin;await server?.close();await rm(directory,{recursive:true,force:true})}
