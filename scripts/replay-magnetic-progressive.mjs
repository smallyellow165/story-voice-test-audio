// Offline immutable-source comparison; no network/model work and output outside intake.
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'
import {executeVisible3D} from '../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {refineConstraints,connectionPair} from '../src/magnetic-tiles/three-d/reconstruction/constraint-refinement.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]},file=path.resolve(arg('--execution','generated/magnetic-intake/visible3d/executions/fcfd522a-95c1-4d14-afc4-79be6e7ec664.json')),base=path.dirname(path.dirname(file)),out=path.resolve(arg('--out','/tmp/magnetic-progressive-v1/replay')),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),originals=new Map()
if(!path.relative(path.dirname(base),out).startsWith('..'))throw Error('Output must be outside the saved intake directory')
async function read(f,record=true){const bytes=await readFile(f,'utf8');originals.set(f,bytes);const r=JSON.parse(bytes);if(record){const {hash:h,...p}=r;assert.equal(hash(p),h)}return r}
const old=await read(file),plan=await read(path.join(base,'plans',old.planId+'.json')),review=await read(path.join(base,'reviews',old.reviewId+'.json')),analysis=await read(path.join(base,'analyses',review.analysisId+'.json')),trace=await read(path.join(base,'model-traces',plan.traceId+'.json'),false)
assert.equal(plan.hash,old.planHash);assert.equal(review.hash,old.reviewHash);assert.equal(review.hash,plan.reviewHash);assert.equal(analysis.hash,review.analysisHash);assert.equal(hash(trace),plan.traceHash);assert.equal(hash(trace.plan),hash(plan.plan))
await mkdir(out,{recursive:true});const budget={...old.options},refinement=refineConstraints(plan.plan,review.input,{protectPlan:plan.origin!=='model'}),summary={planId:plan.id,reviewId:review.id,traceId:trace.id,budget,results:[],modelCalls:0,productionWrites:0}
for(const [id,p]of [['original',plan.plan],...refinement.candidates.filter(c=>['refinement-1','refinement-3','refinement-6','refinement-7'].includes(c.id)).map(c=>[c.id,c.plan])])for(const algorithmVersion of [4,5]){
 const x=executeVisible3D(p,review.input,{...budget,algorithmVersion});for(const c of x.candidates){assert.equal(validateAssembly3D(c.assembly).valid,true);const reach=new Set([c.assembly.pieces[0].id]);for(let i=0;i<c.assembly.pieces.length;i++)for(const e of c.assembly.connections){if(reach.has(e.pieceA))reach.add(e.pieceB);if(reach.has(e.pieceB))reach.add(e.pieceA)}assert.equal(reach.size,c.assembly.pieces.length)}
 await writeFile(path.join(out,id+'-v'+algorithmVersion+'.json'),JSON.stringify(x,null,2));const progress=x.search.progressive
 const legal=x.candidates.filter(c=>c.assembly.connections.length),largest=legal.reduce((a,c)=>c.assembly.pieces.length>(a?.assembly.pieces.length??0)?c:a,null)
 const reachable=(id,edges)=>{const set=new Set([id]);for(let i=0;i<p.parts.length;i++)for(const e of edges){if(set.has(e.pieceA))set.add(e.pieceB);if(set.has(e.pieceB))set.add(e.pieceA)}return [...set].sort().join('|')}
 const edges=[...p.connections,...p.alternatives.flatMap(a=>a.connections)].filter(c=>c.intent!=='separate'&&c.portA&&c.portB&&(c.angles.length||c.angleRange)),representatives=new Map()
 for(const c of legal){const component=reachable(c.assembly.pieces[0].id,edges),previous=representatives.get(component);if(!previous||previous.assembly.pieces.length<c.assembly.pieces.length)representatives.set(component,c)}
 const independent=progress?.independentComponentCoverage??[...new Set([...representatives.values()].flatMap(c=>c.coverage.reconstructed))]

 summary.results.push({id,algorithmVersion,actualVersion:x.version,status:x.status,completeSearch:x.completeSearch,checks:x.search.geometryChecks,nodes:progress?.nodes??x.search.localSearch?.considered??0,budgetAllocation:progress?.checks??x.search.localSearch??null,candidates:x.candidates.length,maxConnected:largest?.assembly.pieces.length??0,effectiveConnections:largest?.assembly.connections.length??0,independentComponentCoverage:independent,alternativeCoverageUnion:progress?.verifiedConnectedUnion??[...new Set(legal.flatMap(c=>c.coverage.reconstructed))],returnedUnion:[...new Set(legal.flatMap(c=>c.coverage.reconstructed))],unresolved:largest?.coverage.unresolved??review.input.review.pieces.map(p=>p.id),components:progress?.componentResults??null,failureCounts:progress?.failureCounts??null,portReuse:x.diagnostics.some(d=>d.includes('port-reuse')),intersection:x.diagnostics.some(d=>d.includes('intersection')),loop:x.diagnostics.some(d=>d.includes('loop-dihedral-error')),termination:progress?.termination??x.status,photoMatch:'unverified',diagnosticCoverage:x.diagnosticCandidates?.map(c=>c.coverage.reconstructed.length)})
}
for(const [f,bytes]of originals)assert.equal(await readFile(f,'utf8'),bytes)
await writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2))
