// Real Truck-Ramp immutable versions, copied into a disposable store only.
// No Analysis/Planning/Execution request is issued by this fixture.
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises'
import path from 'node:path'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
export async function sceneRegistrationFixture(directory){
 const official=new URL('../generated/magnetic-intake/',import.meta.url).pathname,copied=new Map()
 async function copy(file){if(copied.has(file))return JSON.parse(copied.get(file));const raw=await readFile(path.join(official,file),'utf8');copied.set(file,raw);await mkdir(path.dirname(path.join(directory,file)),{recursive:true});await writeFile(path.join(directory,file),raw);return JSON.parse(raw)}
 const ids=['visible-84170ded-4518-40d3-9ee9-b9778ddb49c0','visible-669e6dad-74c1-4aaa-a112-3ac88444e89b','visible-2b7c4516-67b2-4cfd-b63c-fa063b3b6947'],records=[]
 for(const id of ids){
  const r=await copy(`assembly3d/${id}/000000000001.json`),o=r.snapshot.photoOrigin.origin;records.push(r)
  await copy(`visible3d/origins/${o.id}.json`)
  for(const [kind,id]of [['analyses',o.analysisId],['reviews',o.reviewId],['plans',o.planId],['executions',o.executionId]]){const a=await copy(`visible3d/${kind}/${id}.json`);if(a.traceId)await copy(`visible3d/model-traces/${a.traceId}.json`)}
  let plan=await copy(`visible3d/module-plans/${o.reconstructionScope.modulePlan.id}.json`);while(plan.parent)plan=await copy(`visible3d/module-plans/${plan.parent.id}.json`)
  await copy(`visible3d/module-heads/${o.reviewId}.json`)
 }
 const origin=records[0].snapshot.photoOrigin.origin,source=await copy(`sources/${origin.sourceId}.json`)
 await copy(`visible3d/heads/${origin.projectId}/${source.id}.json`)
 for(const id of new Set([source.id,...source.images.map(i=>i.sourceId)])){const s=await copy(`sources/${id}.json`);for(const h of new Set([s.originalHash,s.view.hash]))await copy(`assets/${h}.json`)}
 for(const file of await readdir(path.join(official,'profile-registry')))if(file.endsWith('.json'))await copy('profile-registry/'+file)
 const parents=records.map(r=>({id:r.assembly.id,version:r.version,hash:r.hash}))
 return {api:createMagneticIntake(directory),source,projectId:origin.projectId,records,parents,copied,official}
}
