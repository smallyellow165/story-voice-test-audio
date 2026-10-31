import {canonical} from '../build-plan.ts'
import {assertAssembly3D} from './assembly.ts'
import type {Assembly3D} from './assembly.ts'
import {validateAssembly3D,inspectAssemblyCollisions} from './engine-adapter.ts'
export type GeometryReport=ReturnType<typeof validateAssembly3D>
export type HumanCollisionGrant={id:string;assemblyId:string;revision:number;assemblyCanonical:string;assemblyHash:string;diagnosticHash:string;collisionKeys:string[];approvedAt:string;geometry:GeometryReport;origin?:{id:string;hash:string}}
export type HumanCollisionReference=Pick<HumanCollisionGrant,'id'|'assemblyHash'|'diagnosticHash'>
export const collisionErrorKey=(issue:GeometryReport['issues'][number])=>canonical(issue)
/** Only positive, finite, identified strict intersections are human-reviewable. */
export function collisionReviewPolicy(a:Assembly3D,report=validateAssembly3D(a)){
 assertAssembly3D(a)
 const errors=report.issues.filter(i=>i.severity==='error'),ids=new Set(a.pieces.map(p=>p.id))
 const collisions=errors.filter(i=>i.code==='intersection'&&i.relatedPieceIds?.length===2&&new Set(i.relatedPieceIds).size===2&&i.relatedPieceIds.every(id=>ids.has(id))&&Number.isFinite(i.penetrationDepth)&&i.penetrationDepth!>0)
 const blockers=errors.filter(i=>!collisions.includes(i))
 const keys=collisions.map(collisionErrorKey).sort()
 if(new Set(keys).size!==keys.length)blockers.push(...collisions)
 // Evidence must be locatable, not an unidentified catch-all Error.
 for(const issue of collisions){const e=inspectAssemblyCollisions(a,{...report,issues:[issue]})[0];if(!e?.intersects||!e.region||e.intersectionVertices.length<4)blockers.push(issue)}
 return {errors,collisions,keys,blockers,eligible:!report.valid&&collisions.length>0&&!blockers.length}
}
export function grantMatches(a:Assembly3D,grant:HumanCollisionGrant|undefined|null){return !!grant&&grant.assemblyId===a.id&&grant.revision===a.revision&&grant.assemblyCanonical===canonical(a)}
/** Workflow acceptance only. The strict report and Error classifications stay intact.
 * Callers at trust boundaries MUST obtain the grant from the authoritative server.
 */
export function collisionErrorsAccepted(report:GeometryReport,grant:HumanCollisionGrant|undefined|null){
 const errors=report.issues.filter(i=>i.severity==='error')
 return !!grant&&errors.every(i=>i.code==='intersection'&&grant.collisionKeys.includes(collisionErrorKey(i)))
}
export function referenceFor(grant:HumanCollisionGrant):HumanCollisionReference{return {id:grant.id,assemblyHash:grant.assemblyHash,diagnosticHash:grant.diagnosticHash}}
