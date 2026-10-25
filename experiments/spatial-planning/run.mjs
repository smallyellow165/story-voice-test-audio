import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { loadBrickRules } from '../../server/brick-rules.mjs'
import { modelOptions } from '../../server/brick-model-registry.mjs'
import { prepareInput } from './input.mjs'
import { runSpatialPlanning } from './runner.mjs'
import { renderReport } from './report.mjs'

const root = fileURLToPath(new URL('../../',import.meta.url))
async function main() {
  const args = {analysis:path.join(root,'generated/brick-reverse/0474c775-ae2f-40d7-87d2-dd0e2b4ee3fa.json'),
    trace:path.join(root,'generated/brick-design-traces/0faf5079-d553-430f-9f12-fc95d190b769.json'),
    output:path.join(root,'generated/brick-spatial-traces'),execute:false,includeEvidence:true}
  for (let i=2;i<process.argv.length;i++) {
    const flag=process.argv[i]
    if (flag === '--run') args.execute=true
    else if (flag === '--photo-only') args.includeEvidence=false
    else if (flag === '--models') { console.log(JSON.stringify(modelOptions('design'),null,2)); return }
    else if (flag === '--help') {
      console.log('node experiments/spatial-planning/run.mjs --model <registered-id> [--run] [--photo-only] [--analysis file] [--trace file] [--output directory]\nDefault: save prepared request + HTML, no network. --run: exactly one multimodal request. --models: registered choices. No recognition, repair or geometry solver.'); return
    } else if (['--model','--analysis','--trace','--output'].includes(flag)) {
      const value=process.argv[++i]
      if (!value || value.startsWith('--')) throw new Error('Missing value: '+flag)
      args[flag.slice(2)]=flag === '--model' ? value : path.resolve(value)
    } else throw new Error('Unknown option '+flag)
  }
  if (!args.model) throw new Error('Select an existing registered model explicitly with --model; use --models to list')
  const sources=[]
  async function readJSON(file) {
    const raw=await readFile(file)
    sources.push({path:file,sha256:createHash('sha256').update(raw).digest('hex')})
    return JSON.parse(raw)
  }
  const analysis=await readJSON(args.analysis), trace=await readJSON(args.trace)
  const prepared=prepareInput(analysis,trace,await loadBrickRules(),{includeEvidence:args.includeEvidence})
  const record=await runSpatialPlanning(prepared,{model:args.model,directory:args.output,sources,execute:args.execute})
  const report=path.join(args.output,record.id+'.html')
  await writeFile(report,renderReport(record),{flag:'wx',mode:0o600})
  console.log(JSON.stringify({status:record.status,id:record.id,trace:record.tracePath,report,
    rawRequest:record.rawRequestPath,rawResponse:record.rawResponsePath,validation:record.validation,
    conversionStatus:record.conversion?.status},null,2))
  if (args.execute && record.status !== 'plan_ready_for_review') process.exitCode=1
}
main().catch(error => { console.error(error.message); process.exitCode=1 })
