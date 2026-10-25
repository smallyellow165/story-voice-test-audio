import {prepareGeometryInput} from '../../server/brick-geometry-input.mjs'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { loadBrickRules, geometrySnapshot } from '../../server/brick-rules.mjs'
import { executePlan } from './execute.mjs'

const root=fileURLToPath(new URL('../../',import.meta.url))
const stem='f1f84e96-8269-4132-807a-61c41243229f'
async function main() {
  const args={plan:path.join(root,'generated/brick-spatial-traces/'+stem+'.plan.json'),trace:path.join(root,'generated/brick-spatial-traces/'+stem+'.json'),output:path.join(root,'output/geometry-execution')}
  for(let i=2;i<process.argv.length;i+=2) {
    const flag=process.argv[i],value=process.argv[i+1]
    if(!['--plan','--trace','--output'].includes(flag)||!value)throw new Error('Usage: node experiments/geometry-execution/run.mjs [--plan file --trace matching-file --output directory]')
    args[flag.slice(2)]=path.resolve(value)
  }
  const sources=[]
  async function json(file){const bytes=await readFile(file);sources.push({path:file,sha256:createHash('sha256').update(bytes).digest('hex')});return JSON.parse(bytes)}
  const plan=await json(args.plan),trace=await json(args.trace)
  if(JSON.stringify(plan)!==JSON.stringify(trace.plan))throw new Error('Plan does not match the supplied original trace; refusing to silently replace the source')
  const rules=await loadBrickRules()
  const prepared=await prepareGeometryInput(trace.requestInput,rules)
  if(prepared.issues.length)throw new Error(prepared.issues.join('; '))
  const result=executePlan(plan,prepared.input,rules)
  const directory=path.join(args.output,randomUUID());await mkdir(directory,{recursive:true})
  const save=(name,data)=>writeFile(path.join(directory,name),JSON.stringify(data,null,2),{flag:'wx'})
  const report={...result,sources,sourceTraceId:trace.id,sourcePlan:plan,sourceInput:trace.requestInput,input:prepared.input,enrichments:prepared.enrichments,geometrySnapshot:geometrySnapshot(rules,trace.requestInput.inventory),image:trace.image,
    limitations:['Single-view fidelity requires visual review.','Shared conservative body/stud envelopes, not mesh-solid or stability simulation.','No build order or intermediate support threshold tested.']}
  await save('report.json',report)
  for(const c of result.candidates)await save(c.id+'.json',c)
  // Small browser index; full source, every attempted candidate and failures stay in report.json.
  await save('viewer.json',{status:result.status,completeSearch:result.completeSearch,diagnostics:result.diagnostics,groups:result.groups,diagnosticAssembly:result.diagnosticAssembly,image:trace.image,
    candidates:result.candidates.map(c=>({id:c.id,layoutId:c.layoutId,file:c.id+'.json',bricks:c.assembly.bricks})),sourcePlan:plan})
  const relative=path.relative(root,path.join(directory,'viewer.json')).split(path.sep).join('/')
  console.log(JSON.stringify({status:result.status,completeSearch:result.completeSearch,attempts:result.attempts.length,candidates:result.candidates.length,layouts:result.groups.length,
    firstGeometry:result.candidates[0]?.geometry,output:directory,viewer:'/story-voice-test-audio/experiments/geometry-execution/viewer.html?result='+encodeURIComponent('/story-voice-test-audio/'+relative)},null,2))
  if(!result.candidates.length)process.exitCode=1
}
main().catch(e=>{console.error(e.stack);process.exitCode=1})
