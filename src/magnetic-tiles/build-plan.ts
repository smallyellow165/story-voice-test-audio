import { profileFor, validate, vertices,edges,EPS } from './geometry.ts'
import type { Assembly, Connection, Profile, Tile, Vec } from './geometry.ts'
import { checkArtwork, componentPlacement, workMode } from './artwork.ts'
import type { WorkMode } from './geometry.ts'
import { parseAssembly } from './storage.ts'

export type Snapshot = { hash: string; profileHash: string; assembly: Assembly }
export type BuildStep = { id: string; addInstanceId: string; anchor?: { ownEdgeId: string; targetInstanceId: string; targetEdgeId: string;contact?:{ownRange:Vec;targetRange:Vec} }; instruction: string; startsComponent?: true }
export type BuildPlan = { schemaVersion: 1 | 2; mode?: WorkMode; id: string; revision: number; title: string; assemblyRef: { id: string; revision: number; hash: string }; generatorVersion: 'connected-frontier-v1' | 'component-frontier-v1' | 'segmented-frontier-v1' | 'segmented-component-frontier-v1'; steps: BuildStep[] }
export type BuildBundle = { schemaVersion: 1; snapshot: Snapshot; plan: BuildPlan }
export type BuildProgress = { planHash: string; step: number; completed: boolean }
const fail = (message: string): never => { throw Error(message) }
export function exact(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail('数据结构包含无效字段')
}
const text = (s: unknown, max = 180): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= max
const revision = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 1
// Stable object-key order; no rounding of poses. Array order is part of the snapshot.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}'
  return JSON.stringify(value)
}
export async function contentHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
async function profileHash(assembly: Assembly, profiles: readonly Profile[]) {
  const used = [...new Set(assembly.instances.map(t => `${t.profileId}@${t.profileVersion}`))].sort()
  return contentHash(used.map(key => profiles.find(p => `${p.id}@${p.version}` === key) ?? fail(`缺少 Profile ${key}`)))
}
export function contacts(tileId: string, placed: Set<string>, connections: Connection[]) {
  return connections.flatMap(c => {
    const [own, target] = c.a.tileId === tileId ? [c.a, c.b] : [c.b, c.a]
    return own.tileId === tileId && placed.has(target.tileId) ? [{ ownEdgeId: own.edgeId, targetInstanceId: target.tileId, targetEdgeId: target.edgeId,...(c.contact?{contact:{ownRange:c.a.tileId===tileId?c.contact.aRange:c.contact.bRange,targetRange:c.a.tileId===tileId?c.contact.bRange:c.contact.aRange}}:{}) }] : []
  }).sort((a, b) => compare(a.targetInstanceId, b.targetInstanceId) || compare(a.ownEdgeId, b.ownEdgeId) || compare(a.targetEdgeId, b.targetEdgeId))
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
export async function validateBuild(input: unknown, profiles: readonly Profile[]): Promise<BuildBundle> {
  const bundle = structuredClone(input) as BuildBundle
  exact(bundle, ['schemaVersion', 'snapshot', 'plan'])
  if (bundle.schemaVersion !== 1) fail('Build 格式版本不支持')
  const { snapshot: s, plan: p } = bundle
  exact(s, ['hash', 'profileHash', 'assembly'])
  const assembly = parseAssembly(s.assembly, profiles)
  if (!checkArtwork(assembly, profiles).ready) fail('教学来源必须非空、几何合法，并满足作品模式的连通规则')
  if (s.profileHash !== await profileHash(assembly, profiles)) fail('Profile 内容或版本不匹配，不能替换来源规格')
  if (s.hash !== await contentHash({ assembly, profileHash: s.profileHash })) fail('Assembly Snapshot Hash 不一致')
  exact(p, ['schemaVersion', 'id', 'revision', 'title', 'assemblyRef', 'generatorVersion', 'steps', ...(p?.schemaVersion === 2 ? ['mode'] : [])])
  exact(p.assemblyRef, ['id', 'revision', 'hash'])
  if (![1, 2].includes(p.schemaVersion) || (!text(p.id) || ['__proto__', 'constructor', 'prototype'].includes(p.id)) || !revision(p.revision) || !text(p.title) || !['connected-frontier-v1', 'component-frontier-v1','segmented-frontier-v1','segmented-component-frontier-v1'].includes(p.generatorVersion)) fail('Build Plan 信息无效')
  const mosaic = workMode(assembly) === 'flat-mosaic'
  if (p.schemaVersion === 1 ? assembly.schemaVersion !== 1 || !['connected-frontier-v1','segmented-frontier-v1'].includes(p.generatorVersion) : assembly.schemaVersion !== 2 || p.mode !== workMode(assembly) || !['component-frontier-v1','segmented-component-frontier-v1'].includes(p.generatorVersion)) fail('教程模式与来源版本不一致')
  if (p.assemblyRef.id !== assembly.id || p.assemblyRef.revision !== assembly.revision || p.assemblyRef.hash !== s.hash) fail('Build Plan 来源引用不一致')
  if (!Array.isArray(p.steps) || p.steps.length !== assembly.instances.length) fail('步骤必须完整覆盖所有实例')
  const placed = new Set<string>(), stepIds = new Set<string>()
  const finalReport = validate(assembly.instances, profiles), all = finalReport.connections
  if(all.some(c=>c.contact)&&!p.generatorVersion.startsWith('segmented-'))fail('分段连接教程必须记录分段生成器版本')
  const componentOf = (id: string) => finalReport.components.find(c => c.includes(id))!
  for (const step of p.steps) {
    exact(step, ['id', 'addInstanceId', 'anchor', 'instruction', ...(p.schemaVersion === 2 ? ['startsComponent'] : [])])
    if (!text(step.id) || stepIds.has(step.id) || !text(step.instruction, 500)) fail('步骤 ID 或说明无效')
    stepIds.add(step.id)
    if (!assembly.instances.some(t => t.id === step.addInstanceId) || placed.has(step.addInstanceId)) fail('实例重复或不存在')
    const options = contacts(step.addInstanceId, placed, all)
    const firstInComponent = !componentOf(step.addInstanceId).some(id => placed.has(id))
    const independent = mosaic && firstInComponent
    if (placed.size && !independent) {
      exact(step.anchor, ['ownEdgeId', 'targetInstanceId', 'targetEdgeId','contact'])
      if(step.anchor?.contact)exact(step.anchor.contact,['ownRange','targetRange'])
      if (!options.some(a => {
        const b=step.anchor!
        if(a.ownEdgeId!==b.ownEdgeId||a.targetInstanceId!==b.targetInstanceId||a.targetEdgeId!==b.targetEdgeId)return false
        if(!a.contact||!b.contact)return !a.contact&&!b.contact
        const own=edges(assembly.instances.find(t=>t.id===step.addInstanceId)!,profiles).find(e=>e.id===a.ownEdgeId)!,target=edges(assembly.instances.find(t=>t.id===a.targetInstanceId)!,profiles).find(e=>e.id===a.targetEdgeId)!
        // Persisted intervals tolerate only the existing world-space EPS, including
        // the last-bit trigonometric differences between JS runtimes.
        return ([['ownRange',own.length],['targetRange',target.length]] as const).every(([key,length])=>{
          const range=b.contact![key],expected=a.contact![key]
          return Array.isArray(range)&&range.length===2&&range.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&range[1]>range[0]&&range.every((n,i)=>Math.abs(n-expected[i])*length<=EPS)
        })
      })) fail('步骤连接边不存在或目标尚未放置')
    } else if (step.anchor !== undefined) fail('组件起始步骤不能虚构连接目标')
    if (p.schemaVersion === 2 && (independent ? step.startsComponent !== true : step.startsComponent !== undefined)) fail('组件起始标记不正确')
    // A component is built as a connected prefix even when other components exist.
    placed.add(step.addInstanceId)
    const prefix = assembly.instances.filter(t => placed.has(t.id)), report = validate(prefix, profiles)
    if (!report.draftValid || (!mosaic && !report.valid)) fail('步骤完成后的结构不合法或不连通')
    for (const component of finalReport.components) {
      const members = prefix.filter(t => component.includes(t.id))
      if (members.length && !validate(members, profiles).valid) fail('同一组件内的步骤必须沿真实连接展开')
    }
  }
  return bundle
}
export async function generateBuild(input: Assembly, profiles: readonly Profile[]): Promise<BuildBundle> {
  const assembly = parseAssembly(input, profiles), report = validate(assembly.instances, profiles)
  if (!checkArtwork(assembly, profiles).ready) fail('作品尚未满足当前模式的几何与连通要求')
  const mosaic = workMode(assembly) === 'flat-mosaic'
  const center = (t: Tile) => vertices(t, profiles).reduce((s, v, _, vs) => [s[0] + v[0] / vs.length, s[1] + v[1] / vs.length], [0, 0])
  const sorted = [...assembly.instances].sort((a, b) => center(a)[1] - center(b)[1] || center(a)[0] - center(b)[0] || compare(a.id, b.id))
  const components = [...report.components].sort((a,b)=>b.length-a.length || compare(a[0],b[0]))
  const placed = new Set<string>(), steps: BuildStep[] = []
  for (const component of components) {
    const members = sorted.filter(t=>component.includes(t.id)), root = members.find(t=>t.profileId==='square') ?? members[0]
    for (let index=0; index<members.length; index++) {
      const tile = index ? members.find(t=>!placed.has(t.id)&&contacts(t.id,placed,report.connections).length)! : root
      if (!tile) fail('无法找到与已有结构连接的下一块')
      const anchor = contacts(tile.id, placed, report.connections)[0]
      const previous = steps.map(s=>assembly.instances.find(t=>t.id===s.addInstanceId)!)
      steps.push({ id: `place-${tile.id}`, addInstanceId: tile.id, ...(anchor ? { anchor } : {}), ...(mosaic && index===0 ? {startsComponent:true as const} : {}), instruction: (anchor?.contact?'按画布保持错位，仅对齐亮起的接触段。':'')+(tile.pose.mirrored?'先将这块翻面。':'') + (anchor ? `拿一块${profileFor(tile, profiles)!.name}，沿第 ${steps.findIndex(s => s.addInstanceId === anchor.targetInstanceId) + 1} 块亮起的边放好。` : mosaic ? componentPlacement(tile,previous,profiles) : `先放好这块${profileFor(tile, profiles)!.name}。`) })
      placed.add(tile.id)
    }
  }
  const ph = await profileHash(assembly, profiles), hash = await contentHash({ assembly, profileHash: ph })
  return validateBuild({ schemaVersion: 1, snapshot: { hash, profileHash: ph, assembly }, plan: { schemaVersion: assembly.schemaVersion, ...(assembly.schemaVersion === 2 ? {mode:workMode(assembly)} : {}), id: crypto.randomUUID(), revision: 1, title: assembly.name, assemblyRef: { id: assembly.id, revision: assembly.revision, hash }, generatorVersion: report.connections.some(c=>c.contact)?assembly.schemaVersion===1?'segmented-frontier-v1':'segmented-component-frontier-v1':assembly.schemaVersion === 1 ? 'connected-frontier-v1' : 'component-frontier-v1', steps } }, profiles)
}
export function validateProgress(value: BuildProgress, plan: BuildPlan, planHash: string): BuildProgress {
  exact(value, ['planHash', 'step', 'completed'])
  if (value.planHash !== planHash || !Number.isInteger(value.step) || value.step < 0 || value.step >= plan.steps.length || typeof value.completed !== 'boolean' || (value.completed && value.step !== plan.steps.length - 1)) fail('播放进度与方案不一致')
  return value
}
