import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {brickLibraryRoot,inspectBrickModel} from './brick-library.mjs'

// Execution enrichment is recorded separately; original trace and non-null profiles
// are never rewritten. Geometry does not inherit Generator's appearance palette.
export async function prepareGeometryInput(original,rules,{configFile=path.join(brickLibraryRoot(),'LDConfig.ldr'),inspect=inspectBrickModel}={}) {
 const input=structuredClone(original),enrichments=[],issues=[]
 const config=await readFile(configFile,'utf8')
 const codes=new Set([...config.matchAll(/^0\s+!COLOUR\s+\S+\s+CODE\s+(\d+)\b/gm)].map(m=>m[1]))
 const checked=new Map()
 for(const o of input.observations){
  if(!codes.has(o.color))issues.push('LDraw 官方颜色不可用：'+o.id+' / '+o.color)
  const g=rules.geometrySupport(o.part)
  if(!g.supported){issues.push('缺少 Geometry Profile：'+o.id+' / '+o.part);continue}
  if(!checked.has(o.part)){
   const local=await inspect(o.part)
   const errors=[...local.errors]
   if(!local.available)errors.push('LDraw 模型不可用：'+o.part)
   for(const f of g.geometry.sourceFiles||[])if(!local.sourceFiles?.some(s=>s.path===f.path&&s.sha256===f.sha256))errors.push('Geometry Profile 来源已变化：'+f.path)
   checked.set(o.part,errors)
  }
  issues.push(...checked.get(o.part))
  if(o.geometry===null&&!checked.get(o.part).length){
   o.geometry=structuredClone(g.geometry)
   enrichments.push({id:o.id,part:o.part,previousGeometry:null,geometry:o.geometry,reason:'Previously unknown profile now reviewed; pose, identity and color unchanged'})
  }
 }
 return {input,enrichments,issues:[...new Set(issues)]}
}
