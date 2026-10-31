// Explicit, bounded live evaluation. Reads one existing source; writes only /tmp.
import {mkdir,readFile,writeFile,mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {createVisible3DWorkflow} from '../server/magnetic-visible3d.mjs'
import {runVisibleModel,visiblePromptVersion} from '../server/magnetic-visible3d-vision.mjs'
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1]}
const sourceId=arg('--source-id'),model=arg('--model'),profileKey=arg('--review-profile'),baselineId=arg('--baseline-analysis')
if(!sourceId||!model||!profileKey||!process.argv.includes('--execute'))throw Error('Required: --execute --source-id ID --model REGISTERED_MODEL --review-profile ID@VERSION [--baseline-analysis ID]. At most two paid calls; no retries.')
const sourceIntake=createMagneticIntake(path.resolve('generated/magnetic-intake')),source=await sourceIntake.read('sources',sourceId),image=await sourceIntake.read('assets',source.view.hash),registry=await sourceIntake.dispatch('GET','profiles')
const profile=registry.profiles.find(p=>`${p.id}@${p.version}`===profileKey);if(!profile)throw Error('Test Review Profile not registered')
const directory=await mkdtemp(path.join(tmpdir(),'magnetic-visible-v2-live-'));let calls=0
const summary={directory,sourceId,sourceHash:source.hash,imageHash:source.view.hash,model,promptVersion:visiblePromptVersion,actualCalls:0,reviewAssumption:`Offline evaluator manually chooses ${profileKey} for the photographed visible panels; exact physical size unverified`,usdCost:null,costNote:'Token usage reported; no price estimate or inferred billing amount'}
const workflow=createVisible3DWorkflow(directory,{readSource:id=>{if(id!==source.id)throw Error('Wrong source');return structuredClone(source)},readImage:async()=>structuredClone(image),getRegistry:async()=>structuredClone(registry),runModel:(prepared,options,kind)=>{if(calls>=2)throw Error('Live call budget exhausted');summary.actualCalls=++calls;return runVisibleModel(prepared,options,kind)}})
async function save(){await writeFile(path.join(directory,'evaluation.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2))}
try{
 await writeFile(path.join(directory,'source.png'),Buffer.from(image.imageBase64,'base64'))
 if(baselineId){const baseline=await sourceIntake.dispatch('GET','visible3d/analyses/'+baselineId);if(baseline.source.id!==sourceId)throw Error('Baseline source mismatch');const t=await sourceIntake.dispatch('GET','visible3d/trace/'+baseline.record.traceId);summary.baseline={analysisId:baselineId,model:t.model,promptVersion:t.promptVersion,observationCount:baseline.record.evidence.observations.length,profileCandidates:baseline.record.evidence.observations.map(o=>({id:o.id,profiles:o.profileCandidates})),usage:t.usageMetadata}}
 const analysis=await workflow.dispatch('POST','analyze',{sourceId,model,requestId:randomUUID()});summary.analysisStatus=analysis.state;summary.analysisTrace=analysis.trace?.id;summary.visionUsage=analysis.trace?.usageMetadata;summary.visionValidation=analysis.trace?.validation
 if(!analysis.record)throw Error('Vision did not yield a usable record; inspect persisted Trace, no retry')
 summary.observations=analysis.record.evidence.observations.map(o=>({id:o.id,shape:o.shapeAssessment,profileCandidates:o.profileCandidates}));summary.spatialInterpretation=analysis.record.evidence.spatialInterpretation
 const review={pieces:analysis.record.evidence.observations.map(o=>({id:o.id,confirmed:true,excluded:false,profileId:profile.id,profileVersion:profile.version,color:o.color,shapeFamily:o.shapeAssessment?.family??'unknown',shapeNote:'Test evaluator: perspective family reviewed against source image, exact physical scale remains unverified'})),constraints:[],interpretationReview:{status:'unreviewed',note:'Model interpretation retained as a hypothesis; no hidden parts confirmed'}}
 const reviewed=await workflow.dispatch('POST','reviews',{analysisId:analysis.record.id,review,thickness:.06,expectedRevision:0})
 const plan=await workflow.dispatch('POST','plan',{reviewId:reviewed.record.id,model,requestId:randomUUID()});summary.planningTrace=plan.trace?.id;summary.planningUsage=plan.trace?.usageMetadata;summary.planningValidation=plan.trace?.validation
 if(!plan.record)throw Error('Planning did not yield a usable record; inspect persisted Trace, no retry')
 summary.plan={connections:plan.record.plan.connections,alternatives:plan.record.plan.alternatives,spatialInterpretation:plan.record.plan.spatialInterpretation}
 const execution=await workflow.dispatch('POST','execute',{planId:plan.record.id,requestId:randomUUID(),options:{maxAssignments:128,maxGeometryChecks:256,topK:8}})
 summary.execution=execution.record??execution;summary.geometryOutcome=execution.record?.status
}catch(error){summary.failure=error.message;process.exitCode=1}finally{await save()}
