import { profileFor, validate, vertices } from './geometry.ts'
import type { Assembly, Connection, Profile, Tile } from './geometry.ts'
import { parseAssembly } from './storage.ts'

export type Snapshot = { hash: string; profileHash: string; assembly: Assembly }
export type BuildStep = { id: string; addInstanceId: string; anchor?: { ownEdgeId: string; targetInstanceId: string; targetEdgeId: string }; instruction: string }
export type BuildPlan = { schemaVersion: 1; id: string; revision: number; title: string; assemblyRef: { id: string; revision: number; hash: string }; generatorVersion: 'connected-frontier-v1'; steps: BuildStep[] }
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
    return own.tileId === tileId && placed.has(target.tileId) ? [{ ownEdgeId: own.edgeId, targetInstanceId: target.tileId, targetEdgeId: target.edgeId }] : []
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
  if (!validate(assembly.instances, profiles).valid) fail('教学来源必须非空、几何合法且整体连通')
  if (s.profileHash !== await profileHash(assembly, profiles)) fail('Profile 内容或版本不匹配，不能替换来源规格')
  if (s.hash !== await contentHash({ assembly, profileHash: s.profileHash })) fail('Assembly Snapshot Hash 不一致')
  exact(p, ['schemaVersion', 'id', 'revision', 'title', 'assemblyRef', 'generatorVersion', 'steps'])
  exact(p.assemblyRef, ['id', 'revision', 'hash'])
  if (p.schemaVersion !== 1 || (!text(p.id) || ['__proto__', 'constructor', 'prototype'].includes(p.id)) || !revision(p.revision) || !text(p.title) || p.generatorVersion !== 'connected-frontier-v1') fail('Build Plan 信息无效')
  if (p.assemblyRef.id !== assembly.id || p.assemblyRef.revision !== assembly.revision || p.assemblyRef.hash !== s.hash) fail('Build Plan 来源引用不一致')
  if (!Array.isArray(p.steps) || p.steps.length !== assembly.instances.length) fail('步骤必须完整覆盖所有实例')
  const placed = new Set<string>(), stepIds = new Set<string>()
  const all = validate(assembly.instances, profiles).connections
  for (const step of p.steps) {
    exact(step, ['id', 'addInstanceId', 'anchor', 'instruction'])
    if (!text(step.id) || stepIds.has(step.id) || !text(step.instruction, 500)) fail('步骤 ID 或说明无效')
    stepIds.add(step.id)
    if (!assembly.instances.some(t => t.id === step.addInstanceId) || placed.has(step.addInstanceId)) fail('实例重复或不存在')
    const options = contacts(step.addInstanceId, placed, all)
    if (placed.size) {
      exact(step.anchor, ['ownEdgeId', 'targetInstanceId', 'targetEdgeId'])
      if (!options.some(a => canonical(a) === canonical(step.anchor))) fail('步骤连接边不存在或目标尚未放置')
    } else if (step.anchor !== undefined) fail('第一步不能引用连接目标')
    placed.add(step.addInstanceId)
    if (!validate(assembly.instances.filter(t => placed.has(t.id)), profiles).valid) fail('步骤完成后的结构不合法或不连通')
  }
  return bundle
}
export async function generateBuild(input: Assembly, profiles: readonly Profile[]): Promise<BuildBundle> {
  const assembly = parseAssembly(input, profiles), report = validate(assembly.instances, profiles)
  if (!report.valid) fail('请先搭好非空、几何合法且整体连通的作品')
  const center = (t: Tile) => vertices(t, profiles).reduce((s, v, _, vs) => [s[0] + v[0] / vs.length, s[1] + v[1] / vs.length], [0, 0])
  const sorted = [...assembly.instances].sort((a, b) => center(a)[1] - center(b)[1] || center(a)[0] - center(b)[0] || compare(a.id, b.id))
  const root = sorted.find(t => t.profileId === 'square') ?? sorted[0]
  const placed = new Set<string>(), steps: BuildStep[] = []
  while (placed.size < sorted.length) {
    const tile = placed.size ? sorted.find(t => !placed.has(t.id) && contacts(t.id, placed, report.connections).length)! : root
    if (!tile) fail('无法找到与已有结构连接的下一块')
    const anchor = contacts(tile.id, placed, report.connections)[0]
    steps.push({ id: `place-${tile.id}`, addInstanceId: tile.id, ...(anchor ? { anchor } : {}), instruction: anchor ? `拿一块${profileFor(tile, profiles)!.name}，沿第 ${steps.findIndex(s => s.addInstanceId === anchor.targetInstanceId) + 1} 块亮起的边放好。` : `先放好这块${profileFor(tile, profiles)!.name}。` })
    placed.add(tile.id)
  }
  const ph = await profileHash(assembly, profiles), hash = await contentHash({ assembly, profileHash: ph })
  return validateBuild({ schemaVersion: 1, snapshot: { hash, profileHash: ph, assembly }, plan: { schemaVersion: 1, id: crypto.randomUUID(), revision: 1, title: assembly.name, assemblyRef: { id: assembly.id, revision: assembly.revision, hash }, generatorVersion: 'connected-frontier-v1', steps } }, profiles)
}
export function validateProgress(value: BuildProgress, plan: BuildPlan, planHash: string): BuildProgress {
  exact(value, ['planHash', 'step', 'completed'])
  if (value.planHash !== planHash || !Number.isInteger(value.step) || value.step < 0 || value.step >= plan.steps.length || typeof value.completed !== 'boolean' || (value.completed && value.step !== plan.steps.length - 1)) fail('播放进度与方案不一致')
  return value
}
