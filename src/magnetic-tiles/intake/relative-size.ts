import type { Profile, Vec } from '../geometry.ts'
import type { Observation } from './contracts.ts'
import { matchOutline, outlineEvidenceKey } from './profile-match.ts'

export type ScaleReference = { observationId: string; profileId: string; profileVersion: number; pixelsPerUnit: number; shapeScore: number; uncertainty: string }
export type RelativeScale = { status: 'known' | 'unknown'; pixelsPerUnit: number | null; references: ScaleReference[]; rejectedIds: string[]; spread: number | null; reason: string }
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
const median = (xs: number[]) => { const a = [...xs].sort((a,b)=>a-b), m = Math.floor(a.length/2); return a.length % 2 ? a[m] : (a[m-1]+a[m])/2 }
// RMS vertex radius is rotation/reflection invariant and linear in physical size.
export function outlineRadius(v: readonly Vec[]): number {
  const x = mean(v.map(p=>p[0])), y = mean(v.map(p=>p[1]))
  return Math.sqrt(mean(v.map(p=>(p[0]-x)**2+(p[1]-y)**2)))
}
const pixels = (o: Observation, width: number, height: number): Vec[] => o.outline.map(([x,y])=>[x*width,y*height])
const sameIdentity = (p: Profile, o: Observation) => p.id === o.profileId && p.version === o.profileVersion
function ambiguousSize(p: Profile, catalog: readonly Profile[]) {
  // Use the existing shape matcher to detect scale-equivalent catalog entries.
  const r = outlineRadius(p.vertices), cx = mean(p.vertices.map(v=>v[0])), cy = mean(p.vertices.map(v=>v[1]))
  const outline: Vec[] = p.vertices.map(([x,y])=>[.5+(x-cx)/(8*r),.5+(y-cy)/(8*r)])
  return matchOutline(outline,1,1,catalog).candidates.some(c=> {
    const other = catalog.find(q=>q.id===c.profileId&&q.version===c.profileVersion)!
    return c.similarityScore > 99.999 && Math.abs(Math.log(outlineRadius(other.vertices)/r)) > 1e-6
  })
}

export function estimateRelativeScale(observations: readonly Observation[], targetId: string, width: number, height: number, catalog: readonly Profile[], confirmedOutlines: ReadonlySet<string> = new Set(), sourceId = ''): RelativeScale {
  const unknown = (reason: string, rejectedIds: string[] = []): RelativeScale => ({status:'unknown',pixelsPerUnit:null,references:[],rejectedIds,spread:null,reason})
  const eligible: ScaleReference[] = []
  for (const o of observations) {
    if (o.id === targetId || o.excluded || o.profileId === 'unknown') continue
    const p = catalog.find(p=>sameIdentity(p,o))
    if (!p) continue
    const confirmed = confirmedOutlines.has(outlineEvidenceKey(o,sourceId))
    // A Known identity + high confidence + independently measured shape quality
    // is usable despite minor textual uncertainty, which is retained for display.
    // Scale-ambiguous identities additionally need explicit human confirmation.
    if ((!confirmed && o.confidence < .9) || (!confirmed && ambiguousSize(p,catalog))) continue
    const match = matchOutline(o.outline,width,height,[p]).candidates[0]
    if (!match || match.similarityScore < 80) continue
    const scale = outlineRadius(pixels(o,width,height)) / outlineRadius(p.vertices)
    if (scale < 8) continue // avoid a sub-pixel contour dominating calibration
    eligible.push({observationId:o.id,profileId:p.id,profileVersion:p.version,pixelsPerUnit:scale,shapeScore:match.similarityScore,uncertainty:o.uncertainty})
  }
  if (!eligible.length) return unknown('Size Unknown：没有可靠的已知规格参考（排除自身、Unknown、Excluded、低置信度、形状不符及未核实的同形异尺寸零件）。')
  // Standard unit squares take precedence; do not mix weaker families into them.
  const squares = eligible.filter(r=>r.profileId==='square'&&r.profileVersion===1)
  const pool = squares.length ? squares : eligible
  const centre = median(pool.map(r=>Math.log(r.pixelsPerUnit)))
  const inliers = pool.filter(r=>Math.abs(Math.log(r.pixelsPerUnit)-centre)<=Math.log(1.25)+1e-10)
  const rejectedIds = pool.filter(r=>!inliers.includes(r)).map(r=>r.observationId)
  if (inliers.length <= pool.length/2) return unknown('Size Unknown：尺度参考冲突，±25% 范围内没有严格多数共识；请核实 Profile、轮廓与透视。',pool.map(r=>r.observationId))
  const logScale = mean(inliers.map(r=>Math.log(r.pixelsPerUnit)))
  const spread = Math.sqrt(mean(inliers.map(r=>(Math.log(r.pixelsPerUnit)-logScale)**2)))
  return {status:'known',pixelsPerUnit:Math.exp(logScale),references:inliers,rejectedIds,spread,reason:`${squares.length?'标准正方形优先；':''}${inliers.length} 个参考 ${inliers.map(r=>r.observationId).join('、')}，稳健尺度 ${Math.exp(logScale).toFixed(2)} px / 单位${rejectedIds.length?`；剔除离群参考 ${rejectedIds.join('、')}`:''}。${inliers.length===1?'仅单参考；无法交叉验证。':''}已知规格为前提，原始不确定证据仍保留。`}
}

export type RelativeSizeScore = { relativeSizeScore: number | null; sizeRatio: number | null; sizeExplanation: string }
export function scoreRelativeSize(o: Observation, p: Profile, width: number, height: number, scale: RelativeScale): RelativeSizeScore {
  if (scale.status==='unknown') return {relativeSizeScore:null,sizeRatio:null,sizeExplanation:scale.reason}
  const observed = outlineRadius(pixels(o,width,height)), expected = scale.pixelsPerUnit! * outlineRadius(p.vertices)
  const sizeRatio = observed / expected
  // 25% multiplicative error is the half-score reference, widened by measured
  // reference spread (at most 40%). No hard rejection and no probability claim.
  const tolerance = Math.min(Math.log(1.4),Math.max(Math.log(1.25),2*scale.spread!))
  const relativeSizeScore = 100 * 2 ** (-((Math.log(sizeRatio)/tolerance)**2))
  return {relativeSizeScore,sizeRatio,sizeExplanation:`轮廓 RMS 半径 ${observed.toFixed(2)} px；候选预期 ${expected.toFixed(2)} px；观察 / 预期 = ${sizeRatio.toFixed(3)}（${((sizeRatio-1)*100).toFixed(1)}%）；半分误差 ×${Math.exp(tolerance).toFixed(2)}。`}
}

export function matchRelativeProfiles(o: Observation, width: number, height: number, catalog: readonly Profile[], scale: RelativeScale) {
  const shape = matchOutline(o.outline,width,height,catalog)
  const candidates = shape.candidates.map(c=> {
    const p = catalog.find(p=>p.id===c.profileId&&p.version===c.profileVersion)!
    const size: RelativeSizeScore = c.vertexDifference ? {relativeSizeScore:null,sizeRatio:null,sizeExplanation:'顶点数不同，尺寸不可比'} : scoreRelativeSize(o,p,width,height,scale)
    return {...c,...size,recommendationScore:c.similarityScore*(size.relativeSizeScore??100)/100}
  }).sort((a,b)=>b.recommendationScore-a.recommendationScore||a.rank-b.rank).map((c,i)=>({...c,rank:i+1}))
  return {...shape,reason:shape.status==='invalid'?shape.reason:'Shape Score 保留原形状算法；Relative Size Score 使用同图已知 Profile 的稳健尺度，二者独立显示并共同排序。',scale,candidates}
}
