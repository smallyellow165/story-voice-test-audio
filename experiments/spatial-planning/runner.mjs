import { readFile } from 'node:fs/promises'
import { buildSpatialRequest, spatialPromptVersion } from './input.mjs'
import { validatePlan, assessConversion } from './plan.mjs'

const promptFiles=[new URL('./input.mjs',import.meta.url),new URL('../../src/brick-test/spatial-prompt-version.mjs',import.meta.url)]
const loadedPromptSources=await Promise.all(promptFiles.map(f=>readFile(f,'utf8')))
export async function promptRuntimeStatus(){
 const current=await Promise.all(promptFiles.map(f=>readFile(f,'utf8')))
 return {version:spatialPromptVersion,current:current.every((s,i)=>s===loadedPromptSources[i])}
}
import { runStructuredSpatialModel } from '../../server/spatial-model-run.mjs'
export function runSpatialPlanning(prepared, options) {
 return runStructuredSpatialModel(prepared, options, {runtimeStatus:promptRuntimeStatus, promptVersion:spatialPromptVersion, buildRequest:buildSpatialRequest, validate:validatePlan, assess:assessConversion})
}
