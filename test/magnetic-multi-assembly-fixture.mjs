// Exact saved Front / Rear snapshots. All reads of official data are tracked;
// all API writes and review changes occur only in the caller's temp directory.
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises'
import path from 'node:path'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
export async function multiAssemblyFixture(dir){
 const official=new URL('../generated/magnetic-intake/',import.meta.url).pathname,copied=new Map()
 async function copy(relative){if(copied.has(relative))return JSON.parse(copied.get(relative));const raw=await readFile(path.join(official,relative),'utf8');copied.set(relative,raw);await mkdir(path.dirname(path.join(dir,relative)),{recursive:true});await writeFile(path.join(dir,relative),raw);return JSON.parse(raw)}
 const front=await copy('assembly3d/visible-db35a8ea-9720-4643-91b2-a753778b3b03/000000000001.json'),rear=await copy('assembly3d/visible-edaeaad0-b52d-4bba-b761-3792eeeb82b2/000000000001.json')
 for(const saved of [front,rear]){
  const o=saved.snapshot.photoOrigin.origin
  await copy(`visible3d/origins/${o.id}.json`)
  for(const [kind,id]of [['analyses',o.analysisId],['reviews',o.reviewId],['plans',o.planId],['executions',o.executionId]]){const r=await copy(`visible3d/${kind}/${id}.json`);if(r.traceId)await copy(`visible3d/model-traces/${r.traceId}.json`)}
  let m=await copy(`visible3d/module-plans/${o.reconstructionScope.modulePlan.id}.json`);while(m.parent)m=await copy(`visible3d/module-plans/${m.parent.id}.json`)
  await copy(`visible3d/module-heads/${o.reviewId}.json`)

 }
 const source=await copy(`sources/${front.project.id}.json`);await copy(`visible3d/heads/${source.id}.json`)
 for(const id of new Set([source.id,...source.images.map(i=>i.sourceId)])){const s=await copy(`sources/${id}.json`);for(const hash of new Set([s.originalHash,s.view.hash]))await copy(`assets/${hash}.json`)}
 for(const file of await readdir(path.join(official,'profile-registry')))if(file.endsWith('.json'))await copy('profile-registry/'+file)
 return {api:createMagneticIntake(dir),source,front,rear,copied,official}
}
