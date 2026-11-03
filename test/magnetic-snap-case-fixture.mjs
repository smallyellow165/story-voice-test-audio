import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {multiAssemblyFixture} from './magnetic-multi-assembly-fixture.mjs'

// Exact observed saved Combined, including Orient and Bounds Align (revision 4).
// Copies are isolated; the official snapshots and all review heads are read-only.
export const SNAP_CASE_ID='combined-8565b7b2-feea-458c-b267-c4ffbc00c781'
export async function snapCaseFixture(dir){
 const f=await multiAssemblyFixture(dir)
 for(const relative of [`assembly3d/${SNAP_CASE_ID}`,`assembly3d-review/heads/${SNAP_CASE_ID}`]){
  await mkdir(path.join(dir,relative),{recursive:true})
  for(const name of await readdir(path.join(f.official,relative))){
   if(!/^\d{12}\.json$/.test(name))continue
   const file=relative+'/'+name,raw=await readFile(path.join(f.official,file),'utf8');f.copied.set(file,raw);await writeFile(path.join(dir,file),raw)
   const h=JSON.parse(raw)
   if(h.approvalId){const file='assembly3d-review/approvals/'+h.approvalId+'.json',raw=await readFile(path.join(f.official,file),'utf8');f.copied.set(file,raw);await mkdir(path.dirname(path.join(dir,file)),{recursive:true});await writeFile(path.join(dir,file),raw)}
  }
 }
 const record=await f.api.dispatch('GET','assembly3d/records/'+SNAP_CASE_ID)
 if(record.hash!=='8bf04540eac8de9c3c80a1eb275174f08f34e151a9e7730edb7750e4cb2d4ea6')throw Error('Observed Snap case changed; inspect the new record before updating expectations')
 const a=record.snapshot.assembly,find=(i,sourceId)=>a.modules[i].pieces.find(p=>p.sourceId===sourceId).id
 return {...f,record,reference:{groupId:'module-1',pieceId:find(1,'rear-top-left'),direction:'up'},connection:{pieceA:find(0,'front-floor-left'),portA:'e2-p0',pieceB:find(1,'ramp-lower-left'),portB:'e0-p0',dihedralDeg:0,flip:true}}
}
