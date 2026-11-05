import type {OperationRecord} from './reconstruction-display.ts'

type Dated={createdAt?:string}
type AnalysisSummary=Dated&{analysisValidation?:{state?:string}}
type SourceSummary={images?:{name?:string;role?:string}[]}
type Coverage={reconstructed?:unknown[];totalConfirmed?:number}
type Candidate={coverage?:Coverage;geometry?:{valid?:boolean};validation?:{idealGeometry?:{valid?:boolean}}}
type ExecutionSummary=Dated&{status?:string;candidates?:Candidate[];diagnosticCandidates?:Candidate[]}
const singleLine=(value:string)=>value.replace(/\s+/g,' ').trim()
const label=(...parts:(string|undefined)[])=>parts.filter(Boolean).map(p=>singleLine(p!)).join(' · ')
const basename=(name:string)=>singleLine(name.split(/[\\/]/).at(-1)??'')

/** The zone comes from the server's status metadata, never the browser default. */
export function historyTime(value:string|undefined,serverTimeZone:string|undefined){
 if(!value||!serverTimeZone||!Number.isFinite(Date.parse(value)))return ''
 try{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:serverTimeZone,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value))
  const part=(type:string)=>parts.find(p=>p.type===type)?.value
  return `${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`
 }catch{return ''}
}
function analysisStatus(request:OperationRecord|undefined,analysis:AnalysisSummary|undefined){
 const background=request?.trace?.background?.state
 if(background==='submitting')return '提交中'
 if(background==='running'||request?.state==='running'&&!background)return '识别中'
 if(background==='timeout'||request?.state==='timeout')return '超时'
 if(background==='unknown'||request?.state==='unknown')return '状态未知'
 const validation=analysis?.analysisValidation??request?.record?.analysisValidation as AnalysisSummary['analysisValidation']
 if(request?.trace?.validation?.valid===false||validation?.state==='blocked')return '校验失败'
 if(request?.state==='failed')return '失败'
 if(request?.usable===false)return '无可审核结果'
 if(analysis||request?.usable&&request.record)return validation?.state==='reviewable'?'待审核（含诊断）':'待审核'
 if(request?.state==='complete'||background==='completed')return '已完成（无可审核结果）'
 return ''
}
export function analysisHistoryLabel(entry:Dated&{request?:OperationRecord},analysis:AnalysisSummary|undefined,source:SourceSummary|undefined,zone:string|undefined){
 const images=source?.images,final=images?.find(i=>i.role==='Final')?.name
 return label(historyTime(entry.createdAt,zone),source?(images?`${images.length}图`:'1图'):undefined,final?`Final: ${basename(final)}`:undefined,analysisStatus(entry.request,analysis))
}
export function reviewHistoryLabel(review:Dated&{input?:{review?:{pieces?:unknown[]}}},zone:string|undefined){
 const pieces=review.input?.review?.pieces
 return label(historyTime(review.createdAt,zone),pieces?`${pieces.length}实例`:undefined,'已保存')
}
export function planningHistoryLabel(plan:Dated&{plan?:{parts?:unknown[]}},zone:string|undefined){
 return label(historyTime(plan.createdAt,zone),plan.plan?.parts?`${plan.plan.parts.length}实例`:undefined,'已完成')
}
export function reconstructionHistoryLabel(execution:ExecutionSummary,zone:string|undefined){
 // Match the existing default preview preference; coverage and validity always
 // describe the same actual candidate, never an aggregate of different poses.
 const complete=(c:Candidate)=>Array.isArray(c.coverage?.reconstructed)&&c.coverage.reconstructed.length===c.coverage.totalConfirmed
 const normal=execution.candidates??[],diagnostic=execution.diagnosticCandidates??[]
 const candidate=normal.find(complete)??diagnostic.find(c=>c.validation?.idealGeometry?.valid&&complete(c))??normal[0]??diagnostic[0],coverage=candidate?.coverage
 const count=Array.isArray(coverage?.reconstructed)&&typeof coverage.totalConfirmed==='number'?`${coverage.reconstructed.length}/${coverage.totalConfirmed}块`:undefined
 const geometry=candidate?.geometry?.valid===true?'Geometry Valid':candidate?.geometry?.valid===false?'Geometry Invalid':''
 const status=geometry||(execution.status==='no_valid_candidate'?'无合法候选':execution.status==='budget_exhausted'?'预算耗尽':'')
 const partial=geometry==='Geometry Valid'&&coverage?.reconstructed&&typeof coverage.totalConfirmed==='number'&&coverage.reconstructed.length<coverage.totalConfirmed?'部分重建':''
 return label(historyTime(execution.createdAt,zone),count,[status,execution.status==='budget_exhausted'&&geometry?'预算耗尽':partial].filter(Boolean).join(' / '))
}
