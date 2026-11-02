// ISOLATED TEST FIXTURE ONLY. Authors a new, explicitly manual Canonical Plan
// from supplied hypotheses. Never labels it as an LLM output or rewrites a real
// record. Pose fixtures are reused verbatim; no Port conversion is performed.
import {writeFile,unlink} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {canonicalGeometryContract} from '../src/magnetic-tiles/three-d/canonical-geometry.ts'
export async function canonicalTestRecords(directory,plan,execution,origin,additional=[]){
 const previous={plan:plan.id,execution:execution.id,origin:origin?.id}
 const hash=r=>{delete r.hash;r.hash=createHash('sha256').update(JSON.stringify(r)).digest('hex')}
 plan.id=randomUUID();plan.origin='human-hypothesis';plan.traceId=null;delete plan.traceHash;delete plan.promptVersion;plan.geometryContract=canonicalGeometryContract
 plan.testFixture={purpose:'Offline Canonical Plan contract / handoff regression; not model recognition',copiedHypothesesFrom:previous.plan}
 plan.plan.connections.push(...structuredClone(additional));if(plan.reconstructionScope)plan.reconstructionScope.groupObservationIds=plan.plan.parts.map(p=>p.id).sort();hash(plan)
 execution.id=randomUUID();execution.planId=plan.id;execution.planHash=plan.hash;execution.reconstructionScope=structuredClone(plan.reconstructionScope);hash(execution)
 if(origin){origin.id=randomUUID();origin.planId=plan.id;origin.planHash=plan.hash;origin.executionId=execution.id;origin.executionHash=execution.hash;origin.reconstructionScope=structuredClone(plan.reconstructionScope);hash(origin)}
 for(const [kind,record,old] of [['plans',plan,previous.plan],['executions',execution,previous.execution],['origins',origin,previous.origin]])if(record){await unlink(path.join(directory,'visible3d',kind,old+'.json'));await writeFile(path.join(directory,'visible3d',kind,record.id+'.json'),JSON.stringify(record))}
}

export function canonicalSelectedTestHead(plan,execution,analysis,review,origin){return {revision:1,selectedRevision:0,analysisId:analysis.id,analysisHash:analysis.hash,reviewId:review.id,reviewHash:review.hash,groups:{[plan.reconstructionScope.groupId]:{scope:plan.reconstructionScope,plan:{id:plan.id,hash:plan.hash},execution:{id:execution.id,hash:execution.hash},...(origin?{origin:{id:origin.id,hash:origin.hash}}:{})}}}}
