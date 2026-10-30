import { useId } from 'react'
import { InfoHint } from '../../brick-vision/InfoHint.tsx'
import type { SelectedSnapshot, SelectedStage } from './contracts.ts'
import { selectedFirst } from './selected-snapshots.ts'

type Entry={id:string;label:string}
export function SnapshotHistory({stage,currentId,entries,selection,disabled,onOpen,onToggle,mismatch,canSelect=true}:{stage:SelectedStage;currentId:string;entries:Entry[];selection:SelectedSnapshot;disabled:boolean;onOpen:(id:string)=>void;onToggle:()=>void;mismatch?:string;canSelect?:boolean}){
 const id=useId(),name=stage==='analysis'?'Analysis':'Review',isSelected=!!currentId&&currentId===selection.snapshotId&&selection.valid
 const invalid=!selection.valid,missing=!!selection.snapshotId&&!entries.some(e=>e.id===selection.snapshotId)
 const warning=selection.error||mismatch,clearInvalid=invalid&&selection.revision!==null
 return <div className="snapshot-history" data-snapshot-stage={stage}>
  <label htmlFor={id} title={warning||`历史 ${name}`}><span className="snapshot-label-long">历史 {name}</span><span className="snapshot-label-short">{stage==='analysis'?'分析':'审核'}</span>{warning&&<span className="snapshot-warning" aria-label={warning}> ⚠</span>}</label>
  <select id={id} aria-label={`历史 ${name}`} title={`Current ${name}：${currentId||'未保存 / 未打开'}；Selected：${selection.snapshotId||'无'}`} disabled={disabled} value={currentId} onChange={e=>{if(e.target.value)onOpen(e.target.value)}}>
   <option value="">{stage==='review'?'当前编辑 / 未保存':'选择分析'}</option>
   {missing&&<option value={selection.snapshotId!} disabled>★ Selected · ⚠ 缺失 {selection.snapshotId}</option>}
   {selectedFirst(entries,selection.snapshotId).map(e=><option key={e.id} value={e.id}>{e.id===selection.snapshotId?'★ Selected · ':''}{e.label}</option>)}
  </select>
  <button className="snapshot-star" aria-label={clearInvalid?`清除无效 Selected ${name}`:isSelected?`取消 Selected ${name}`:`设为 Selected ${name}`} aria-pressed={isSelected} disabled={disabled||selection.revision===null||(!clearInvalid&&(!currentId||!canSelect))} title={clearInvalid?'清除无效引用':isSelected?'取消 Selected（Current 不变）':`将 Current ${name} 设为 Selected`} onClick={onToggle}>{clearInvalid?'⊗':isSelected?'★':'☆'}</button>
  <InfoHint label={`Selected ${name}`}>
   <p>下拉框是 Current；★ Selected 是服务端保存的正式选定版本，每张 Source、每个阶段最多一个。☆ 选定当前快照，★ 取消；浏览或另存快照不会改变 Selected。Draft 须先保存后才能选定。</p>
   <p>Current：{currentId||'未保存 / 未打开'}<br/>Selected：{selection.snapshotId||'无'}</p>
   {stage==='review'&&selection.analysisId&&<p>Selected Review 来源 Analysis：{selection.analysisId}</p>}
   {warning&&<p className="snapshot-warning" role="status">{warning}</p>}
   {!canSelect&&<p>进行中的 Analysis 尚未成为最终快照，完成后才能选定。</p>}
  </InfoHint>
 </div>
}
