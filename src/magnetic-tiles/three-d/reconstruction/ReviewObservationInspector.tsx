import {useState,useRef,useLayoutEffect} from 'react'
import type {Profile} from '../../geometry.ts'
import {profileSizeLabel} from '../../profiles.ts'
import type {ReviewedPiece3D,VisibleObservation3D} from './contracts.ts'
import {familyLabels} from './SpatialUnderstandingPanel.tsx'

type Props={
 piece:ReviewedPiece3D; evidence?:VisibleObservation3D; profiles:Profile[]; busy:boolean
 images:{id:string;name:string;selected:boolean;available:boolean}[];currentImageId:string
 onImage:(id:string)=>void;onEdit:(patch:Partial<ReviewedPiece3D>)=>void
}
/** Presentation only: the parent's Review Draft and existing edit path stay authoritative. */
export function ReviewObservationInspector({piece,evidence,profiles,busy,images,currentImageId,onImage,onEdit}:Props){
 const [suggestion,setSuggestion]=useState(0),core=useRef<HTMLElement>(null)
 useLayoutEffect(()=>{if(core.current?.getClientRects().length)core.current.closest('.studio-inspector')?.scrollTo({top:0})},[piece.id])
 const candidates=evidence?.profileCandidates??[]
 const available=candidates.filter(c=>profiles.some(p=>p.id===c.profileId&&p.version===c.profileVersion))
 const candidate=available[suggestion]??available[0]
 const adopted=!!candidate&&piece.profileId===candidate.profileId&&piece.profileVersion===candidate.profileVersion&&piece.confirmed&&!piece.excluded
 const reviewed=profiles.find(p=>p.id===piece.profileId&&p.version===piece.profileVersion)
 const assessment=evidence?.shapeAssessment
 const aiLabel=`AI 建议：${assessment?familyLabels[assessment.family]:'Unknown'} · ${candidate?`${candidate.profileId}@${candidate.profileVersion}`:'无确定 Profile 建议'}`
 return <section ref={core} className="review-observation-inspector" aria-label="当前 Observation 审核">
  <div className="review-observation-core">
   <div className="review-observation-suggestion visible3d-shape" aria-label="AI 形状与 Profile 建议">
    <strong>{piece.id}</strong><span className="review-observation-ai" title={aiLabel}>{aiLabel}</span>
    {candidate&&<button disabled={busy||piece.excluded||adopted} aria-label={`采用 AI 建议 ${candidate.profileId}@${candidate.profileVersion}`} onClick={()=>onEdit({profileId:candidate.profileId,profileVersion:candidate.profileVersion,confirmed:true})}>{adopted?'已采用':'采用 AI 建议'}</button>}
   </div>
   {available.length>1&&<label className="review-inline-field">其他建议<select aria-label="AI Profile 建议" value={Math.min(suggestion,available.length-1)} onChange={e=>setSuggestion(Number(e.target.value))}>{available.map((c,i)=><option key={`${c.profileId}@${c.profileVersion}`} value={i}>{c.profileId}@{c.profileVersion}</option>)}</select></label>}
   <label className="review-inline-field">人工修改<select aria-label="3D Review Profile" disabled={busy||piece.excluded} value={piece.profileId?`${piece.profileId}@${piece.profileVersion}`:''} onChange={e=>{const p=profiles.find(p=>`${p.id}@${p.version}`===e.target.value);onEdit({profileId:p?.id??null,profileVersion:p?.version??null,confirmed:!!p})}}><option value="">Unknown</option>{profiles.map(p=><option key={`${p.id}@${p.version}`} value={`${p.id}@${p.version}`}>{p.id}@{p.version} · {p.name}</option>)}</select></label>
   <div className="review-observation-toggles">
    <label><input type="checkbox" checked={piece.confirmed} disabled={busy||piece.excluded} onChange={e=>onEdit({confirmed:e.target.checked})}/>确认可见实例</label>
    <label><input type="checkbox" aria-label="排除实例（保留证据）" checked={piece.excluded} disabled={busy} onChange={e=>onEdit({excluded:e.target.checked})}/>排除实例</label>
   </div>
   {!piece.excluded&&!piece.confirmed&&<p className="review-observation-blocker">等待人工确认 · 本片暂不参与重建</p>}
   <div className="review-observation-meta">
    <label className="review-color-field" title="审核颜色"><input aria-label="3D Review 颜色" type="color" value={piece.color} disabled={busy} onChange={e=>onEdit({color:e.target.value})}/><span>{piece.color.toUpperCase()}</span></label>
    {reviewed&&<span className="review-observation-size" title={profileSizeLabel(reviewed)}>{profileSizeLabel(reviewed)}</span>}
   </div>
   {!!images.length&&<div className="review-observation-images" role="group" aria-label="零件相关来源图片"><span>来源</span>{images.map(img=><button key={img.id} title={img.available?img.name:`${img.name} · 请先在顶部图片筛选中选择此图`} aria-pressed={img.selected} disabled={!img.available} onClick={()=>onImage(img.id)}>{img.name}</button>)}</div>}
  </div>
  <details className="review-observation-evidence"><summary>当前零件 · 识别证据与不确定性</summary>
   <dl><dt>Observation 描述</dt><dd>{evidence?.evidence||'未记录'}</dd><dt>遮挡</dt><dd>{evidence?.occlusion||'未记录'}</dd><dt>不确定性</dt><dd>{evidence?.uncertainty||'未记录'}</dd>
    <dt>AI 形状依据</dt><dd>{assessment?.evidence||'V1 未记录独立 Shape Family'}</dd><dt>其他形状可能</dt><dd>{assessment?.alternativeFamilies.map(f=>familyLabels[f]).join('、')||'无'}</dd>
    <dt>透视 / 遮挡分析</dt><dd>{assessment?.perspectiveUncertainty||'未记录'}</dd><dt>准确规格不确定性</dt><dd>{assessment?.exactProfileUncertainty||'未记录'}</dd>
   </dl>
   <ul>{candidates.map((c,i)=><li key={i}><b>{c.profileId}@{c.profileVersion}</b> · {c.reason}{!available.includes(c)&&' · Catalog 当前不可用'}</li>)}</ul>
   {evidence?.imageEvidence?.map(e=><div key={e.imageId}><b>{images.find(i=>i.id===e.imageId)?.name??e.imageId}{e.imageId===currentImageId?' · 当前图片':''}</b><p>{e.evidence}</p><p>{e.occlusion} · {e.uncertainty}</p></div>)}
  </details>
  <details><summary>模型 Profile 候选 / 可见边角 · Raw</summary><pre>{JSON.stringify(evidence,null,2)}</pre></details>
 </section>
}
