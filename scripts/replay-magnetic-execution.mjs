// Read-only replay of a saved Execution and its exact Review/Plan/Trace.
// node --experimental-strip-types scripts/replay-magnetic-execution.mjs --execution <json> --out /tmp/magnetic-replay
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {executeVisible3D} from '../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]},executionFile=path.resolve(arg('--execution','generated/magnetic-intake/visible3d/executions/fcfd522a-95c1-4d14-afc4-79be6e7ec664.json')),base=path.dirname(path.dirname(executionFile)),out=path.resolve(arg('--out','/tmp/magnetic-car-execution-audit/replay')),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),originals=new Map()
if(!path.relative(path.dirname(base),out).startsWith('..'))throw Error('Output must be outside the saved intake directory')
async function read(file){const bytes=await readFile(file,'utf8');originals.set(file,bytes);return JSON.parse(bytes)}
function verified(r){const {hash:h,...payload}=r;if(hash(payload)!==h)throw Error('Stored record hash mismatch: '+r.id);return r}
const stored=verified(await read(executionFile)),plan=verified(await read(path.join(base,'plans',stored.planId+'.json'))),review=verified(await read(path.join(base,'reviews',stored.reviewId+'.json'))),analysis=verified(await read(path.join(base,'analyses',review.analysisId+'.json'))),trace=await read(path.join(base,'model-traces',plan.traceId+'.json'))
if(stored.planHash!==plan.hash||stored.reviewHash!==review.hash||plan.reviewHash!==review.hash||review.analysisHash!==analysis.hash||plan.traceHash!==hash(trace)||hash(trace.plan)!==hash(plan.plan))throw Error('Stored provenance/Trace mismatch')
await mkdir(out,{recursive:true})
const oldVersion=stored.version===4?4:stored.version>=3?3:2,variants=[['baseline',oldVersion,{}],['same-budget',4,{}],['legacy-moderate-budget',oldVersion,{maxGeometryChecks:384,maxLocalSubsets:1536}],['new-moderate-budget',4,{maxGeometryChecks:384,maxLocalSubsets:1536}]],summary={executionId:stored.id,reviewId:review.id,planId:plan.id,traceId:trace.id,modelCalls:0,productionWrites:0,results:[]}
for(const [name,algorithmVersion,extra]of variants){const result=executeVisible3D(plan.plan,review.input,{...stored.options,...extra,algorithmVersion});for(const c of result.candidates)if(!validateAssembly3D(c.assembly).valid)throw Error('Invalid candidate escaped Validator')
 await writeFile(path.join(out,name+'.json'),JSON.stringify(result,null,2));summary.results.push({name,version:result.version,status:result.status,completeSearch:result.completeSearch,search:result.search,candidates:result.candidates.map(c=>({id:c.id,pieces:c.coverage.reconstructed,total:c.coverage.totalConfirmed,unresolved:c.coverage.unresolved,photoMatch:c.photoMatch})),diagnosticCoverage:result.diagnosticCandidates?.map(c=>c.coverage.reconstructed.length)??[]})
 if(name==='baseline'){const {options,planId,planHash,reviewId,reviewHash,sourceId,sourceHash,id,createdAt,hash:h,...payload}=stored;if(hash(payload)!==hash(result))throw Error('Historical replay did not match the stored Execution');summary.baselineMatchesStored=true}
}
for(const [file,bytes]of originals)if(await readFile(file,'utf8')!==bytes)throw Error('Original data changed: '+file)
await writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2))
