import type {RefinementReference} from './constraint-refinement.ts'
// Read-only presentation of existing request/record states. No planning or geometry.
type Ref={id:string;hash:string}
export type ModelTrace={id:string;status?:string;error?:unknown;validation?:{valid:boolean;issues?:unknown[]}|null;background?:{state:string;responseId:string|null;providerStatus?:string|null};sources?:{sourceId:string;sourceHash:string;reviewId?:string|null;reviewHash?:string|null}[];[key:string]:unknown}
export type OperationRecord={id:string;kind:string;state:string;createdAt:string;sourceId?:string;sourceHash?:string;planId?:string|null;refinement?:RefinementReference|null;error?:string;usable?:boolean;trace?:ModelTrace;record?:{id:string;[key:string]:unknown}}
export type OperationAttempt={id?:string;kind:'plan'|'execute';scope:string;error?:string}
export const planningScope=(source:Ref|null,review:Ref|null)=>JSON.stringify([source?.id,source?.hash,review?.id,review?.hash])
export const executionScope=(plan:Ref|null)=>JSON.stringify([plan?.id,plan?.hash])
const latest=(requests:OperationRecord[])=>[...requests].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id))[0]
/** Analysis has a saved request even when no Recognition record was produced.
 * latest follows the current source; record pins an explicitly selected history.
 * A request ID is a view preference only and still needs exact saved provenance. */
export function analysisRequest(requests:OperationRecord[],source:Ref|null,analysis:{id:string;sourceId:string;sourceHash:string;traceId?:string|null}|null,selection='latest'){
 if(!source)return undefined
 const related=requests.filter(r=>r.kind==='analyze'&&(r.trace?.sources?.some(s=>s.sourceId===source.id&&s.sourceHash===source.hash)||!r.trace&&r.sourceId===source.id&&r.sourceHash===source.hash))
 if(selection==='record')return analysis?.sourceId===source.id&&analysis.sourceHash===source.hash?related.find(r=>r.record?.id===analysis.id||!!analysis.traceId&&r.trace?.id===analysis.traceId):undefined
 if(selection!=='latest')return related.find(r=>r.id===selection)
 return latest(related)
}
export function planningRequest(requests:OperationRecord[],source:Ref|null,review:Ref|null,plan:Ref|null,attempt:OperationAttempt|null){
 if(attempt?.kind==='plan'&&attempt.scope===planningScope(source,review)&&attempt.id)return requests.find(r=>r.id===attempt.id&&r.kind==='plan')
 if(plan)return requests.find(r=>r.kind==='plan'&&r.record?.id===plan.id)
 // Old failed requests sometimes lack Source/Review IDs. Without exact saved
 // trace provenance they cannot safely be attributed to the selected Review.
 return latest(requests.filter(r=>r.kind==='plan'&&!r.record&&r.trace?.sources?.some(s=>s.sourceId===source?.id&&s.sourceHash===source?.hash&&s.reviewId===review?.id&&s.reviewHash===review?.hash)))
}
export function executionRequest(requests:OperationRecord[],plan:Ref|null,execution:Ref|null,attempt:OperationAttempt|null,refinement:RefinementReference|null=null){
 if(attempt?.kind==='execute'&&(attempt.scope===JSON.stringify([executionScope(plan),refinement])||!refinement&&attempt.scope===executionScope(plan))&&attempt.id)return requests.find(r=>r.id===attempt.id&&r.kind==='execute')
 if(execution)return requests.find(r=>r.kind==='execute'&&r.record?.id===execution.id)
 return plan?latest(requests.filter(r=>r.kind==='execute'&&!r.record&&r.planId===plan.id&&JSON.stringify(r.refinement??null)===JSON.stringify(refinement))):undefined
}
export type DisplayStatus={tone:'neutral'|'running'|'error'|'review'|'valid';label:string;message:string}
export function analysisDisplay(request:OperationRecord|undefined):DisplayStatus{
 if(!request)return {tone:'neutral',label:'尚未执行 Analysis',message:'选择图片不会调用模型。'}
 const t=request.trace,b=t?.background,detail=typeof t?.error==='object'&&t.error&&'message' in t.error?String(t.error.message):request.error
 if(b?.state==='running'||b?.state==='submitting'||request.state==='running'&&!b)return {tone:'running',label:b?.responseId?'Running · 后台识别中':'Submitting · 正在提交',message:b?.responseId?`Response ${b.responseId} · 只查询同一任务，不会重新生成。`:'正在等待供应商确认；不会自动重发。'}
 if(b?.state==='timeout'||t?.transportError==='TimeoutError')return {tone:'error',label:'Timeout · 请求或查询超时',message:b?.responseId?`可查询同一个 Response ${b.responseId}；超时不代表供应商停止执行。`:'未保存 Provider Response ID，无法安全恢复。供应商执行及计费状态未知，不会自动重发。'}
 if(b?.state==='unknown')return {tone:'error',label:'Unknown · 执行状态未知',message:`${detail??'网络或响应异常。'} ${b.responseId?'可查询同一个 Response。':'没有 Response ID，无法安全恢复。'} 可能已产生费用；不会自动重发。`}
 const failure=requestFailure(request)
 if(failure)return {tone:'error',label:t?.validation?.valid===false?'输出契约校验失败':'Analysis Failed',message:detail??failure}
 return {tone:'review',label:'Completed · 待人工 Review',message:'已保存模型输出；不代表照片匹配或几何验证通过。'}
}
export function requestFailure(request:OperationRecord|undefined):string|null{
 if(!request)return null
 const t=request.trace,issues=t?.validation?.issues??[]
 if(request.state==='failed'||request.usable===false||t?.validation?.valid===false||t&&t.status!=='plan_ready_for_review')return [request.error,t?.error,...issues].filter(Boolean).map(i=>typeof i==='string'?i:JSON.stringify(i)).join('；')||`请求未产生可用结果（${t?.status??request.state}）；请查看 Trace / Raw。`
 return null
}
export function planningDisplay(plan:Ref|null,request:OperationRecord|undefined,running:boolean,error?:string):DisplayStatus{
 if(running||request?.state==='running')return {tone:'running',label:'Running / Generating',message:'正在执行 Spatial Planning；不会自动重试。'}
 const failure=requestFailure(request)||error
 if(failure)return {tone:'error',label:'Spatial Planning Failed',message:failure}
 return plan?{tone:'review',label:'Plan Ready / Review Required',message:'空间假设已生成，需人工审核与 Geometry Execution；照片语义正确性尚未验证。'}:{tone:'neutral',label:'尚未执行 / 尚未生成',message:'请先保存或选择当前 Review，再执行 Spatial Planning。'}
}
export function executionDisplay(plan:Ref|null,execution:{status:string;candidates:{geometry:{valid:boolean};coverage?:{reconstructed:string[];totalConfirmed:number}}[];diagnosticCandidates?:unknown[];diagnostics:string[]}|null,request:OperationRecord|undefined,running:boolean,error?:string):DisplayStatus{
 if(running||request?.state==='running')return {tone:'running',label:'Running / Generating',message:'正在执行 Geometry Execution；使用当前 Plan 的几何约束。'}
 const failure=requestFailure(request)||error
 if(failure)return {tone:'error',label:'Geometry Execution Failed',message:failure}
 if(!execution)return {tone:'neutral',label:plan?'尚未运行 Geometry Execution':'等待 Plan',message:plan?'当前 Plan 已就绪，请明确执行 Geometry Execution。':'请先执行 Spatial Planning 或选择已保存的 Plan。'}
 const count=execution.candidates.filter(c=>c.geometry.valid).length
 if(execution.status!=='candidates_found'||!count)return {tone:'error',label:execution.status==='budget_exhausted'?'搜索预算已耗尽':'无合法 Candidate',message:execution.status==='budget_exhausted'?'搜索尚未完成；本次结果不能作为完成搜索的正式候选采用。':`未找到实体碰撞合法的候选；${execution.diagnosticCandidates?.length??0} 个 Diagnostic 可供检查，不能采用。`}
 const coverage=execution.candidates.filter(c=>c.geometry.valid&&c.coverage).map(c=>c.coverage!).sort((a,b)=>b.reconstructed.length-a.reconstructed.length)[0];
 if(coverage&&coverage.reconstructed.length<coverage.totalConfirmed)return {tone:'error',label:`重建不完整：${coverage.reconstructed.length}/${coverage.totalConfirmed}，未覆盖 ${coverage.totalConfirmed-coverage.reconstructed.length} 个已确认实例`,message:`${count} 个合法局部 Candidate；完整重建不可用。Diagnostic 仅供观察，Photo Match 未验证；局部采用不代表完成重建。`};
 return {tone:'valid',label:`${count} 个合法 Candidate · Geometry Valid`,message:'几何验证通过；Photo Match 未验证，仍需人工照片审核。'}
}
