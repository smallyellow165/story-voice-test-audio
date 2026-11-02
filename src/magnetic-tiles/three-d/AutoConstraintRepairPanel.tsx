import {useEffect,useRef,useState} from 'react'
import {InfoHint} from '../../brick-vision/InfoHint.tsx'
import {serializeAssembly3D} from './assembly.ts'
import type {Assembly3D} from './assembly.ts'
import type {AssemblyAngleHintLoad} from './useAssemblyAngleHints.ts'
import type {RepairCandidate,RepairResult} from './constraint-repair.ts'
import {repairLimits} from './constraint-repair.ts'
export type RepairPreview={sourceRaw:string;candidate:RepairCandidate}
const number=(n:number)=>Number(n.toPrecision(6)).toString()
export function AutoConstraintRepairPanel({assembly,hints,editing,disabled,targets,highlighted,collisionCount,nonRepairable,excludedCount,onBusy,onPreview,onApply}:{
 assembly:Assembly3D;hints:AssemblyAngleHintLoad;editing:boolean;disabled:boolean;targets:string[];highlighted?:string;collisionCount:number;nonRepairable:readonly string[];excludedCount:number
 onBusy:(v:boolean)=>void;onPreview:(v:RepairPreview|null)=>void;onApply:(result:RepairResult,candidate:RepairCandidate)=>void|Promise<void>
}){
 const [scope,setScope]=useState<'all'|'selected'|'highlighted'>('all'),[reference,setReference]=useState(''),[running,setRunning]=useState(false),[result,setResult]=useState<RepairResult|null>(null),[chosen,setChosen]=useState(''),[notice,setNotice]=useState(''),[progress,setProgress]=useState({checks:0,nodes:0})
 const worker=useRef<Worker|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),sequence=useRef(0),snapshot=serializeAssembly3D(assembly),policyKey=JSON.stringify(nonRepairable),eligibleCount=collisionCount-excludedCount
 function stop(){sequence.current++;worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;setRunning(false);onBusy(false)}
 useEffect(()=>{stop();setResult(null);setChosen('');setNotice('');onPreview(null);return()=>{stop();onPreview(null)}},[snapshot,hints.key,policyKey])
 useEffect(()=>{if(targets.length)setScope('selected')},[targets.join('|')])
 const candidate=result?.candidates.find(c=>c.id===chosen),selectedReference=assembly.pieces.some(p=>p.id===reference)?reference:[...assembly.pieces.map(p=>p.id)].sort()[0]??''
 const targetKeys=scope==='all'?undefined:(scope==='selected'?targets:highlighted?[highlighted]:[]).filter(key=>!nonRepairable.includes(key))
 const blocker=!editing?'请先进入 Edit Draft。':!hints.source?(hints.error??'等待当前来源角度建议。'):hints.source.executedVariant===null?'执行来源方案未记录，不能确定允许修改的范围。':!collisionCount?'当前无实体碰撞。':!eligibleCount?'当前碰撞均已标记为不可修复，不参与自动优化。':targetKeys&&!targetKeys.length?'请选择至少一个当前碰撞。':''
 function preview(c:RepairCandidate){onPreview({sourceRaw:snapshot,candidate:c});setChosen(c.id)}
 function search(){
  if(blocker||disabled||!hints.source)return
  stop();onPreview(null);setResult(null);setNotice('');setRunning(true);onBusy(true);setProgress({checks:0,nodes:0});const request=++sequence.current
  try{
   const w=new Worker(new URL('./constraint-repair.worker.ts',import.meta.url),{type:'module'});worker.current=w
   const fail=(message:string)=>{if(sequence.current!==request)return;stop();setNotice(message)}
   timer.current=setTimeout(()=>fail('搜索超过 5 秒墙钟上限，已终止；当前 Draft 保持不变。'),5000)
   w.onerror=e=>{e.preventDefault();fail(`自动修复失败：${e.message}`)}
   w.onmessage=(e:MessageEvent<{progress?:{checks:number;nodes:number};result?:RepairResult;error?:string}>)=>{
    if(sequence.current!==request)return
    if(e.data.progress){setProgress(e.data.progress);return}
    if(e.data.error){fail(e.data.error);return}
    if(e.data.result){const value=e.data.result;stop();setResult(value);setNotice(value.reason);if(value.candidates[0])preview(value.candidates[0])}
   }
   w.postMessage({assembly,source:hints.source,targets:targetKeys,options:{...repairLimits,referencePieceId:selectedReference,nonRepairableKeys:[...nonRepairable]}})
  }catch(e){stop();setNotice(String(e))}
 }
 return <section className="magnetic-constraint-repair" aria-label="Auto Constraint Repair">
  <div className="magnetic-constraint-repair-controls"><b>Auto Constraint Repair</b><InfoHint label="自动约束修复">Collision Review 的「修复」勾选只选择搜索目标，与「接受」人工审核独立。「不可修复」由用户明确标记，排除优化目标和所有评分收益，但仍完整验证且不得加重。角度只使用已执行方案的可调范围。缺失连接仅从经来源、Hash、Canonical Profile 校验的当前采用 Plan / 人工约束提取明确 Port 配对；不混用其他 Plan 的观测边对应，不改写已有连接。保留固定参考子结构；预览不修改 Draft，点击应用才提交。</InfoHint><button disabled={!!blocker||disabled||running} onClick={search}>Find Fix</button></div>
  <div className="magnetic-constraint-repair-controls"><label>目标<select aria-label="自动修复目标" value={scope} disabled={disabled||running} onChange={e=>setScope(e.target.value as typeof scope)}><option value="all">可修复碰撞 · {eligibleCount} / {collisionCount}</option><option value="selected">勾选的修复目标 · {targets.length}</option><option value="highlighted" disabled={!highlighted||nonRepairable.includes(highlighted)}>当前高亮碰撞</option></select></label><label>固定参考<select aria-label="自动修复固定参考" value={selectedReference} disabled={disabled||running} onChange={e=>setReference(e.target.value)}>{assembly.pieces.map(p=><option key={p.id} value={p.id}>{p.id}</option>)}</select></label></div>
  {!!excludedCount&&<p className="hint">Non-repairable · {excludedCount}：不作为目标、不计评分；仍检查是否加重，Geometry Invalid 不变。</p>}
  {blocker&&!result&&<p className={hints.error?'magnetic-3d-blocker':'hint'} role={hints.error?'alert':'status'}>{blocker}</p>}
  {running&&<div role="status">搜索中 · {progress.checks}/{repairLimits.maxChecks} 检查 · {progress.nodes}/{repairLimits.maxNodes} 节点 <button onClick={()=>{stop();setNotice('搜索已取消，当前 Draft 未修改。')}}>取消搜索</button></div>}
  {notice&&<p role="status">{notice}</p>}
  {result&&<><p className="hint">{result.checks} 次检查 · {result.nodes} 节点 · {number(result.elapsedMs)} ms · {result.status==='budget-exhausted'?'预算终止，保留最好结果':result.status==='blocked'?'无法搜索':'离散网格结束，未证明连续域无解'}</p>{!!result.referencePieces.length&&<p className="hint">固定参考子结构：{(candidate?.referencePieces??result.referencePieces).join('、')}。共面、人工约束和待判断角度保持不变；仅使用当前采用 Plan 尝试新增连接。</p>}</>}
  {result?.connectionInputs&&<details className="magnetic-repair-evidence"><summary>连接证据与尝试 · {result.connectionAttempts?.length??0} 个配对</summary>
   {result.connectionInputs.proposals.map(p=>{const attempt=result.connectionAttempts?.find(x=>x.proposalId===p.id);return <div key={p.id}><b>{p.connection.pieceA}:{p.connection.portA} ↔ {p.connection.pieceB}:{p.connection.portB}</b><div>{attempt?.checks??0} 次检查 · {attempt?.accepted??0} 个可用方案 · {attempt?.checks?JSON.stringify(attempt.errors):'未搜索：目标、不可修复标记或预算限制'}</div>{attempt?.bestResiduals&&<div>最接近试验的全图残差：位置 {number(attempt.bestResiduals.maxPositionError)} · 二面角 {number(attempt.bestResiduals.maxDihedralError)}° · 方向点积 {number(attempt.bestResiduals.minDirectionDot)}</div>}{attempt?.bestIssues?.map((issue,i)=><div key={i}>{issue.message}</div>)}{p.evidence.map((e,i)=><p key={i}>{e.authority==='human'?'人工约束':e.authority==='current-plan'?'当前 Plan 推断':'Execution 未实现假设'} · {e.recordId.slice(0,8)} / {e.variant} · {e.evidence} {e.uncertainty}</p>)}</div>})}
   {!!result.connectionInputs.analysisRelations?.length&&<details><summary>Analysis 关系证据（不提供确定 Port）</summary>{result.connectionInputs.analysisRelations.map((r,i)=><p key={i}>{r.pieceA} / {r.pieceB} · {r.relationship} · {r.reasoning} {r.uncertainty}</p>)}</details>}
   {!result.connectionInputs.proposals.length&&<p>没有可执行的缺失 Port 配对；不根据碰撞、距离或遮挡补造连接。</p>}
   {!!result.connectionInputs.skipped.length&&<div>未使用：{result.connectionInputs.skipped.map((x,i)=><p key={i}>{x.pair} · {x.reason}</p>)}</div>}
  </details>}
  {result&&!!result.candidates.length&&<><select aria-label="自动修复候选" value={chosen} onChange={e=>preview(result.candidates.find(c=>c.id===e.target.value)!)}>{result.candidates.map(c=><option key={c.id} value={c.id}>{c.id} · {c.proposedConnection?'建议新增 Connection':'仅改善碰撞'} · {c.geometry.valid?'Geometry Valid':'部分改善 · Geometry Invalid'} · 碰撞 {result.baseline.length} → {c.collisions.length}</option>)}</select>
   {candidate&&<><p className="hint">{candidate.proposedConnection?`建议新增 Connection：${candidate.proposedConnection.connection.pieceA}:${candidate.proposedConnection.connection.portA} ↔ ${candidate.proposedConnection.connection.pieceB}:${candidate.proposedConnection.connection.portB} · ${number(candidate.proposedConnection.connection.dihedralDeg)}° · Flip ${String(candidate.proposedConnection.connection.flip)}；应用即明确采用该连接假设。`:'仅改善碰撞；没有建立缺失 Connection。'} 候选仅供预览；点击应用修复才修改 Draft。</p><p data-testid="repair-candidate-status" className={candidate.geometry.valid?undefined:'magnetic-3d-blocker'}>{candidate.geometry.valid?'Geometry Valid':'Geometry Invalid · 仅部分改善'} · 全部连接验证通过；Photo Match / Physical Stability 未验证。</p>
    <table><thead><tr><th>碰撞零件对</th><th>Depth 前 → 后</th><th>优化</th></tr></thead><tbody>{result.baseline.map(c=><tr key={c.key}><td>{c.pieceIds.join(' / ')}</td><td>{number(c.depth)} → {candidate.collisions.find(x=>x.key===c.key)?number(candidate.collisions.find(x=>x.key===c.key)!.depth):'未报碰撞'}</td><td>{result.nonRepairableKeys.includes(c.key)?'不可修复 · 不计分':result.targetKeys.includes(c.key)?'修复目标':'仍检查'}</td></tr>)}</tbody></table>
    <p>角度调整：{candidate.angles.length?candidate.angles.map(a=>`#${a.index} ${number(a.from)}° → ${number(a.to)}°`).join('；'):'无'}</p>
    <details><summary>搜索与连接诊断</summary><div>相对当前角度偏离总和 {number(candidate.deviation)}° · 相对 Plan 建议 {number(candidate.planDeviation)}°</div><div>最大位置残差 {number(candidate.residuals.maxPositionError)} · 最大二面角残差 {number(candidate.residuals.maxDihedralError)}°</div><div>不计分碰撞：{result.nonRepairableKeys.join('；')||'无'}（包含总碰撞数、Depth、交叠体积及完全有效优先项）</div><div>拒绝统计：{JSON.stringify(result.rejected)}</div><div>协调控制组：{result.groups.map(g=>g.indices.map(i=>`#${i}`).join(' + ')).join('；')}</div><div>交叠体积前后：{result.baseline.map(c=>`${c.pieceIds.join('/')} ${c.volume??'未知'} → ${(candidate.collisions.find(x=>x.key===c.key)?candidate.collisions.find(x=>x.key===c.key)!.volume??'未知':'未报碰撞')}`).join('；')}</div></details>
    <div className="magnetic-constraint-repair-controls"><button disabled={!editing||running} onClick={async()=>{try{await onApply(result,candidate);onPreview(null);setResult(null);setNotice('修复已应用为一次编辑；仍使用严格 Validator，变化的错误不会自动获批。')}catch(e){setNotice(String(e))}}}>应用修复</button><button onClick={()=>preview(candidate)}>预览候选</button><button onClick={()=>onPreview(null)}>取消预览</button></div>
   </>}
  </>}
 </section>
}
