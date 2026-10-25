import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { loadBrickRules, geometrySnapshot } from '../../server/brick-rules.mjs'
import { solveGeometry } from './solver.mjs'
import { inputFromSavedAnalysis } from './input.mjs'

const root = fileURLToPath(new URL('../../',import.meta.url))
const defaults = { analysis: path.join(root,'generated/brick-reverse/0474c775-ae2f-40d7-87d2-dd0e2b4ee3fa.json'),
  trace: path.join(root,'generated/brick-design-traces/0faf5079-d553-430f-9f12-fc95d190b769.json'),
  hints: path.join(root,'experiments/geometry-solver/camel-hints.json'), output: path.join(root,'output/geometry-solver') }
async function main() {
  const args = { ...defaults }, options = {}
  const numeric = { '--beam-width':'beamWidth', '--max-expansions':'maxExpansions', '--max-ms':'maxMs', '--max-candidates':'maxCandidates' }
  for (let i=2;i<process.argv.length;i+=2) {
    const flag=process.argv[i], value=process.argv[i+1]
    if (!value) throw new Error('Missing value for '+flag)
    if (numeric[flag]) options[numeric[flag]]=Number(value)
    else if (['--analysis','--trace','--hints','--output','--input'].includes(flag)) args[flag.slice(2)]=path.resolve(value)
    else throw new Error('Unknown option '+flag)
  }
  const sources = []
  async function json(file) { const raw=await readFile(file); sources.push({path:file,sha256:createHash('sha256').update(raw).digest('hex')}); return JSON.parse(raw) }
  const input = args.input ? await json(args.input) : inputFromSavedAnalysis(await json(args.analysis),await json(args.trace),await json(args.hints))
  const rules = await loadBrickRules()
  const result = solveGeometry(input,rules,options)
  const output = path.join(args.output,new Date().toISOString().replaceAll(':','-')+'-'+randomUUID())
  await mkdir(output,{recursive:true})
  const save = (name,value) => writeFile(path.join(output,name),JSON.stringify(value,null,2),{flag:'wx'})
  let snapshot = null, snapshotError = null
  try { snapshot = geometrySnapshot(rules,input.inventory) } catch (error) { snapshotError = String(error) }
  await save('report.json',{...result,sources,input,geometrySnapshot:snapshot,snapshotError})
  for (const [i,c] of result.candidates.entries()) await save('candidate-'+(i+1)+'.json',c)
  console.log(JSON.stringify({status:result.status,termination:result.termination,stats:result.stats,output,candidates:result.candidates.map((c,i)=>({file:'candidate-'+(i+1)+'.json',geometryValid:c.geometry.valid,reference:c.reference.score,violated:c.reference.violated,supportFailures:c.support.filter(s=>!s.passesExistingThreshold),buildOrderValid:c.buildOrder.report.valid}))},null,2))
}
main().catch(error => { console.error(error.stack || String(error)); process.exitCode=1 })
