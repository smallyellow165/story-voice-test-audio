// Offline immutable-source comparison; no network/model work and output outside intake.
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'
import {executeVisible3D} from '../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {refineConstraints,connectionPair} from '../src/magnetic-tiles/three-d/reconstruction/constraint-refinement.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]},file=path.resolve(arg('--execution','generated/magnetic-intake/visible3d/executions/fcfd522a-95c1-4d14-afc4-79be6e7ec664.json')),base=path.dirname(path.dirname(file)),out=path.resolve(arg('--out','/tmp/magnetic-refinement-v1/replay')),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),originals=new Map()
if(!path.relative(path.dirname(base),out).startsWith('..'))throw Error('Output must be outside the saved intake directory')
async function read(f,record=true){const bytes=await readFile(f,'utf8');originals.set(f,bytes);const r=JSON.parse(bytes);if(record){const {hash:h,...p}=r;assert.equal(hash(p),h)}return r}
const old=await read(file),plan=await read(path.join(base,'plans',old.planId+'.json')),review=await read(path.join(base,'reviews',old.reviewId+'.json')),analysis=await read(path.join(base,'analyses',review.analysisId+'.json')),trace=await read(path.join(base,'model-traces',plan.traceId+'.json'),false)
assert.equal(plan.hash,old.planHash);assert.equal(review.hash,old.reviewHash);assert.equal(review.hash,plan.reviewHash);assert.equal(analysis.hash,review.analysisHash);assert.equal(hash(trace),plan.traceHash);assert.equal(hash(trace.plan),hash(plan.plan))
await mkdir(out,{recursive:true});const options={...old.options,algorithmVersion:4},refinement=refineConstraints(plan.plan,review.input,{protectPlan:plan.origin!=='model'}),summary={planId:plan.id,reviewId:review.id,traceId:trace.id,options,search:refinement.search,results:[],modelCalls:0,productionWrites:0}
await writeFile(path.join(out,'refinement.json'),JSON.stringify(refinement,null,2))
for(const [id,p,c]of [['original-current',plan.plan,null],...refinement.candidates.map(c=>[c.id,c.plan,c])]){
 const x=executeVisible3D(p,review.input,options);for(const c of x.candidates)assert.equal(validateAssembly3D(c.assembly).valid,true)
 await writeFile(path.join(out,id+'.json'),JSON.stringify(x,null,2))
 const max=x.candidates.reduce((n,c)=>Math.max(n,c.coverage.reconstructed.length),0)
 summary.results.push({id,removed:c?.removed.map(d=>connectionPair(d.constraint))??[],retained:c?.retained.map(connectionPair)??[],status:x.status,assignments:x.search.assignments,geometryChecks:x.search.geometryChecks,candidates:x.candidates.length,maxLegalCoverage:max,total:review.input.review.pieces.filter(p=>p.confirmed&&!p.excluded).length,remainingPortReuse:x.diagnostics.some(d=>d.includes('port-reuse')),remainingIntersections:x.diagnostics.some(d=>d.includes('intersection')),remainingLoopErrors:x.diagnostics.some(d=>d.includes('loop-dihedral-error')),unresolvedByCandidate:x.candidates.map(c=>({id:c.id,unresolved:c.coverage.unresolved})),unreconstructedWithoutLegalCandidate:x.candidates.length?[]:review.input.review.pieces.filter(p=>p.confirmed&&!p.excluded).map(p=>p.id),diagnosticCoverage:x.diagnosticCandidates?.map(c=>c.coverage.reconstructed.length),photoMatch:'unverified'})
}
for(const [f,bytes]of originals)assert.equal(await readFile(f,'utf8'),bytes)
await writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2))
