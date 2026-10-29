// Image-space fitting is approximate. All committed connections still use geometry.ts EPS.
import { alignEdge, distance, edges, validate, vertices, EPS } from '../geometry.ts'
import type { Profile, Tile, Vec } from '../geometry.ts'
import { parseEvidence } from './contracts.ts'
import type { Candidate, Evidence, Observation } from './contracts.ts'
export const reconstructionVersion = 'planar-outline-v1'
const MAX_STATES = 3000, MAX_ERROR = .30
const mean = (v: Vec[]): Vec => [v.reduce((s,p)=>s+p[0],0)/v.length,v.reduce((s,p)=>s+p[1],0)/v.length]
const variants = (v: Vec[]) => [v,[...v].reverse()].flatMap(a=>a.map((_,i)=>[...a.slice(i),...a.slice(0,i)]))
const rms = (a: Vec[],b: Vec[]) => Math.sqrt(a.reduce((s,p,i)=>s+distance(p,b[i])**2,0)/a.length)
export function reconstruct(input: Evidence, width: number, height: number, profiles: readonly Profile[], assemblyId: string) {
  const evidence = parseEvidence(input), diagnostics: string[] = [], observations = evidence.observations.filter(o=>!o.excluded)
  const empty = () => ({ candidates: [] as Candidate[], diagnostics, explored: 0, truncated: false })
  if (evidence.sourceKind === 'unsupported') { diagnostics.push('图片被标为超出二维范围：'+evidence.reason); return empty() }
  if (!observations.length || observations.length > 12) {
    diagnostics.push('V1 只重建 1–12 块；请修正误检、漏检或拆分输入。')
    const unresolved=observations.filter(o=>!evidence.relations.some(r=>r.intent==='connect'&&(r.from===o.id||r.to===o.id)))
    if(observations.length>1&&unresolved.length)diagnostics.push('这些零件没有明确整边连接证据：'+unresolved.map(o=>o.id).join('、')+'；点接触不构成磁吸整边连接。')
    return empty()
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw Error('图片尺寸无效')
  const image = new Map<string,Vec[]>(), ratios: number[] = []
  for (const o of observations) {
    const p = profiles.find(p=>p.id===o.profileId&&p.version===o.profileVersion)
    if (!p) { diagnostics.push(o.id+'：缺少可用 Profile，不能猜测替换。'); continue }
    if (o.outline.length !== p.vertices.length) { diagnostics.push(o.id+'：外轮廓顶点数与 Profile 不一致，请修正外边界；不要描内部磁条。'); continue }
    const pts = o.outline.map(([x,y]):Vec=>[x*width,-y*height]); image.set(o.id,pts)
    const a = pts.map((v,i)=>distance(v,pts[(i+1)%pts.length])).sort((x,y)=>x-y)
    const b = p.vertices.map((v,i)=>distance(v,p.vertices[(i+1)%p.vertices.length])).sort((x,y)=>x-y)
    a.forEach((l,i)=>ratios.push(l/b[i]))
  }
  if (diagnostics.length) return empty()
  ratios.sort((a,b)=>a-b)
  const scale = ratios[Math.floor(ratios.length/2)]
  if (scale < 2) { diagnostics.push('外轮廓退化或像素尺度太小。'); return empty() }
  for (const [id,pts] of image) image.set(id,pts.map(([x,y])=>[x/scale,y/scale]))
  const error = (t: Tile) => Math.min(...variants(image.get(t.id)!).map(v=>rms(vertices(t,profiles),v)))
  function fitted(o: Observation): Tile {
    const p = profiles.find(p=>p.id===o.profileId&&p.version===o.profileVersion)!, local = p.vertices, lc = mean(local)
    let best: Tile | null = null, score = Infinity
    for (const target of variants(image.get(o.id)!)) {
      const tc=mean(target); let dot=0,cross=0
      local.forEach((v,i)=>{const x=v[0]-lc[0],y=v[1]-lc[1],u=target[i][0]-tc[0],w=target[i][1]-tc[1];dot+=x*u+y*w;cross+=x*w-y*u})
      const angleRad=Math.atan2(cross,dot),c=Math.cos(angleRad),s=Math.sin(angleRad)
      const t: Tile={id:o.id,profileId:p.id,profileVersion:p.version,color:o.color,pose:{x:tc[0]-c*lc[0]+s*lc[1],y:tc[1]-s*lc[0]-c*lc[1],angleRad}}
      const e=error(t);if(e<score-1e-10){best=t;score=e}
    }
    return best!
  }
  const approx = observations.map(fitted).sort((a,b)=>a.id<b.id?-1:1)
  if (approx.some(t=>error(t)>MAX_ERROR)) { diagnostics.push('轮廓无法用统一规格比例拟合：可能是错误形状、透视、不同尺寸或边界不准确。'); return empty() }
  // Stronger contour fits first; a square resolves its symmetric orientation canonically.
  const root=[...approx].sort((a,b)=>Number(b.profileId==='square')-Number(a.profileId==='square')||error(a)-error(b)||a.id.localeCompare(b.id))[0]
  const required=evidence.relations.filter(r=>observations.some(o=>o.id===r.from)&&observations.some(o=>o.id===r.to))
  function acceptable(tiles: Tile[]) {
    const report=validate(tiles,profiles)
    if(!report.valid)return false
    const ids=new Set(tiles.map(t=>t.id))
    return required.every(r=>{
      if(!ids.has(r.from)||!ids.has(r.to)||r.intent==='uncertain')return true
      const connected=report.connections.some(c=>[c.a.tileId,c.b.tileId].includes(r.from)&&[c.a.tileId,c.b.tileId].includes(r.to))
      return r.intent==='connect'?connected:!connected
    })
  }
  const solutions: {tiles:Tile[];score:number}[]=[],seen=new Set<string>();let explored=0,truncated=false
  function visit(placed: Tile[]) {
    if(explored>=MAX_STATES){truncated=true;return} explored++
    // Pose rounding is only for duplicate search states, never for returned geometry.
    const key=[...placed].sort((a,b)=>a.id.localeCompare(b.id)).map(t=>t.id+':'+vertices(t,profiles).map(([x,y])=>[x.toFixed(7),y.toFixed(7)].join(',')).sort().join(';')).join('|')
    if(seen.has(key))return;seen.add(key)
    if(placed.length===approx.length){solutions.push({tiles:placed,score:Math.sqrt(placed.reduce((s,t)=>s+error(t)**2,0)/placed.length)});return}
    const options: {tile:Tile;score:number}[]=[]
    for(const raw of approx.filter(t=>!placed.some(p=>p.id===t.id))) for(const target of placed) for(const own of edges(raw,profiles)) for(const edge of edges(target,profiles)) {
      if(Math.abs(own.length-edge.length)>EPS)continue
      const candidate=alignEdge(raw,own,edge,profiles),score=error(candidate)
      if(score>MAX_ERROR||!acceptable([...placed,candidate]))continue
      options.push({tile:candidate,score})
    }
    options.sort((a,b)=>a.score-b.score||a.tile.id.localeCompare(b.tile.id))
    for(const option of options){if(explored>=MAX_STATES){truncated=true;break}visit([...placed,option.tile])}
  }
  visit([root])
  solutions.sort((a,b)=>a.score-b.score)
  const candidates:Candidate[]=solutions.slice(0,3).map((s,index)=>{
    const xs=s.tiles.flatMap(t=>vertices(t,profiles).map(v=>v[0])),ys=s.tiles.flatMap(t=>vertices(t,profiles).map(v=>v[1]))
    const x=Math.min(...xs),y=Math.min(...ys)
    const tiles=s.tiles.map(t=>({...t,pose:{...t.pose,x:t.pose.x-x,y:t.pose.y-y}})).sort((a,b)=>a.id.localeCompare(b.id))
    // Translation to a compact origin is exact rigid motion; verify again.
    if(!validate(tiles,profiles).valid)throw Error('规范化结果未通过几何复核')
    return {id:'candidate-'+(index+1),assembly:{schemaVersion:1,id:assemblyId+'-'+index,revision:0,name:'图片磁力片作品',instances:tiles},imageError:s.score,fidelity:s.score<=.12?'close':'needs_review',connections:validate(tiles,profiles).connections.length}
  })
  diagnostics.push(candidates.length?'候选几何合法；轮廓偏差仅用于比较，不代表识别或实物连接已经正确。':'未找到同时满足轮廓与连接意图的合法连通布局；请检查形状、外轮廓、连接意图和统一尺寸。')
  if(truncated)diagnostics.push('达到有限搜索预算，结果不保证穷尽；未找到不等于不存在。')
  if(observations.some(o=>o.confidence<.7||o.uncertainty))diagnostics.push('含低置信度或不确定识别项，请对照原图。')
  return {candidates,diagnostics,explored,truncated}
}
