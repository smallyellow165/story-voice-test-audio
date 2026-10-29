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
