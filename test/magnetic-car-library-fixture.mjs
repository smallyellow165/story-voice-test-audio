// Isolated fixture only. Real saved Rear geometry; deterministic Front setup.
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {reconstructionInput} from '../src/magnetic-tiles/three-d/reconstruction/reconstruction-scope.ts'
import {previewSymmetryFill,referenceSymmetryPlane,confirmSymmetryFill} from '../src/magnetic-tiles/three-d/symmetry-fill.ts'
import {createInitialHistory} from '../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import {serializeAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
export async function carLibraryFixture(dir){
 const official=new URL('../generated/magnetic-intake/',import.meta.url).pathname,copied=new Map()
 async function copy(relative){if(copied.has(relative))return JSON.parse(copied.get(relative));const raw=await readFile(path.join(official,relative),'utf8');copied.set(relative,raw);await mkdir(path.dirname(path.join(dir,relative)),{recursive:true});await writeFile(path.join(dir,relative),raw);return JSON.parse(raw)}
 const origin=await copy('visible3d/origins/603183ad-6109-4765-82d8-580b11e04fe8.json')
 let review,modules,source,plan
 for(const [kind,id]of [['analyses',origin.analysisId],['reviews',origin.reviewId],['plans',origin.planId],['executions',origin.executionId]]){const r=await copy(`visible3d/${kind}/${id}.json`);if(kind==='reviews')review=r;if(kind==='plans')plan=r;if(r.traceId)await copy(`visible3d/model-traces/${r.traceId}.json`)}
 await copy(`visible3d/heads/${origin.sourceId}.json`);source=await copy(`sources/${origin.sourceId}.json`)
 for(const id of new Set([source.id,...source.images.map(i=>i.sourceId)])){const s=await copy(`sources/${id}.json`);for(const hash of new Set([s.originalHash,s.view.hash]))await copy(`assets/${hash}.json`)}
 modules=await copy(`visible3d/module-plans/${origin.reconstructionScope.modulePlan.id}.json`);let m=modules;while(m.parent)m=await copy(`visible3d/module-plans/${m.parent.id}.json`)
 await copy(`visible3d/module-heads/${origin.reviewId}.json`)
 for(const file of await readdir(path.join(official,'profile-registry')))if(file.endsWith('.json'))await copy('profile-registry/'+file)
 const api=createMagneticIntake(dir,{enableHumanReview:true}),front=modules.modules.find(m=>m.name==='g-front'),scope=reconstructionInput(review.input,source,{groupId:front.id,imageId:'all'},modules).scope
 // A test-only connected chain, not a photo reconstruction accuracy claim.
 const ids=scope.observationIds,parts=ids.map(id=>{const p=review.input.review.pieces.find(p=>p.id===id);return {id,profileId:p.profileId,profileVersion:p.profileVersion,orientationEvidence:'isolated saved-work selection fixture'}})
 const frontPlan={version:1,parts,connections:parts.slice(1).map((p,i)=>({pieceA:parts[i].id,pieceB:p.id,portA:parts[i].profileId==='square'?'e1-p0':'e1-p0',portB:p.profileId==='square'?'e3-p0':'e0-p0',intent:'connect',angles:[0],angleRange:null,flip:true,evidenceRefs:[parts[i].id,p.id],evidence:'isolated deterministic chain, not photo evidence',uncertainty:'UI/storage fixture only'})),alternatives:[],relations:[],unknowns:['No model call; deterministic UI/storage fixture']}
 const p=await api.dispatch('POST','visible3d/manual-plan',{reviewId:review.id,reconstructionScope:scope,plan:frontPlan}),x=await api.dispatch('POST','visible3d/execute',{planId:p.id,requestId:randomUUID()})
 if(!x.record?.candidates.some(c=>c.assembly.pieces.length===9))throw Error('Front selection fixture must contain a full nine-piece valid Candidate')
 let history=createInitialHistory(origin.assembly),sidecar={origin,assemblyRaw:serializeAssembly3D(origin.assembly),symmetryFills:[]}
 for(const [id,axis,offset]of [['rear-side-left','x',.5],['rear-support-left','x',.5],['rear-top-left','y',.5],['rear-top-right','y',.5]]){
  const before=history.current.revision,p=previewSymmetryFill(history.current,{sourceIds:[id],plane:referenceSymmetryPlane(history.current,'ramp-lower-left',axis,offset),planeMode:'reference'})
  history=confirmSymmetryFill(history,p);sidecar.symmetryFills.push({sourceIds:[id],addedIds:p.addedIds,plane:p.request.plane,sourceRevision:before,addedRevision:history.current.revision})
 }
 const rear=history.current,request={socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:9999',origin:'http://127.0.0.1:9999','sec-fetch-site':'same-origin'}},{token}=await api.dispatch('POST','assembly3d-review/session',{}, {request}),context={request:{...request,headers:{...request.headers,authorization:'Bearer '+token}}},post=(r,b)=>api.dispatch('POST','assembly3d-review/'+r,b,context)
 let state=await post('accept-diagnostic',{assembly:origin.assembly,originId:origin.id,expectedVersion:null})
 state=await post('sync',{assembly:rear,expectedVersion:state.version});state=await post('accept',{assembly:rear,expectedVersion:state.version,acceptedKeys:state.collisionKeys});state=await post('approve',{assembly:rear,expectedVersion:state.version,acceptedKeys:state.collisionKeys})
 return {api,origin,rear,sidecar,front:{group:front,plan:p,execution:x.record},source,review,modules,plan,copied,official,reviewState:state}
}
