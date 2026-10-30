import { canonical, contentHash, exact, validateBuild, validateProgress } from './build-plan.ts'
import type { BuildBundle, BuildPlan, BuildProgress, Snapshot } from './build-plan.ts'
import type { Profile } from './geometry.ts'
export const BUILD_KEY = 'magnetic-tiles.build.v1'
export type BuildLibrary = { schemaVersion: 1; snapshots: Snapshot[]; plans: BuildPlan[]; preview: BuildBundle | null; activeId: string | null; progress: Record<string, BuildProgress>; retainedPreviews?: BuildBundle[] }
export const emptyLibrary = (): BuildLibrary => ({ schemaVersion: 1, snapshots: [], plans: [], preview: null, activeId: null, progress: {} })
export function bundleFor(library: BuildLibrary, id: string | null): BuildBundle | null {
  if (!id) return null
  if (library.preview?.plan.id === id) return library.preview
  const retained=library.retainedPreviews?.find(b=>b.plan.id===id)
  if(retained)return retained
  const plan = library.plans.find(p => p.id === id)
  if (!plan) throw Error('找不到教程')
  const snapshot = library.snapshots.find(s => s.hash === plan.assemblyRef.hash)
  if (!snapshot) throw Error('教程来源快照缺失')
  return { schemaVersion: 1, plan, snapshot }
}
export async function parseLibrary(input: unknown, profiles: readonly Profile[]): Promise<BuildLibrary> {
  const l = structuredClone(input) as BuildLibrary
  exact(l, ['schemaVersion', 'snapshots', 'plans', 'preview', 'activeId', 'progress', ...(l&&typeof l==='object'&&'retainedPreviews' in l ? ['retainedPreviews'] : [])])
  if (l.schemaVersion !== 1 || !Array.isArray(l.plans) || !Array.isArray(l.snapshots) || l.plans.length > 50 || l.snapshots.length > 50 || !l.progress || typeof l.progress !== 'object' || Array.isArray(l.progress)) throw Error('教程存档格式无效或超过 50 个方案')
  const ids = new Set<string>(), hashes = new Set<string>()
  for (const s of l.snapshots) { if (hashes.has(s.hash)) throw Error('快照重复'); hashes.add(s.hash) }
  for (const p of l.plans) {
    if (ids.has(p.id)) throw Error('教程 ID 重复')
    ids.add(p.id)
    await validateBuild({ schemaVersion: 1, plan: p, snapshot: l.snapshots.find(s => s.hash === p.assemblyRef.hash) }, profiles)
  }
  if (l.snapshots.some(s => !l.plans.some(p => p.assemblyRef.hash === s.hash))) throw Error('存在无引用快照')
  if (l.preview !== null) {
    const b = await validateBuild(l.preview, profiles)
    if (ids.has(b.plan.id)) throw Error('预览与保存教程 ID 冲突')
    ids.add(b.plan.id)
  }
  if(l.retainedPreviews!==undefined){
    if(!Array.isArray(l.retainedPreviews)||l.retainedPreviews.length>50)throw Error('保留预览格式无效或超过50个')
    for(const b of l.retainedPreviews){await validateBuild(b,profiles);if(ids.has(b.plan.id))throw Error('保留预览ID重复');ids.add(b.plan.id)}
  }
  if (l.activeId !== null && !ids.has(l.activeId)) throw Error('当前教程引用无效')
  for (const [id, progress] of Object.entries(l.progress)) {
    if (!ids.has(id)) throw Error('播放进度来源不存在')
    const b = bundleFor(l, id)!
    validateProgress(progress, b.plan, await contentHash(b.plan))
  }
  return l
}
export async function loadLibrary(storage: Pick<Storage, 'getItem'>, profiles: readonly Profile[]) {
  const raw = storage.getItem(BUILD_KEY)
  return raw === null ? emptyLibrary() : parseLibrary(JSON.parse(raw), profiles)
}
export async function saveLibrary(storage: Pick<Storage, 'setItem'>, library: BuildLibrary, profiles: readonly Profile[]) {
  const checked = await parseLibrary(library, profiles)
  storage.setItem(BUILD_KEY, JSON.stringify(checked))
  return checked
}
// A saved ID/revision is immutable. Conflicting imports never overwrite it.
export async function storeBundle(library: BuildLibrary, input: unknown, profiles: readonly Profile[]): Promise<BuildLibrary> {
  const b = await validateBuild(input, profiles), l = structuredClone(library)
  const known=[l.preview,...(l.retainedPreviews??[])].find(item=>item?.plan.id===b.plan.id)
  if(known&&canonical(known)!==canonical(b))throw Error('教程 ID 已存在且内容不同；未覆盖保留预览')
  const existing = l.plans.find(p => p.id === b.plan.id)
  if (existing && canonical(existing) !== canonical(b.plan)) throw Error('教程 ID 已存在且内容不同；未覆盖已保存方案')
  if (!existing) l.plans.push(b.plan)
  if (!l.snapshots.some(s => s.hash === b.snapshot.hash)) l.snapshots.push(b.snapshot)
  if (l.preview?.plan.id === b.plan.id) l.preview = null
  if(l.retainedPreviews)l.retainedPreviews=l.retainedPreviews.filter(p=>p.plan.id!==b.plan.id)
  l.activeId = b.plan.id
  return parseLibrary(l, profiles)
}

// Reuse the same library/key and immutable bundle validation. Replacing the visible
// preview archives it as UNSAVED, with its original progress, rather than deleting it.
export async function retainBuildPreview(library:BuildLibrary,input:BuildBundle,profiles:readonly Profile[]){
 const b=await validateBuild(input,profiles),l=structuredClone(library),known=l.preview?.plan.id===b.plan.id?l.preview:l.retainedPreviews?.find(item=>item.plan.id===b.plan.id)??(l.plans.some(item=>item.id===b.plan.id)?bundleFor(l,b.plan.id):null)
 if(known&&canonical(known)!==canonical(b))throw Error('教程ID已存在且内容不同；未覆盖预览')
 if(l.preview&&l.preview.plan.id!==b.plan.id){l.retainedPreviews=[...(l.retainedPreviews??[]),l.preview]}
 if(l.retainedPreviews)l.retainedPreviews=l.retainedPreviews.filter(item=>item.plan.id!==b.plan.id)
 l.preview=b;l.activeId=b.plan.id
 return parseLibrary(l,profiles)
}
