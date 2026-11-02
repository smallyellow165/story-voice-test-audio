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
 plan.plan.connections.push(...structuredClone(additional));hash(plan)
 execution.id=randomUUID();execution.planId=plan.id;execution.planHash=plan.hash;hash(execution)
 if(origin){origin.id=randomUUID();origin.planId=plan.id;origin.planHash=plan.hash;origin.executionId=execution.id;origin.executionHash=execution.hash;hash(origin)}
 for(const [kind,record,old] of [['plans',plan,previous.plan],['executions',execution,previous.execution],['origins',origin,previous.origin]])if(record){await unlink(path.join(directory,'visible3d',kind,old+'.json'));await writeFile(path.join(directory,'visible3d',kind,record.id+'.json'),JSON.stringify(record))}
}
