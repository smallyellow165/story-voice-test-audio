import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,copyFile,readdir,rename,rm,symlink} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {contentHash} from '../src/magnetic-tiles/build-plan.ts'
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=','base64')
test('Server Library refresh, bounded reads, identity deduplication and immutable Source/Analysis images',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'magnetic-library-')),lib=path.join(root,'library'),store=path.join(root,'store');await mkdir(lib)
 try{
  const api=createMagneticIntake(store,{libraryDirectory:lib})
  await writeFile(path.join(lib,'rose.PNG'),png)
  assert.deepEqual((await api.dispatch('GET','library')).images.map(i=>i.name),['rose.PNG'])
  await copyFile(path.join(lib,'rose.PNG'),path.join(lib,'new.png'))
  assert.equal((await api.dispatch('GET','library')).images.length,2)
  const image=await api.dispatch('POST','library-image',{name:'rose.PNG'})
  const source=await api.dispatch('POST','sources',{name:image.name,original:image,view:image})
  const duplicate=await api.dispatch('POST','sources',{name:'new.png',original:await api.dispatch('POST','library-image',{name:'new.png'}),view:image})
  assert.deepEqual(duplicate,source)
  assert.equal((await readdir(path.join(store,'assets'))).length,1)
  assert.equal((await readdir(path.join(store,'sources'))).length,1)
  // Test-only historical analysis record; no recognition provider invoked.
  const a={schemaVersion:1,id:crypto.randomUUID(),sourceId:source.id,sourceHash:source.hash,status:'complete',createdAt:new Date().toISOString()}
  await mkdir(path.join(store,'analyses'));await writeFile(path.join(store,'analyses',a.id+'.json'),JSON.stringify({...a,hash:await contentHash(a)}))
  await rename(path.join(lib,'rose.PNG'),path.join(lib,'renamed.png'));await rm(path.join(lib,'new.png'))
  await writeFile(path.join(lib,'renamed.png'),'broken replacement')
  assert.equal((await api.dispatch('GET','analyses/'+a.id)).sourceHash,source.hash)
  assert.equal((await api.dispatch('GET','image/'+source.id)).imageBase64,image.imageBase64)
  await assert.rejects(api.dispatch('POST','library-image',{name:'rose.PNG'}),/删除或改名/)
  await assert.rejects(api.dispatch('POST','library-image',{name:'renamed.png'}),/内容不匹配/)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('Library rejects traversal, symlinks, non-images, directory and oversized files',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'magnetic-library-security-')),lib=path.join(root,'library');await mkdir(lib)
 try{
  const api=createMagneticIntake(path.join(root,'store'),{libraryDirectory:lib})
  await writeFile(path.join(root,'outside.png'),png);await symlink(path.join(root,'outside.png'),path.join(lib,'link.png'));await mkdir(path.join(lib,'dir.png'));await writeFile(path.join(lib,'large.png'),Buffer.alloc(6*1024*1024+1));await writeFile(path.join(lib,'not.txt'),'text')
  for(const name of ['../outside.png','/tmp/outside.png','..\\outside.png','bad\0.png','link.png','dir.png','not.txt','large.png','%2e%2e%2foutside.png'])await assert.rejects(api.dispatch('POST','library-image',{name}))
  assert.deepEqual((await api.dispatch('GET','library')).images.map(i=>i.name),['large.png'])
 }finally{await rm(root,{recursive:true,force:true})}
})

test('recursive library uses exact relative names, including duplicate basenames and empty folders',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'magnetic-library-folders-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const lib=path.join(root,'library'),api=createMagneticIntake(path.join(root,'store'),{libraryDirectory:lib})
 for(const folder of ['car/details','castle','empty','.private'])await mkdir(path.join(lib,folder),{recursive:true})
 const names=['root.png','car/front.png','castle/front.png','car/details/侧面.PNG','car/space & percent%.png']
 for(const [i,name] of names.entries())await writeFile(path.join(lib,name),Buffer.concat([png,Buffer.from(String(i))]))
 await writeFile(path.join(lib,'.private','hidden.png'),png);await writeFile(path.join(lib,'car','notes.txt'),'not an image')
 const list=await api.dispatch('GET','library')
 assert.deepEqual(new Set(list.images.map(i=>i.name)),new Set(names));assert.deepEqual(list.folders,['car','car/details','castle','empty'])
 const a=await api.dispatch('POST','library-image',{name:'car/front.png'}),b=await api.dispatch('POST','library-image',{name:'castle/front.png'})
 assert.equal(a.name,'car/front.png');assert.equal(b.name,'castle/front.png');assert.notEqual(a.sha256,b.sha256)
 const entries=[]
 for(const name of names.slice(0,4)){
  const image=await api.dispatch('POST','library-image',{name}),s=await api.dispatch('POST','sources',{name,original:image,view:image})
  entries.push({sourceId:s.id,sourceHash:s.hash,name,origin:'server',role:'Unknown',direction:'Unknown',note:''})
 }
 const set=await api.dispatch('POST','source-sets',{images:entries})
 assert.deepEqual(set.images.map(i=>i.name),names.slice(0,4))
 const analysis=await api.dispatch('POST','visible3d/annotate',{sourceId:set.id,evidence:{version:2,referenceImageId:set.primaryImageId,observations:[],unknowns:['offline input binding test'],spatialInterpretation:{camera:{viewpoint:'unknown',evidence:'Offline input binding test',uncertainty:''},faces:[],connections:[],overallShapeHypotheses:[],hiddenStructureHypotheses:[],alternatives:[],unknowns:[]}}})
 assert.equal(analysis.sourceHash,set.hash)
 await rename(path.join(lib,'car'),path.join(lib,'renamed-car'))
 assert.equal((await api.dispatch('GET','visible3d/analyses/'+analysis.id)).record.sourceHash,set.hash)
 for(const entry of entries)assert.ok((await api.dispatch('GET','image/'+entry.sourceId)).imageBase64)
 assert.ok((await api.dispatch('GET','library')).images.some(i=>i.name==='renamed-car/details/侧面.PNG'))
 await assert.rejects(api.dispatch('POST','source-sets',{images:[...entries,entries[0]]}),/1–4/)
})

test('every path component rejects symlinks, traversal, absolute and noncanonical paths',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'magnetic-library-paths-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const lib=path.join(root,'library'),outside=path.join(root,'outside');await mkdir(path.join(lib,'real','deep'),{recursive:true});await mkdir(outside)
 await writeFile(path.join(outside,'secret.png'),png);await writeFile(path.join(lib,'real','deep','good.png'),png)
 await symlink(outside,path.join(lib,'escape'));await symlink(path.join(lib,'real'),path.join(lib,'inside-link'))
 await symlink(path.join(outside,'secret.png'),path.join(lib,'real','file.png'))
 const api=createMagneticIntake(path.join(root,'store'),{libraryDirectory:lib})
 for(const name of ['../outside/secret.png','real/../../outside/secret.png','/tmp/secret.png','C:/secret.png','C:\\secret.png','real//deep/good.png','real/./deep/good.png','real/deep/../deep/good.png','real\0.png','escape/secret.png','inside-link/deep/good.png','real/file.png','real/deep/good.png/extra.png','%2e%2e/outside/secret.png','real/%2e%2e/%2e%2e/outside/secret.png'])await assert.rejects(api.dispatch('POST','library-image',{name}),undefined,name)
 assert.deepEqual((await api.dispatch('GET','library')).images.map(i=>i.name),['real/deep/good.png'])
 await symlink(lib,path.join(root,'linked-root'))
 const linked=createMagneticIntake(path.join(root,'other-store'),{libraryDirectory:path.join(root,'linked-root','real')})
 await assert.rejects(linked.dispatch('GET','library'),/符号链接/);await assert.rejects(linked.dispatch('POST','library-image',{name:'deep/good.png'}),/符号链接/)
 await writeFile(path.join(lib,'real','bad.jpg'),png);await writeFile(path.join(lib,'real','empty.png'),'');await writeFile(path.join(lib,'real','huge.png'),Buffer.alloc(6*1024*1024+1))
 for(const name of ['real/bad.jpg','real/empty.png','real/huge.png'])await assert.rejects(api.dispatch('POST','library-image',{name}))
 // Replacing an ordinary directory with a link after discovery is still denied.
 await rename(path.join(lib,'real'),path.join(lib,'old-real'));await symlink(outside,path.join(lib,'real'))
 await assert.rejects(api.dispatch('POST','library-image',{name:'real/secret.png'}),/符号链接/)
})
