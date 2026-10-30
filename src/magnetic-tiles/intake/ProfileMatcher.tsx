import { useProfileRegistry } from '../ProfileRegistry.tsx'
import { useState } from 'react'
import { InfoHint } from '../../brick-vision/InfoHint.tsx'
import { profileViewBox } from '../profiles.ts'
import type { RelativeScale } from './relative-size.ts'
import { matchRelativeProfiles } from './relative-size.ts'
import type { Observation } from './contracts.ts'
import { needsOutlineConfirmation } from './profile-match.ts'

export function ProfileMatcher({observation,width,height,scale,onApply}:{observation:Observation;width:number;height:number;scale:RelativeScale;onApply:(id:string,version:number)=>void}){
 const {registry:{profiles}}=useProfileRegistry()
 const [requested,setRequested]=useState(false),[all,setAll]=useState(false)
 const result=requested?matchRelativeProfiles(observation,width,height,profiles,scale):null
 return <section className="profile-matcher" aria-label="Find Matching Profile">
  <div className="profile-match-action"><button className="primary" onClick={()=>setRequested(true)}>Find Matching Profile</button><InfoHint label="Profile 匹配">
   <p>Shape Score 比较形状，Relative Size Score 比较同图相对尺寸；均不是 AI Confidence 或匹配概率。遮挡、估计角点与不完整轮廓可能影响分数，低分候选仍可人工应用。</p>
   <p>形状：按真实图片宽高还原坐标，质心平移、RMS 半径归一化，枚举起点、绕序、镜像并旋转对齐。E = max(轮廓 RMS÷0.10，边长比例 RMS÷0.10，内角 RMS÷10°)；Shape = 100 × 2^(−E²)。顶点数不同记 0，不自动补删角。</p>
   <p>尺寸：R = 观察轮廓半径 /（参考尺度 × Profile 半径）；Size = 100 × 2^(−(ln(R)/T)²)，通常 T = ln(1.25)，参考离散较大时最多放宽至 ln(1.40)。推荐按 Shape × Size / 100 排序；Size Unknown 时只按 Shape 排序。规则与 Geometry Validator 容差无关。</p>
  </InfoHint></div>
  {requested&&<>
   {needsOutlineConfirmation(observation)&&<p role="status" className="review-match-warning">Warning：轮廓存在不确定性或低置信度，分数仅供参考。<InfoHint label="轮廓风险"><p>{observation.uncertainty||'Observation 置信度低于 70%。'}</p><p>请对照原图检查遮挡、估计角点和完整边界；这些风险不会阻止评分或人工选择。</p></InfoHint></p>}
   {result?.status==='invalid'?<p role="alert">无法评分：{result.reason}</p>:result&&<>
    <details className="profile-scale-details"><summary>尺寸参考 · {scale.status==='known'?`${scale.references.length} 块 / ${scale.pixelsPerUnit!.toFixed(2)} px / 单位`:'Size Unknown'}</summary><p>{scale.reason}</p>{scale.references.map(r=><p key={r.observationId}>{r.observationId} · {r.profileId}@{r.profileVersion} · {r.pixelsPerUnit.toFixed(2)} px / 单位 · Shape {r.shapeScore.toFixed(1)}%{r.uncertainty&&<small>原始不确定性：{r.uncertainty}</small>}</p>)}</details>
    {(all?result.candidates:result.candidates.slice(0,3)).map(c=>{const p=profiles.find(p=>p.id===c.profileId&&p.version===c.profileVersion)!;return <div key={`${p.id}@${p.version}`} className="profile-match-candidate" data-match-profile={p.id}>
     <div className="profile-match-heading"><svg viewBox={profileViewBox(p)} aria-hidden="true"><g transform="scale(1 -1)"><polygon points={p.vertices.map(v=>v.join(',')).join(' ')} fill="#f5b942" stroke="#243e3a" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/></g></svg><b>#{c.rank} {p.name}</b></div>
     <small>{p.id} · v{p.version}{p.sizeEvidence?' · Estimated':''}</small>
     <div className="profile-match-scores"><p data-testid="shape-score">Shape Score：{c.similarityScore.toFixed(1)}%</p><p data-testid="size-score">Relative Size Score：{c.relativeSizeScore===null?'Size Unknown':`${c.relativeSizeScore.toFixed(1)}%`}</p></div>
     <details><summary>尺寸与形状依据</summary><p>{c.sizeExplanation}</p><p>{c.explanation}</p>{c.outlineRms!==null&&<p>轮廓 RMS / 半径：{(c.outlineRms*100).toFixed(2)}%<br/>边长比例 RMS：{(c.edgeRatioRms!*100).toFixed(2)}%<br/>内角 RMS：{c.angleRmsDegrees!.toFixed(2)}°{c.mirrored?' · 镜像对应':''}</p>}</details>
     <button disabled={c.vertexDifference!==0} onClick={()=>onApply(p.id,p.version)}>确认应用 {p.name}</button>
    </div>})}
    {result.candidates.length>3&&<button onClick={()=>setAll(!all)}>{all?'只看 Top 3':'查看全部候选'}</button>}
   </>}
  </>}
 </section>
}
