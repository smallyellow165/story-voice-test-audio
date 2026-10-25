// Planning uses authoritative identities and local resources, independently of
// Generator's supported palette/profiles. Missing geometry remains explicit.
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {catalog} from './brick-games.mjs'
import {inspectBrickModel,brickLibraryRoot} from './brick-library.mjs'
import {randomUUID} from 'node:crypto'
export async function spatialMapping(session,rules,{getMetadata=catalog,inspect=inspectBrickModel,configFile=path.join(brickLibraryRoot(),'LDConfig.ldr')}={}){
 const config=await readFile(configFile,'utf8'),codes=new Set([...config.matchAll(/\bCODE\s+(\d+)\b/g)].map(m=>m[1]))
 const parts=new Map(),colors=new Map(),rows=[]
 for(const source of session.items){
  if(!parts.has(source.part_num))parts.set(source.part_num,await getMetadata('mapping-part',{part_num:source.part_num}))
  if(!colors.has(source.color_id))colors.set(source.color_id,await getMetadata('mapping-color',{color_id:String(source.color_id)}))
  const p=parts.get(source.part_num),c=colors.get(source.color_id),errors=[]
  const official=(p.mappings||[]).filter(m=>m.part_num===source.part_num&&m.ext_system==='LD')
  const exports=[...new Set(official.filter(m=>m.is_export_id===true).map(m=>m.ext_id))]
  const candidates=exports.length?exports:[...new Set(official.map(m=>m.ext_id))]
  if(p.status!=='available'||p.source!=='rb_part_mappings')errors.push('权威 rb_part_mappings 不可用')
  if(!p.known_colors?.includes(source.color_id))errors.push('数据库未确认此型号与颜色组合')
  if(candidates.length!==1)errors.push('官方导出零件映射缺失或不唯一：'+candidates.join(', '))
  const ids=c.external_ids?.LDraw?.ext_ids||[],descriptions=c.external_ids?.LDraw?.ext_descrs||[]
  // Select only an explicit exact official description when one RB color maps
  // to multiple materials (e.g. Black and Rubber_Black). No RGB approximation.
  const normalize=s=>String(s).toLowerCase().replaceAll('_',' ').trim()
  const all=[...new Set(ids.filter(n=>Number.isSafeInteger(n)&&n>=0).map(String))]
  const exact=[...new Set(ids.filter((n,i)=>descriptions[i]?.some(d=>normalize(d)===normalize(c.name))).map(String))]
  const colorCandidates=all.length===1?all:exact
  if(c.status!=='available'||colorCandidates.length!==1)errors.push('官方颜色映射缺失或不唯一：'+all.join(', '))
  const color=colorCandidates[0],part=candidates[0],checks=[]
  if(!codes.has(color))errors.push('本地 LDConfig.ldr 缺少颜色 '+color)
  if(part){const local=await inspect(part),capability=rules.geometrySupport(part);const reasons=[...local.errors]
   if(capability.geometry&&!capability.supported)reasons.push(...capability.reasons)
   for(const expected of capability.geometry?.sourceFiles||[])if(!local.sourceFiles?.some(f=>f.path===expected.path&&f.sha256===expected.sha256))reasons.push('共享几何来源已变化：'+expected.path)
   errors.push(...reasons);if(!local.available)errors.push('本地 LDraw 文件或依赖不可用：'+part)
   checks.push({part,local,capability,supported:capability.supported,eligibilityScope:'planning_identity_and_local_resource',eligible:local.available&&!reasons.length})
  }
  rows.push({source,target:errors.length?null:{part,color,colorName:c.name},errors,partCandidateChecks:checks,evidence:{part:p,color:c},selection:{part:'unique official export ID (or unique official ID)',color:all.length===1?'unique official ID':'unique exact official color description',allColorCandidates:all}})
 }
 return {id:randomUUID(),session,mapping:{rows,valid:rows.every(r=>!r.errors.length)}}
}
