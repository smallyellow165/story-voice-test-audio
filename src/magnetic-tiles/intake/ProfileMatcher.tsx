import { useState } from 'react'
import { profiles, profileViewBox } from '../profiles.ts'
import type { Observation } from './contracts.ts'
import { matchOutline, needsOutlineConfirmation } from './profile-match.ts'
export function ProfileMatcher({observation,width,height,confirmed,onConfirm,onApply}:{observation:Observation;width:number;height:number;confirmed:boolean;onConfirm:(value:boolean)=>void;onApply:(id:string,version:number)=>void}){
 const [requested,setRequested]=useState(false),[all,setAll]=useState(false)
 const result=requested?matchOutline(observation.outline,width,height,profiles):null,uncertain=needsOutlineConfirmation(observation),canScore=!uncertain||confirmed
 return <section className="profile-matcher" aria-label="Find Matching Profile">
  <button onClick={()=>setRequested(true)}>Find Matching Profile</button>
  {requested&&<><p>这是几何相似度，不是 AI Confidence 或匹配概率；不核实零件实际大小。</p>
   {uncertain&&<><p role="status">{confirmed?'已人工确认可进行形状比较；原始不确定证据仍保留，实际尺寸仍需核实。':'证据存在不确定性，暂不能可靠评分。请检查遮挡、估计角点及完整外轮廓；不能确认时保持 Unknown。'}</p><label className="intake-check"><input type="checkbox" checked={confirmed} onChange={e=>onConfirm(e.target.checked)}/>我已核实完整轮廓可用于形状比较（不是被遮挡后的猜测）</label></>}
   {result?.status==='invalid'?<p role="alert">无法可靠评分：{result.reason}</p>:result&&<><p>{result.reason}</p>{(all?result.candidates:result.candidates.slice(0,3)).map(c=>{const p=profiles.find(p=>p.id===c.profileId&&p.version===c.profileVersion)!;return <div key={`${p.id}@${p.version}`} className="profile-match-candidate" data-match-profile={p.id}>
    <svg viewBox={profileViewBox(p)} aria-hidden="true"><g transform="scale(1 -1)"><polygon points={p.vertices.map(v=>v.join(',')).join(' ')} fill="#f5b942" stroke="#243e3a" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/></g></svg>
    <b>#{c.rank} {p.name} · {canScore?`${c.similarityScore.toFixed(1)}%`:'证据待核实，暂不评分'}</b><small>{p.id} · v{p.version}</small><p>{canScore?c.explanation:'仅按假设角点排序，尚不是可靠推荐。'}</p>
    {c.outlineRms!==null&&<p>轮廓 RMS / 半径：{(c.outlineRms*100).toFixed(2)}%<br/>边长比例 RMS：{(c.edgeRatioRms!*100).toFixed(2)}%<br/>内角 RMS：{c.angleRmsDegrees!.toFixed(2)}°{c.mirrored?' · 镜像对应':''}</p>}
    <button disabled={c.vertexDifference!==0||!canScore} onClick={()=>onApply(p.id,p.version)}>确认应用 {p.name}</button>
   </div>})}{result.candidates.length>3&&<button onClick={()=>setAll(!all)}>{all?'只看 Top 3':'查看全部候选'}</button>}</>}
   <details><summary>评分如何计算</summary><p>按真实图片宽高还原坐标，质心平移、RMS 半径统一缩放，枚举起点、绕序、镜像并旋转对齐。取轮廓 RMS÷0.10、边长比例 RMS÷0.10、内角 RMS÷10° 的最大值 E；分数 = 100 × 2^(−E²)。任一指标达到参照值即不高于50分。80分以上标为高度相似；顶点数不同记0分，不自动补删角。这些是视觉解释阈值，不是 Geometry Validator 容差。</p></details>
  </>}
 </section>
}
