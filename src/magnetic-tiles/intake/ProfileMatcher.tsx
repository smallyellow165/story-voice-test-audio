import { useState } from 'react'
import { profiles, profileViewBox } from '../profiles.ts'
import type { RelativeScale } from './relative-size.ts'
import { matchRelativeProfiles } from './relative-size.ts'
import type { Observation } from './contracts.ts'
import { needsOutlineConfirmation } from './profile-match.ts'
export function ProfileMatcher({observation,width,height,scale,confirmed,onConfirm,onApply}:{observation:Observation;width:number;height:number;scale:RelativeScale;confirmed:boolean;onConfirm:(value:boolean)=>void;onApply:(id:string,version:number)=>void}){
 const [requested,setRequested]=useState(false),[all,setAll]=useState(false)
 const result=requested?matchRelativeProfiles(observation,width,height,profiles,scale):null,uncertain=needsOutlineConfirmation(observation),canScore=!uncertain||confirmed
 return <section className="profile-matcher" aria-label="Find Matching Profile">
  <button onClick={()=>setRequested(true)}>Find Matching Profile</button>
  {requested&&<><p>Shape Score 与 Relative Size Score 独立计算，均不是 AI Confidence 或匹配概率；尺寸依赖已知规格参考及同平面近似。</p>
   {uncertain&&<><p role="status">{confirmed?'已人工确认可进行形状比较；原始不确定证据仍保留，尺寸参考与遮挡仍需核实。':'证据存在不确定性，暂不能可靠评分。请检查遮挡、估计角点及完整外轮廓；不能确认时保持 Unknown。'}</p><label className="intake-check"><input type="checkbox" checked={confirmed} onChange={e=>onConfirm(e.target.checked)}/>我已核实完整轮廓可用于形状比较（不是被遮挡后的猜测）</label></>}
   {result?.status==='invalid'?<p role="alert">无法可靠评分：{result.reason}</p>:result&&<><p>{scale.reason}</p>{scale.references.length>0&&<details><summary>尺寸参考依据</summary>{scale.references.map(r=><p key={r.observationId}>{r.observationId} · {r.profileId}@{r.profileVersion} · {r.pixelsPerUnit.toFixed(2)} px / 单位 · Shape {r.shapeScore.toFixed(1)}%{r.uncertainty&&<small>原始不确定性：{r.uncertainty}</small>}</p>)}</details>}{(all?result.candidates:result.candidates.slice(0,3)).map(c=>{const p=profiles.find(p=>p.id===c.profileId&&p.version===c.profileVersion)!;return <div key={`${p.id}@${p.version}`} className="profile-match-candidate" data-match-profile={p.id}>
    <svg viewBox={profileViewBox(p)} aria-hidden="true"><g transform="scale(1 -1)"><polygon points={p.vertices.map(v=>v.join(',')).join(' ')} fill="#f5b942" stroke="#243e3a" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/></g></svg>
    <b>#{c.rank} {p.name}</b><p data-testid="shape-score">Shape Score：{canScore?`${c.similarityScore.toFixed(1)}%`:'证据待核实，暂不评分'}</p><p data-testid="size-score">Relative Size Score：{c.relativeSizeScore===null?'Size Unknown':!canScore?'证据待核实，暂不评分':`${c.relativeSizeScore.toFixed(1)}%`}</p><small>{p.id} · v{p.version}{p.sizeEvidence?' · Estimated':''}</small><p>{canScore?c.sizeExplanation:'核实完整轮廓后显示尺寸依据。'}</p><p>{canScore?c.explanation:'仅按假设角点排序，尚不是可靠推荐。'}</p>
    {c.outlineRms!==null&&<p>轮廓 RMS / 半径：{(c.outlineRms*100).toFixed(2)}%<br/>边长比例 RMS：{(c.edgeRatioRms!*100).toFixed(2)}%<br/>内角 RMS：{c.angleRmsDegrees!.toFixed(2)}°{c.mirrored?' · 镜像对应':''}</p>}
    <button disabled={c.vertexDifference!==0||!canScore} onClick={()=>onApply(p.id,p.version)}>确认应用 {p.name}</button>
   </div>})}{result.candidates.length>3&&<button onClick={()=>setAll(!all)}>{all?'只看 Top 3':'查看全部候选'}</button>}</>}
   <details><summary>评分如何计算</summary><p>按真实图片宽高还原坐标，质心平移、RMS 半径统一缩放，枚举起点、绕序、镜像并旋转对齐。取轮廓 RMS÷0.10、边长比例 RMS÷0.10、内角 RMS÷10° 的最大值 E；分数 = 100 × 2^(−E²)。任一指标达到参照值即不高于50分。80分以上标为高度相似；顶点数不同记0分，不自动补删角。Relative Size Score 以图片轮廓 RMS 半径 /（参考尺度 × Profile 半径）作为尺寸比 R，Esize = ln(R) / ln(1.25)，尺寸分数 = 100 × 2^(−Esize²)。参考离散较大时半分误差最多放宽至 ×1.40。推荐按 Shape × Size / 100 排序；Size Unknown 时仅按 Shape 排序。同形异尺寸始终保留为独立候选；低分不阻止人工应用。这些是视觉解释阈值，不是 Geometry Validator 容差。</p></details>
  </>}
 </section>
}
