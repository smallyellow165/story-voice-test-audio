import {acceptHumanDiagnostic} from '../human-collision-client.ts';
import {DRAFT_3D_KEY} from '../draft-storage.ts';
import {geometryIssueReferences,geometryIssueVisual} from './diagnostic-visual.ts';
import {reconstructionInput,subsetVisibleInput,reconstructionScopeMatches} from './reconstruction-scope.ts';
import type {ReconstructionScope} from './reconstruction-scope.ts';
import {useModulePlan} from './useModulePlan.ts';
import {ModulePlanControls} from './ModulePlanControls.tsx';
import {moduleFilterIds} from './module-plan.ts';
import {filteredReviewRows,reviewImageSelection} from '../../intake/review-display.ts';
import {ConstraintRefinementPanel} from './ConstraintRefinementPanel.tsx';
import type {RefinementRecord} from './ConstraintRefinementPanel.tsx';
import type {RefinementReference} from './constraint-refinement.ts';
import {adoptAllAIReview,planAIReview} from './review-profile-actions.ts';
import {editReviewedPiece} from './rebase-plan.ts';
import {VisibleEvidenceImage} from './VisibleEvidenceImage.tsx';
import {candidateObservationMap,inspectSpatialConsistency,observationState,visualPlaneRange} from './spatial-consistency.ts';
import type {ReviewedSpatialCheck3D} from './spatial-consistency.ts';
import {inspectPieceGeometry} from './pose-inspection.ts';
import {SpatialUnderstandingPanel,familyLabels} from './SpatialUnderstandingPanel.tsx';
import type {VisualConnection3D} from './spatial-understanding.ts';
import {ReviewObservationInspector} from './ReviewObservationInspector.tsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StudioSlot, useStudio, imageStages } from '../../StudioLayout.tsx';
import { useProfileRegistry } from '../../ProfileRegistry.tsx';
import { ReviewWorkspace } from '../../intake/ReviewWorkspace.tsx';
import {useReviewDisplay,preferredReviewImage} from '../../intake/review-display.ts';
import {ReviewImageFilter} from '../../intake/ReviewImageFilter.tsx';
import { intakeApi } from '../../intake/api.ts';
import {useSourceFrame,SourceImageStrip} from '../../intake/SourceImages.tsx';
import {evidenceForImage} from './image-evidence.ts';
import {SourceImagePicker} from '../../intake/SourceImagePicker.tsx';
import {workflowTerms} from '../../studio-terms.ts';
import {TraceViewer} from '../../intake/TraceViewer.tsx';
import type {TraceSource} from '../../intake/TraceViewer.tsx';
import {analysisRequest,analysisDisplay,planningScope,executionScope,planningRequest,executionRequest,planningDisplay,executionDisplay} from './reconstruction-display.ts';
import type {OperationRecord,OperationAttempt,ModelTrace,DisplayStatus} from './reconstruction-display.ts';
import {planningParticipation} from './planning-preflight.ts';
import type { Source, Evidence } from '../../intake/contracts.ts';
import {humanDiagnosticHandoffCheck} from './diagnostic-handoff.ts';
import {assemblyValidationLayers} from '../engine-adapter.ts';
import {executionPreviews,defaultExecutionPreview} from './execution-preview.ts';
import {CandidateCameraViewer} from './CandidateCameraViewer.tsx';
import {loadCandidateCamera} from './camera-view-storage.ts';
import type { Assembly3D } from '../assembly.ts';
import { adaptProfile } from '../profile-adapter.ts';
import type { VisibleEvidence3D, VisibleReview3D, VisibleInput3D, SpatialHypothesis3D, ConnectionHypothesis3D } from './contracts.ts';
import { parseVisibleEvidence } from './contracts.ts';
import type { VisibleExecution3D } from './execute.ts';
import './visible3d.css';
type Base = {
    id: string;
    hash: string;
    sourceId: string;
    sourceHash: string;
    createdAt: string;
    origin?: string;
    traceId?: string | null;
};
type Analysis = Base & {
    evidence: VisibleEvidence3D;
};
type Review = Base & {
    analysisId: string;
    input: VisibleInput3D;
};
type Plan = Base & {
    reconstructionScope?:ReconstructionScope;
    diagnostics?:string[];
    reviewId: string;
    plan: SpatialHypothesis3D;
};
type Execution = Base & VisibleExecution3D & {
    reconstructionScope?:ReconstructionScope;
    reviewId: string;
    planId: string;
    refinement?:RefinementReference;
};
type History = {
    refinements?:RefinementRecord[];
    origins?: Base[];
    analyses: Analysis[];
    reviews: Review[];
    plans: Plan[];
    executions: Execution[];
};
type Config = {
    models: {
        id: string;
        label: string;
        provider: string;
    }[];
    planningModels: {
        id: string;
        label: string;
        provider: string;
    }[];
    providers: Record<string, boolean>;
};
const key = 'magnetic-visible3d-context.v1', emptyReview: VisibleReview3D = { pieces: [], constraints: [] }, emptyEvidence = { version: 1, observations: [], unknowns: [] };
const api = <T,>(route: string, body?: unknown) => intakeApi<T>('visible3d/' + route, body);
function download(name: string, data: unknown) { const u = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
function ExecutionStatus({value,testId}:{value:DisplayStatus;testId:string}){return <div className="visible3d-execution-state" data-tone={value.tone} data-testid={testId} role={value.tone==='error'?'alert':'status'}><b>{value.label}</b><p>{value.message}</p></div>}
export default function Visible3DWorkflow() {
    const { stage, intakeMode, navigate, adopt3D } = useStudio(), { registry } = useProfileRegistry();
    const active = intakeMode === 'visible3d';
    const [config, setConfig] = useState<Config | null>(null), [history, setHistory] = useState<History>({ analyses: [], reviews: [], plans: [], executions: [] });
    const [refinement,setRefinement]=useState<RefinementReference|null>(null);
    const [imageSource,setImageSource]=useState<'upload'|'server'>('upload');
    const [source, setSource] = useState<Source | null>(null), [, setImage] = useState(''), [analysis, setAnalysis] = useState<Analysis | null>(null), [review, setReview] = useState<Review | null>(null), [planRecord, setPlan] = useState<Plan | null>(null), [executionRecord, setExecution] = useState<Execution | null>(null);
    const reviewDisplay=useReviewDisplay(source&&analysis?`visible3d:${source.id}:${source.hash}:${analysis.id}:${review?.id??'unsaved'}:${review?.hash??''}`:'',source,analysis?.evidence.observations??[]);
    const moduleStore=useModulePlan(review,active&&(stage==='review'||stage==='reconstruction'));
    const moduleView=moduleStore.data?.record??null;
    const reviewModules=moduleView?.modules??[];
    const moduleIds=moduleFilterIds(reviewModules,reviewModules.some(m=>m.id===reviewDisplay.state.moduleFilter)||reviewDisplay.state.moduleFilter==='unassigned'?reviewDisplay.state.moduleFilter!:'all',formForModules());
    function formForModules(){return review?.input.review??{pieces:analysis?.evidence.observations.map(o=>({id:o.id,confirmed:false,excluded:false,profileId:null,profileVersion:null,color:o.color}))??[],constraints:[]}}
    const moduleDisplay={...reviewDisplay,visibleIds:reviewDisplay.visibleIds.filter(id=>moduleIds.includes(id))};
    const moduleNames=Object.fromEntries(reviewModules.flatMap(m=>m.observationIds.map(id=>[id,m.name])));
    const groupScope=reviewDisplay.state.reconstructionGroup??'all',imageScope=reviewDisplay.state.reconstructionImage??'all';
    const reconstruction=useMemo(()=>{
        if(!review||!source)return null;
        if(groupScope!=='all'&&!moduleStore.data)return null;
        try{return reconstructionInput(review.input,source,{groupId:groupScope,imageId:imageScope},moduleView)}catch{return null}
    },[review,source,moduleView,groupScope,imageScope]);
    const plan=planRecord&&planRecord.reviewId===review?.id&&reconstructionScopeMatches(planRecord.reconstructionScope,reconstruction?.scope??null,planRecord.plan.parts.map(p=>p.id))?planRecord:null;
    const execution=plan&&executionRecord?.planId===plan.id&&reconstructionScopeMatches(executionRecord.reconstructionScope,reconstruction?.scope??null)?executionRecord:null;
    const frame=useSourceFrame(source,'visible3d',stage==='review'?reviewDisplay.imageIds:stage==='reconstruction'&&imageScope!=='all'?[imageScope]:undefined),displayEvidence=evidenceForImage(analysis?.evidence,frame.activeId,source?.primaryImageId??source?.id??'');
    const imageStrip=<><SourceImageStrip source={source} activeId={frame.activeId} onSelect={frame.select}/>{frame.error&&<p role="alert">图片读取失败：{frame.error}</p>}</>;
    const [form, setForm] = useState<VisibleReview3D>(emptyReview), [thickness, setThickness] = useState(.06), [head, setHead] = useState({ revision: 0, reviewId: null as string | null }), [selected, setSelected] = useState(''), [candidateId, setCandidateId] = useState(''), [checked, setChecked] = useState(false);
    const [model, setModel] = useState(''), [planningModel, setPlanningModel] = useState(''), [working, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [annotation, setAnnotation] = useState(JSON.stringify(emptyEvidence, null, 2)), [manual, setManual] = useState(''), [trace, setTrace] = useState<unknown>(null);
    const [imagePending,setImagePending]=useState(false);const busy=working||imagePending;
    const [maxAssignments, setMaxAssignments] = useState(128), [maxGeometryChecks, setMaxGeometryChecks] = useState(256), [maxLocalSubsets,setMaxLocalSubsets]=useState(1024);
    const [edgeA, setEdgeA] = useState(''), [edgeB, setEdgeB] = useState(''), [portA, setPortA] = useState(''), [portB, setPortB] = useState(''), [angles, setAngles] = useState(''), [flip, setFlip] = useState('unknown'), [edgeNote, setEdgeNote] = useState('');
    const [connectionOpen,setConnectionOpen]=useState(false),[edgeRefs,setEdgeRefs]=useState<string[]>([]),[edgeRange,setEdgeRange]=useState<{min:number;max:number}|null>(null);
    const [rebaseId,setRebaseId]=useState(''),[spaceRelation,setSpaceRelation]=useState<ReviewedSpatialCheck3D['relation']>('plane-angle'),[spaceMin,setSpaceMin]=useState(85),[spaceMax,setSpaceMax]=useState(90);
    const [viewRequest,setViewRequest]=useState(0);
    const [requests,setRequests]=useState<OperationRecord[]>([]),[requestError,setRequestError]=useState(''),[attempt,setAttempt]=useState<OperationAttempt|null>(null),[runningOperation,setRunningOperation]=useState<'plan'|'execute'|null>(null);
    const [analysisTraceSelection,setAnalysisTraceSelection]=useState('latest');
    const [analysisQuerying,setAnalysisQuerying]=useState(false),[analysisQueryError,setAnalysisQueryError]=useState('');
    const analysisQueryLock=useRef(false);
    const [traceOpenRequest,setTraceOpenRequest]=useState<{tab:string;sequence:number}>();
    useEffect(()=>{setAttempt(null)},[source?.id,review?.id,plan?.id,execution?.id]);
    useEffect(()=>{setTraceOpenRequest(undefined)},[stage,active]);
    const booted = useRef(false);
    const [bulkNotice,setBulkNotice]=useState('');
    useEffect(()=>setBulkNotice(''),[source?.id,analysis?.id,review?.id]);
    const bulkPlan=analysis?planAIReview(form,analysis.evidence,registry.profiles):null;
    function adoptAllSuggestions(){
      if(!analysis||!bulkPlan?.adopted||busy)return;
      const {adopted,skipped,skips}=bulkPlan;
      if(!window.confirm(`采用所有 AI 建议：预计采用 ${adopted}，跳过 ${skipped}。\n跳过：已确认 ${skips.confirmed}、已有审核 Profile ${skips.profile}、已排除 ${skips.excluded}、无合法候选 ${skips.noCandidate}。\n范围为完整 Review，按顺序采用首个合法候选；仅修改草稿，不自动保存或确认连接。`))return;
      const result=adoptAllAIReview(form,analysis.evidence,registry.profiles);
      setForm(result.review);setChecked(false);setBulkNotice(`已采用 ${result.adopted} · 已确认 ${result.adopted} · 跳过 ${result.skipped}`);
    }
    const dirty = !!review && (JSON.stringify(form) !== JSON.stringify(review.input.review) || review.input.profiles.some(s => s.thickness !== thickness));
    const reviewParticipation=review?planningParticipation(review.input.review):null;
    const participation=reviewParticipation?.blocker?reviewParticipation:reconstruction?planningParticipation(reconstruction.input.review):null;
    function chooseReconstruction(groupId:string,imageId:string){
      reviewDisplay.update({reconstructionGroup:groupId,reconstructionImage:imageId});
      let next=null;
      try{next=review&&source?reconstructionInput(review.input,source,{groupId,imageId},moduleView):null}catch(e){setError(String(e));setPlan(null);setExecution(null);return}
      const p=history.plans.find(p=>p.reviewId===review?.id&&reconstructionScopeMatches(p.reconstructionScope,next?.scope??null,p.plan.parts.map(p=>p.id)));
      const x=p?history.executions.find(x=>x.planId===p.id):null;
      setPlan(p??null);setExecution(x??null);setCandidateId(x?defaultExecutionPreview(x):'');setRefinement(x?.refinement??null);setChecked(false);setAttempt(null);setError('');setTrace(null);setNotice('');
    }
    function showHistoryScope(scope?:ReconstructionScope){reviewDisplay.update({reconstructionGroup:scope?.groupId??'all',reconstructionImage:scope?.imageId??'all'})}
    const refinementRecords=(history.refinements??[]).filter(r=>r.planId===plan?.id&&r.planHash===plan?.hash&&r.reviewId===review?.id&&r.reviewHash===review?.hash&&r.sourceId===source?.id&&r.sourceHash===source?.hash);
    const refinementRecord=refinementRecords.find(r=>r.id===refinement?.id&&r.hash===refinement.hash);
    const refinementMismatch=!!refinement&&(!refinementRecord||refinementRecord.candidateHashes[refinement.candidateId]!==refinement.candidateHash);
    const executionBindingMismatch=JSON.stringify(execution?.refinement??null)!==JSON.stringify(refinement);
    const outdated = !!execution && (execution.sourceId !== source?.id || execution.reviewId !== review?.id || head.reviewId !== review?.id || dirty || execution.planId !== plan?.id || executionBindingMismatch || refinementMismatch);
    const previews=executionPreviews(execution);
    const candidate = previews.find(c => c.id === candidateId) ?? null;
    const validation=candidate?(candidate.validation??assemblyValidationLayers(candidate.geometry)):null;
    const diagnostic=candidate?.kind==='diagnostic'||!!candidate&&!candidate.geometry.valid;
    const diagnosticIdentity=JSON.stringify([source?.hash,review?.hash,plan?.hash,execution?.id,execution?.hash,candidateId,groupScope,imageScope]);
    const [issueSelection,setIssueSelection]=useState<{identity:string;index:number;sequence:number}|null>(null);
    const diagnosticErrors=diagnostic?candidate?.geometry.issues.filter(i=>i.severity==='error')??[]:[];
    const selectedIssue=active&&stage==='reconstruction'&&issueSelection?.identity===diagnosticIdentity?diagnosticErrors[issueSelection.index]:undefined;
    const issueVisual=useMemo(()=>candidate&&selectedIssue?geometryIssueVisual(candidate.assembly,selectedIssue,candidate.collisions??[],diagnosticIdentity):undefined,[candidate,selectedIssue,diagnosticIdentity]);
    const issueCollisionFocus=useMemo(()=>issueVisual?.collision&&issueSelection?{target:issueVisual.collision,sequence:issueSelection.sequence}:null,[issueVisual,issueSelection]);
    useEffect(()=>setIssueSelection(null),[diagnosticIdentity,stage,active]);
    function selectDiagnosticError(index:number){const issue=diagnosticErrors[index];if(!candidate||!issue)return;setIssueSelection(s=>({identity:diagnosticIdentity,index,sequence:(s?.sequence??0)+1}))}
    function selectComparisonObservation(id:string){setIssueSelection(null);setSelected(id)}

    const diagnosticEligible=useMemo(()=>{try{return !!candidate&&humanDiagnosticHandoffCheck(candidate).allowed}catch{return false}},[candidate]);
    const originalExecutionInput=execution&&review&&execution.reviewId===review.id?review.input:history.reviews.find(r=>r.id===execution?.reviewId)?.input;
    const executionInput=originalExecutionInput&&execution?.reconstructionScope?subsetVisibleInput(originalExecutionInput,execution.reconstructionScope.observationIds):originalExecutionInput;
    const mapping=useMemo(()=>candidate?(candidate.observationMap??(executionInput?candidateObservationMap(candidate.assembly,executionInput):[])):[],[candidate,executionInput]);
    const selectedPieceId=mapping.find(m=>m.observationId===selected)?.pieceId??null;
    const spatial=useMemo(()=>candidate?(candidate.spatialConsistency??(executionInput?inspectSpatialConsistency(candidate.assembly,executionInput,mapping):null)):null,[candidate,executionInput,mapping]);
    const selectedGeometry=useMemo(()=>candidate&&selectedPieceId?inspectPieceGeometry(candidate.assembly).find(p=>p.id===selectedPieceId):null,[candidate,selectedPieceId]);
    function selectPiece(id:string|null){setIssueSelection(null);setSelected(id?mapping.find(m=>m.pieceId===id)?.observationId??'':'')}
    const selectedReview = form.pieces.find(p => p.id === selected), selectedEvidence = analysis?.evidence.observations.find(o => o.id === selected);
    function selectReviewedObservation(id:string){setSelected(id);const next=preferredReviewImage(analysis?.evidence.observations.find(o=>o.id===id),reviewDisplay.imageIds,frame.activeId,source?.primaryImageId??source?.id??'');if(next!==frame.activeId)frame.select(next)}
    const reviewImageControls=<ReviewImageFilter entries={frame.entries} imageIds={reviewDisplay.imageIds} activeId={frame.activeId} onImages={imageIds=>reviewDisplay.update({imageIds})} onActive={frame.select}/>;
    async function refreshRequests(){try{setRequests(await api<OperationRecord[]>('requests'));setRequestError('')}catch(e){setRequestError('请求记录读取失败：'+String(e))}}
    async function refresh() { const [h] = await Promise.all([api<History>('history'),refreshRequests()]); setHistory(h); return h; }
    async function loadSource(s: Source) { const [img, h] = await Promise.all([intakeApi<{
            mimeType: string;
            imageBase64: string;
        }>('image/' + s.id), api<typeof head>('head/' + s.id)]); setSource(s); setImage('data:' + img.mimeType + ';base64,' + img.imageBase64); setHead(h); setChecked(false); }
    async function openSourceImage(s:Source){
        setRefinement(null);setAnalysisTraceSelection('latest');await loadSource(s);setAnalysis(null);setReview(null);setPlan(null);setExecution(null);setForm(emptyReview);
        setCandidateId('');setSelected('');setAnnotation(JSON.stringify(emptyEvidence,null,2));setTrace(null);setAttempt(null);
    }
    function selectAnalysis(a: Analysis) { setRefinement(null); setAnalysisTraceSelection('record');setAttempt(null);setError('');setTrace(null);setAnalysis(a); setReview(null); setPlan(null); setExecution(null); setCandidateId(''); setChecked(false); setForm({ pieces: a.evidence.observations.map(o => ({ id: o.id, confirmed: false, excluded: false, profileId: null, profileVersion: null, color: o.color })), constraints: [] }); setSelected(a.evidence.observations[0]?.id ?? ''); setAnnotation(JSON.stringify(a.evidence, null, 2)); }
    function selectReview(r: Review) { setRefinement(null); setAttempt(null);setError('');setTrace(null);setReview(r); setForm(structuredClone(r.input.review)); setThickness(r.input.profiles[0]?.thickness ?? .06); setChecked(false); }
    async function run(work: () => Promise<void>,kind?:'plan'|'execute') { const scope=kind==='plan'?planningScope(source,review,reconstruction?.scope):JSON.stringify([executionScope(plan),refinement]);setBusy(true); setError(''); setNotice('');if(kind){setRunningOperation(kind);setAttempt({kind,scope})}try {
        await work();
    }
    catch (e) {
        setError(String(e));
        if(kind)setAttempt(a=>({...a,kind,scope,error:String(e)}));
    }
    finally {
        setBusy(false);
        if(kind)setRunningOperation(null);
    } }
    useEffect(() => {
        void run(async () => {
            const [c, h] = await Promise.all([api<Config>('status'), refresh()]);
            setConfig(c);
            setModel(c.models.find(m=>m.id==='gpt-6.1-sol')?.id??c.models.find(m => c.providers[m.provider])?.id ?? '');
            setPlanningModel(c.planningModels.find(m => c.providers[m.provider])?.id ?? '');
            const saved = JSON.parse(localStorage.getItem(key) || 'null');
            if(saved?.model&&c.models.some(m=>m.id===saved.model))setModel(saved.model);
            if (saved?.sourceId) {
                const s = await intakeApi<Source>('sources/' + saved.sourceId);
                await loadSource(s);
                const a = h.analyses.find(a => a.id === saved.analysisId && a.sourceId === s.id);
                if (a) {
                    selectAnalysis(a);
                    const r = h.reviews.find(r => r.id === saved.reviewId && r.analysisId === a.id);
                    if (r) {
                        selectReview(r);
                        const p = h.plans.find(p => p.id === saved.planId && p.reviewId === r.id);
                        if (p) {
                            setRefinement(null);setPlan(p);
                            setManual(JSON.stringify(p.plan, null, 2));
                            const x = h.executions.find(x => x.id === saved.executionId && x.planId === p.id);
                            if (x) {
                                setExecution(x);setRefinement(x.refinement??null);
                                setCandidateId(executionPreviews(x).some(c=>c.id===saved.candidateId)?saved.candidateId:defaultExecutionPreview(x));
                            }
                        }
                    }
                }
            }
            if(saved?.refinement&&['id','hash','candidateId','candidateHash'].every(k=>typeof saved.refinement[k]==='string')){
                setRefinement(saved.refinement);
                if(!h.refinements?.some(r=>r.id===saved.refinement.id&&r.hash===saved.refinement.hash&&r.planId===saved.planId&&r.reviewId===saved.reviewId&&r.candidateHashes[saved.refinement.candidateId]===saved.refinement.candidateHash))setError('保存的 Refinement 不可用或来源已变化；未回退到原始 Plan，请明确重新选择。');
            }
            setAnalysisTraceSelection(typeof saved?.analysisTraceRequestId==='string'?saved.analysisTraceRequestId:'latest');
            booted.current = true;
        });
    }, []);
    useEffect(() => { if (booted.current)
        try {
            localStorage.setItem(key, JSON.stringify({ sourceId: source?.id, analysisId: analysis?.id, reviewId: review?.id, planId: planRecord?.id, executionId: executionRecord?.id,candidateId,model,refinement,analysisTraceRequestId:analysisTraceSelection }));
        }
        catch (e) {
            setError('Visible 3D 恢复索引保存失败：' + String(e));
        } }, [source, analysis, review, planRecord, executionRecord,candidateId, busy,model,analysisTraceSelection,refinement]);
    useEffect(() => { if (!active || !source)
        return; const update = () => {if(stage==='source')void refreshRequests();void api<typeof head>('head/' + source.id).then(setHead).catch(e => setError(String(e)))}; update(); window.addEventListener('focus', update); return () => window.removeEventListener('focus', update); }, [active, stage, source]);
    const projectedReview = useMemo<Evidence | undefined>(() => analysis ? { sourceKind: 'unsupported', reason: '只供共享 Review 表展示；不是 2D Reconstruction 输入', relations: form.constraints.map(c => ({ from: c.pieceA, to: c.pieceB, intent: c.intent, evidence: c.evidence })), observations: analysis.evidence.observations.map(o => { const p = form.pieces.find(p => p.id === o.id), b = o.bbox; return { id: o.id, profileId: p?.profileId ?? 'unknown', profileVersion: p?.profileVersion ?? 1, color: p?.color ?? o.color, outline: b ? [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]] : [], confidence: 0, evidence: o.evidence, uncertainty: o.uncertainty, origin: 'observed', excluded: !!p?.excluded }; }) } : undefined, [analysis, form]);
    const reviewRows=filteredReviewRows(projectedReview?.observations??[],moduleDisplay.visibleIds,reviewDisplay.state,o=>registry.profiles.find(p=>p.id===o.profileId&&p.version===o.profileVersion)?.name??'');
    const reviewSelection=reviewImageSelection(reviewDisplay.state,frame.activeId,reviewDisplay.idsForImage(frame.activeId),reviewRows.map(o=>o.id),true);
    const reviewEvidence=displayEvidence?{...displayEvidence,observations:displayEvidence.observations.filter(o=>reviewSelection.markedIds.includes(o.id)&&reviewRows.some(r=>r.id===o.id))}:undefined;
    function editPiece(update: Partial<VisibleReview3D['pieces'][number]>) { setBulkNotice('');setForm(f=>editReviewedPiece(f,selected,update));if(update.excluded||update.confirmed===false)setNotice('当前审核草稿已移除该片相关人工连接/空间检查；原保存快照未改变。');else if(update.profileId!==undefined||update.profileVersion!==undefined)setNotice('Profile 已更新；相关 Port 需重新核对。');setChecked(false); }
    const ports = (id: string) => { const p = form.pieces.find(p => p.id === id), profile = registry.profiles.find(s => s.id === p?.profileId && s.version === p?.profileVersion); return profile ? adaptProfile({ profile, thickness }).shape.ports : []; };
    function chooseVisualConnection(c:VisualConnection3D){
      if(!form.pieces.some(p=>p.id===c.pieceA&&p.confirmed&&!p.excluded)||!form.pieces.some(p=>p.id===c.pieceB&&p.confirmed&&!p.excluded)){setError('请先确认建议所涉及的两个可见实例。');return}
      setEdgeA(c.pieceA);setEdgeB(c.pieceB);const range=c.angleRange?visualPlaneRange(c.angleRange.min,c.angleRange.max):c.foldAngleCandidatesDeg.length?[Math.min(...c.foldAngleCandidatesDeg.map(a=>visualPlaneRange(a,a)[0])),Math.max(...c.foldAngleCandidatesDeg.map(a=>visualPlaneRange(a,a)[0]))]:[0,90];setSpaceRelation('plane-angle');setSpaceMin(Number(range[0].toFixed(4)));setSpaceMax(Number(range[1].toFixed(4)));setPortA('');setPortB('');setAngles(c.foldAngleCandidatesDeg.join(','));setFlip('unknown');setEdgeNote(c.reasoning+' · '+c.uncertainty);setEdgeRefs(c.evidenceRefs);setEdgeRange(c.angleRange);setConnectionOpen(true);setNotice('建议已填入人工连接表单；请核对端口与角度符号后再加入约束。未自动建立连接。')
    }
    async function usePlanVariant(connections:ConnectionHypothesis3D[]){
      if(!plan||!review)return
      const p=await api<Plan>('manual-plan',{reviewId:review.id,basedOnPlanId:plan.id,reconstructionScope:reconstruction?.scope,plan:{...plan.plan,connections,alternatives:[]}})
      setRefinement(null);setPlan(p);setExecution(null);setManual(JSON.stringify(p.plan,null,2));await refresh();setNotice('已创建独立的人工选择计划；原模型计划与 Trace 保留，尚未执行几何。')
    }
    const seedPlan = (): SpatialHypothesis3D => ({ version: 1, parts: (reconstruction?.input.review.pieces??form.pieces).filter(p => p.confirmed && !p.excluded).map(p => ({ id: p.id, profileId: p.profileId, profileVersion: p.profileVersion, orientationEvidence: '人工待审核；世界朝向未知' })), connections: structuredClone(reconstruction?.input.review.constraints??form.constraints), alternatives: [], relations: [], unknowns: ['相机与世界朝向尚未标定'] });
    async function modelAction(kind: 'analyze' | 'plan') {
        if(kind==='plan'){
            if(!review)throw Error('请先保存或选择 Review。');
            if(reviewParticipation?.blocker)throw Error(reviewParticipation.blocker);
            if(!reconstruction?.scope.observationIds.length)throw Error('当前范围没有可重建的交集，未调用模型');
            const {blocker}=planningParticipation(reconstruction.input.review);if(blocker)throw Error(blocker);
        }
        const requestId=crypto.randomUUID();if(kind==='analyze')setAnalysisTraceSelection(requestId);
        const r = await api<{
            id: string;
            state: string;
            error?: string;
            record?: Analysis | Plan;
            trace?: {
                id: string;
            };
        }>(kind, { sourceId: source?.id,...(kind==='analyze'?{sourceHash:source?.hash}:{}), reviewId: review?.id,...(kind==='plan'?{reconstructionScope:reconstruction?.scope}:{}), model: kind === 'analyze' ? model : planningModel, requestId });
        if(kind==='plan')setAttempt({id:r.id,kind:'plan',scope:planningScope(source,review,reconstruction?.scope)});
        await refreshRequests();
        if (r.trace)
            setTrace(await api('trace/' + r.trace.id));
        if(kind==='analyze'&&r.state==='running'){setNotice('已提交后台识别；只查询同一个任务。可切换阶段或刷新后恢复查询。');return}
        if (r.state !== 'complete' || !r.record)
            throw Error(r.error ?? '模型未返回可用契约；请查看 Trace，不自动重试');
        if (kind === 'analyze') {
            selectAnalysis(r.record as Analysis);
            navigate('review');
        }
        else {
            setRefinement(null);setPlan(r.record as Plan);
            setExecution(null);
            setManual(JSON.stringify((r.record as Plan).plan, null, 2));
        }
        await refresh();
    }
    const analysisModelRequest=analysisRequest(requests,source,analysis,analysisTraceSelection);
    const analysisQueryScope=useRef('');analysisQueryScope.current=JSON.stringify([source?.id,source?.hash,analysisModelRequest?.id]);
    const analysisStatus=analysisDisplay(analysisModelRequest),analysisBackground=analysisModelRequest?.trace?.background;
    const analysisPending=analysisModelRequest?.state==='running';
    async function queryAnalysis(request=analysisModelRequest){
      if(!request||!source||analysisQueryLock.current)return;
      const scope=JSON.stringify([source.id,source.hash,request.id]);
      analysisQueryLock.current=true;setAnalysisQuerying(true);setAnalysisQueryError('');setError('');setNotice('');
      try{await api('resume-analyze',{requestId:request.id,sourceId:source.id,sourceHash:source.hash});await refresh()}
      catch(e){if(analysisQueryScope.current===scope)setAnalysisQueryError(String(e)+'；未重新提交模型请求，可再次查询同一任务。')}
      finally{analysisQueryLock.current=false;setAnalysisQuerying(false)}
    }
    useEffect(()=>setAnalysisQueryError(''),[source?.id,source?.hash,analysisModelRequest?.id]);
    useEffect(()=>{
      if(!active||stage!=='source'||!analysisPending||analysisBackground?.responseId)return;
      const timer=window.setInterval(()=>void refreshRequests(),3000);return()=>window.clearInterval(timer);
    },[active,stage,analysisPending,analysisBackground?.responseId]);
    useEffect(()=>{
      if(!active||stage!=='source'||!analysisBackground?.responseId||analysisBackground.state!=='running'||analysisQueryError)return;
      // A bounded UI polling window, not a generation deadline. After 20 min the
      // user can still retrieve exactly the same response explicitly.
      const started=Date.now(),timer=window.setInterval(()=>{if(Date.now()-started>20*60*1000){window.clearInterval(timer);setAnalysisQueryError('自动查询已暂停；可继续手动查询同一任务，不会重新生成。');return}void queryAnalysis()},5000);
      return()=>window.clearInterval(timer);
    },[active,stage,source?.id,source?.hash,analysisModelRequest?.id,analysisBackground?.state,analysisBackground?.responseId,analysisQueryError]);
    const planRequest=planningRequest(requests,source,review,plan,attempt,reconstruction?.scope),executeRequest=executionRequest(requests,plan,execution,attempt,refinement);
    const planStatus=planningDisplay(plan,planRequest,runningOperation==='plan',attempt?.kind==='plan'&&attempt.scope===planningScope(source,review,reconstruction?.scope)?attempt.error:undefined);
    const executeStatus=executionDisplay(plan,execution,executeRequest,runningOperation==='execute',attempt?.kind==='execute'&&attempt.scope===JSON.stringify([executionScope(plan),refinement])?attempt.error:undefined);
    const planOutdated=!!plan&&(plan.sourceId!==source?.id||plan.sourceHash!==source?.hash||plan.reviewId!==review?.id||dirty||head.reviewId!==review?.id);
    const traceSource=useMemo<TraceSource>(()=>{
      const references={sourceId:source?.id,sourceHash:source?.hash,analysisId:analysis?.id,analysisHash:analysis?.hash,reviewId:review?.id,reviewHash:review?.hash,planId:plan?.id,planHash:plan?.hash,executionId:execution?.id,executionHash:execution?.hash,candidateId};
      const partsRequest=stage==='source'?analysisModelRequest:undefined;
      const partsRecordMatches=!!analysis&&partsRequest?.record?.id===analysis.id&&analysis.sourceId===source?.id&&analysis.sourceHash===source?.hash;
      return {identity:JSON.stringify([stage,analysisTraceSelection,partsRequest?.id,partsRequest?.state,partsRequest?.trace?.latestPollId,references,planRequest?.id,planRequest?.state,executeRequest?.id,executeRequest?.state]),initialTab:stage==='source'?'parts':'spatial',tabs:[['parts','Parts / Review'],['spatial','Spatial Planning'],['execution','Geometry Execution']],fileReference:tab=>tab==='parts'&&partsRequest?{mode:'visible3d',tab,sourceId:source?.id,sourceHash:source?.hash,requestId:partsRequest.id,...(partsRecordMatches?{analysisId:analysis?.id,analysisHash:analysis?.hash,reviewId:review?.id,reviewHash:review?.hash}:{})}:({mode:'visible3d',tab,sourceId:source?.id,sourceHash:source?.hash,analysisId:analysis?.id,analysisHash:analysis?.hash,reviewId:review?.id,reviewHash:review?.hash,...(tab==='parts'?{}:{planId:plan?.id,planHash:plan?.hash}),...(tab==='spatial'?{requestId:planRequest?.id}:tab==='execution'?{executionId:execution?.id,executionHash:execution?.hash,requestId:executeRequest?.id}:{})}),load:async tab=>{
        if(tab==='execution')return {references,selectedRefinement:refinementRecord??null,refinementSelection:refinement,request:executeRequest??null,execution:execution?await api('executions/'+execution.id):null,candidateValidator:candidate?.geometry??null,candidateValidation:validation,candidateCollisions:candidate?.collisions??null,candidateConstruction:candidate?.construction??null,spatialConsistency:spatial,availability:execution?'已保存的确定性几何执行记录；无额外模型调用':'尚无 Trace：尚未选择 Geometry Execution',requestReadError:requestError||null};
        const record=tab==='parts'?analysis:plan,request=tab==='spatial'?planRequest:partsRequest;
        const pinnedMissing=tab==='parts'&&stage==='source'&&!['latest','record'].includes(analysisTraceSelection)&&!request;
        const recordMatches=tab!=='parts'||record?.sourceId===source?.id&&record?.sourceHash===source?.hash;
        const traceId=request?.trace?.id??(!pinnedMissing&&recordMatches?record?.traceId:null);
        const [savedTrace,wire]=traceId?await Promise.all([api<ModelTrace>('trace/'+traceId),api('trace/'+traceId+'/wire')]):[null,null];
        if(tab==='parts'&&stage==='source'&&savedTrace&&!savedTrace.sources?.some(s=>s.sourceId===source?.id&&s.sourceHash===source?.hash))throw Error('Analysis Trace 的 Source ID / Hash 与当前图片集合不一致；未显示其他记录。');
        return {references,request:request??null,trace:savedTrace,wire,availability:savedTrace?'实际保存的模型 Trace':'尚无 Trace',requestOrigin:'trace.request 是保存的应用请求；实际 HTTP 正文见 wire.request，未保存时不补齐。',...(tab==='parts'?{analysis:partsRequest&&!partsRecordMatches?null:analysis,review:partsRequest&&!partsRecordMatches?null:review,...(partsRequest&&!partsRecordMatches?{retainedAnalysis:analysis?{id:analysis.id,hash:analysis.hash}:null,note:partsRequest.record?'该调用对应另一条已保存 Analysis；工作区的原选中记录未自动更改。':'该调用未生成有效 Recognition Result；原有 Analysis / Review 未被失败结果覆盖。'}:{})}:{selectedPlan:plan,diagnostics:plan?.diagnostics??[],note:'Plan Ready 不代表照片语义正确或 Geometry Valid；失败请求按 Source / Review ID 与 Hash 关联。'}),requestReadError:requestError||null};
      }};
    },[stage,analysisTraceSelection,analysisModelRequest,source,analysis,review,plan,execution,candidateId,candidate,spatial,planRequest,executeRequest,requestError,refinementRecord,refinement]);
    function openReconstructionTrace(tab:string){setTraceOpenRequest(r=>({tab,sequence:(r?.sequence??0)+1}))}
    const comparisonEvidence=displayEvidence?{...displayEvidence,observations:displayEvidence.observations.filter(o=>reconstruction?.scope.observationIds.includes(o.id))}:undefined;
    const imageView=<>{imageScope==='all'&&frame.entries.length>1&&<label className="reconstruction-evidence-browser">证据浏览<select aria-label="重建证据浏览图片" value={frame.activeId} onChange={e=>frame.select(e.target.value)}>{frame.entries.map(i=><option key={i.sourceId} value={i.sourceId}>{i.name}</option>)}</select></label>}<VisibleEvidenceImage source={frame.displaySource} image={frame.image} evidence={comparisonEvidence} selected={selected} onSelect={selectComparisonObservation} excluded={form.pieces.filter(p=>p.excluded).map(p=>p.id)}/></>;
    return <>
  <StudioSlot column="workflow" stages={['source','review','reconstruction','assembly','build']} intake="visible3d" view="3d"><p>Visible 3D · {source?.name ?? '未选照片'}</p><button disabled={busy} onClick={() => void run(async () => { await refresh(); if (source)
        setHead(await api('head/' + source.id)); })}>刷新 3D 历史</button>
   {source && <><label>3D Analysis 历史<select aria-label="3D Analysis 历史" value={analysis?.id ?? ''} disabled={busy} onChange={e => { const a = history.analyses.find(a => a.id === e.target.value); if (a)
            selectAnalysis(a); }}><option value="">选择 Analysis</option>{history.analyses.filter(a => a.sourceId === source.id).map(a => <option key={a.id} value={a.id}>{a.origin} · {a.createdAt}</option>)}</select></label>
   <label>3D Review 历史<select aria-label="3D Review 历史" value={review?.id ?? ''} disabled={busy} onChange={e => { const r = history.reviews.find(r => r.id === e.target.value); if (r) {
            selectReview(r);
            setPlan(null);
            setExecution(null);
        } }}><option value="">选择 Review</option>{history.reviews.filter(r => r.analysisId === analysis?.id).map(r => <option key={r.id} value={r.id}>{r.id.slice(0, 8)}{head.reviewId === r.id ? ' · Current' : ' · Outdated'}</option>)}</select></label>
   <label>Spatial Planning History<select aria-label="Spatial Planning History" value={plan?.id ?? ''} disabled={busy} onChange={e => { const p = history.plans.find(p => p.id === e.target.value); if (p) {
            setAttempt(null);setError('');setTrace(null);
            showHistoryScope(p.reconstructionScope);setRefinement(null);setPlan(p);
            setExecution(null);
        } }}><option value="">选择 Plan</option>{history.plans.filter(p => p.reviewId === review?.id).map(p => <option key={p.id} value={p.id}>{p.origin} · {p.id.slice(0, 8)}{p.reconstructionScope?` · ${p.reconstructionScope.groupName} / ${p.reconstructionScope.imageName}`:' · 全部范围'}</option>)}</select></label>
   <label>Geometry Execution History<select aria-label="Geometry Execution History" value={execution?.id ?? ''} disabled={busy} onChange={e => { const x = history.executions.find(x => x.id === e.target.value); if (x) {
            setAttempt(null);setError('');setTrace(null);
            showHistoryScope(history.plans.find(p=>p.id===x.planId)?.reconstructionScope);setExecution(x);setRefinement(x.refinement??null);
            setCandidateId(defaultExecutionPreview(x));setChecked(false);setViewRequest(n=>n+1);
        } }}><option value="">选择 Execution</option>{history.executions.filter(x => x.planId === plan?.id).map(x => <option key={x.id} value={x.id}>{x.status} · {x.id.slice(0, 8)}</option>)}</select></label></>}
  </StudioSlot>
  <StudioSlot column="workspace" stages={['source']} intake="visible3d"><section className="analysis-image-preview" aria-label="Visible 3D Analysis 原图">
   <h3>原图与可见证据（Source）</h3>{source&&<p>{source.name} · 快照 {source.id.slice(0,8)}</p>}
   {imageStrip}<VisibleEvidenceImage fit source={frame.displaySource} image={frame.image} evidence={displayEvidence} selected={selected} onSelect={setSelected} excluded={form.pieces.filter(p=>p.excluded).map(p=>p.id)}/>
   {selected&&<p className="hint">当前零件：{selected} <button onClick={()=>navigate('review')}>修正选中零件</button></p>}
  </section></StudioSlot>
  <StudioSlot column="workspace" stages={['review']} intake="visible3d"><ReviewWorkspace spatial moduleNames={moduleNames} moduleControls={selection=><ModulePlanControls key={review?.id??'unsaved'} store={moduleStore} display={reviewDisplay} selection={selection} busy={busy}/>}  bulkControl={<><button disabled={busy||!bulkPlan?.adopted} onClick={adoptAllSuggestions}>采用所有 AI 建议</button>{bulkNotice&&<span role="status" className="review-bulk-summary">{bulkNotice}</span>}</>} inputHelp={!review?'请先保存完整 Review。进入下一页不会执行模型；Spatial Planning 仅使用已保存、已确认且未排除的实例。':dirty?'当前 Review 有未保存修改，请先保存。Planning 不会使用未保存的草稿。':head.reviewId!==review.id?'当前 Review 已过期，请重新加载最新审核记录后执行 Planning。':`已保存 Review。${participation?.blocker??'可进入 Reconstruction；未确认或已排除实例不参与 Spatial Planning。'}`} currentImageId={frame.activeId} display={moduleDisplay} imageControls={reviewImageControls} evidenceLabel={frame.displaySource?.name} spatialLabels={Object.fromEntries((analysis?.evidence.observations??[]).map(o=>[o.id,o.shapeAssessment?familyLabels[o.shapeAssessment.family]:'V1 未记录 Shape Family']))} confirmedIds={form.pieces.filter(p => p.confirmed && !p.excluded).map(p => p.id)} active={active && stage === 'review'} evidence={projectedReview} imageWidth={source?.view.width ?? 1} imageHeight={source?.view.height ?? 1} selected={selected} onSelect={selectReviewedObservation} busy={busy} saveControl={<button disabled={busy || !analysis} onClick={() => void run(async () => { const r = await api<{
        record: Review;
        head: typeof head;
    }>('reviews', { analysisId: analysis!.id, review: form, thickness, expectedRevision: head.revision, ...(review?{baseReview:{id:review.id,hash:review.hash}}:{}) }); setRebaseId(plan?.id??rebaseId); selectReview(r.record); setHead(r.head); setPlan(null); setExecution(null); await refresh(); setNotice('3D Review 已保存，实例集固定；下一步 Spatial Planning'); })}>保存 3D Review</button>} inputControl={<button disabled={!review || dirty} onClick={() => navigate('reconstruction')}>进入 3D Reconstruction</button>} onAdd={() => { }} addDisabled>{frame.error&&<p role="alert">图片读取失败：{frame.error}</p>}{!reviewDisplay.imageIds.length?<p className="studio-empty">尚未选择图片；请在顶部图片筛选中选择图片或恢复全部。</p>:<><VisibleEvidenceImage fit source={frame.displaySource} image={frame.image} evidence={reviewEvidence?{...reviewEvidence,observations:reviewEvidence.observations.filter(o=>o.bbox||o.features.length)}:undefined} selected={selected} onSelect={selectReviewedObservation} excluded={form.pieces.filter(p=>p.excluded).map(p=>p.id)}/>{!reviewEvidence?.observations.some(o=>o.bbox||o.features.length)&&<p role="status" className="review-image-empty">{reviewEvidence?.observations.length?'该图片有关联实例，但没有可显示的边框或顶点标注。':displayEvidence?.observations.length?'当前图片没有勾选可显示的实例；请勾选表格或调整筛选。':'当前图片没有 Observation Evidence；这与是否人工确认无关。'}</p>}</>}</ReviewWorkspace></StudioSlot>
  <StudioSlot column="workspace" stages={['reconstruction']} intake="visible3d">
   <section className="visible3d-workspace visible3d-reconstruction" aria-label="Visible 3D 照片与候选对照">
    <div className="reconstruction-scope-tools" aria-label="重建范围"><label>Group<select aria-label="重建 Group" disabled={busy||!review||moduleStore.busy} value={groupScope} onChange={e=>chooseReconstruction(e.target.value,imageScope)}><option value="all">全部模块</option>{reviewModules.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label>Image<select aria-label="重建 Image Scope" disabled={busy||!review} value={imageScope} onChange={e=>chooseReconstruction(groupScope,e.target.value)}><option value="all">所有图片</option>{frame.entries.map(i=><option key={i.sourceId} value={i.sourceId}>{i.name}</option>)}</select></label><span data-testid="reconstruction-scope-summary">{reconstruction?`${reconstruction.scope.groupName} · ${reconstruction.scope.imageName} · ${reconstruction.scope.observationIds.length}/${reconstruction.groupCount} 块`:'正在读取当前重建范围'}</span></div>
    {reconstruction&&!reconstruction.scope.observationIds.length&&<p role="status">当前 Group 与 Image 没有可重建的交集。</p>}
    <div className="visible3d-comparison-heading"><h3>照片与 3D Candidate 对照</h3><p className="context-notice">来源 {source?.name??'未选照片'} · {candidate?.id??'尚无候选'}</p>
     {candidate&&<p data-testid="visible3d-preview-validation"><b className={diagnostic?'visible3d-preview-blocker':undefined}>{diagnostic?'Diagnostic · Geometry Invalid':'Geometry Valid'}</b> · Ideal Geometry {validation?.idealGeometry.valid?'Valid':'Invalid'} · Solid Collision {validation?.solidCollision.valid?'Valid':'Invalid'} · Coverage {candidate.coverage.reconstructed.length}/{candidate.coverage.totalConfirmed} · Photo Match Unverified</p>}
    </div>
    {candidate ? <><div className="visible3d-compare"><section aria-label="原图对照"><h4>原图 · 点击可见片或使用下方列表</h4>{imageView}</section><section aria-label="Candidate 对照"><h4>3D Candidate · 按保存 Pose 查看</h4>{active && stage === 'reconstruction' && <CandidateCameraViewer key={`${execution!.id}/${candidate.id}/${viewRequest}`} reference={{executionId:execution!.id,executionHash:execution!.hash,candidateId:candidate.id}} assembly={candidate.assembly} selected={selectedPieceId} onSelect={selectPiece} geometryIssue={issueVisual} issueFocus={issueSelection?.sequence} collision={issueVisual?.collision} collisionFocus={issueCollisionFocus}/>}</section></div><p className="hint">观察辅助只改变相机；不会校准照片、重排零件或改动 Pose。镜像解释仍须逐片核对。</p><div role="group" aria-label="Observation 与 Piece 对应">{executionInput?.evidence.observations.map(o=>{const state=executionInput?observationState(o.id,executionInput,mapping):'unresolved';return <button key={o.id} data-linked-observation={o.id} aria-pressed={selected===o.id} onClick={()=>selectComparisonObservation(o.id)}>{o.id} → {mapping.find(m=>m.observationId===o.id)?.pieceId??'未重建'} · {state}</button>})}</div></> : <div className="visible3d-compare"><section aria-label="原图对照"><h4>原图</h4>{imageView}</section><section aria-label="Candidate 对照"><h4>3D Candidate</h4><p className="studio-empty">在右侧 Inspector 完成 Spatial Planning 和 Geometry Execution，再选择候选进行对照。</p></section></div>}
   </section>
  </StudioSlot>
  <StudioSlot column="inspector" stages={imageStages} intake="visible3d"><section className={stage==='source'?'visible3d-inspector visible3d-analysis-inspector':stage==='reconstruction'?'visible3d-inspector visible3d-reconstruction-inspector':'visible3d-inspector visible3d-review-inspector'}>{stage==='source'||stage==='reconstruction'?<div className={stage==='source'?'review-inspector-heading visible3d-analysis-heading':'review-inspector-heading visible3d-reconstruction-heading'}>{stage==='reconstruction'&&<h2>{workflowTerms.reconstruction.label}</h2>}{active&&<TraceViewer key={stage} source={traceSource} openRequest={traceOpenRequest}/>}</div>:null}{busy && <p role="status">正在处理；不会自动重试模型请求…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
   {stage==='source'&&<section className="intake-controls source-inspector" aria-label="Visible 3D 图片与识别操作">
    <SourceImagePicker onPendingChange={setImagePending} onSelectImage={frame.select} activeImageId={frame.activeId} sourceType={imageSource} onSourceTypeChange={setImageSource} currentSource={source} disabled={busy}
     onSource={async s=>{if(s)await openSourceImage(s);else{setAnalysisTraceSelection('latest');setSource(null);setAnalysis(null);setReview(null);setPlan(null);setExecution(null);setForm(emptyReview);setSelected('');setAnnotation(JSON.stringify(emptyEvidence,null,2));setTrace(null)}}}
     onOpenSource={id=>void run(async()=>{const s=await intakeApi<Source>('sources/'+id);await openSourceImage(s)})}/>
    <label className="compact-field">下次识别模型<select aria-label="3D Vision 模型" value={model} onChange={e=>setModel(e.target.value)} disabled={busy}><option value="">选择已配置模型</option>{config?.models.map(m=><option key={m.id} value={m.id} disabled={!config.providers[m.provider]}>{m.label}{config.providers[m.provider]?'':'（未配置）'}</option>)}</select></label>
    <button className="primary" disabled={busy||analysisPending||!source||!model} onClick={()=>{if(analysisBackground&&['unknown','timeout'].includes(analysisBackground.state)&&!window.confirm('上次请求可能仍在执行或已产生费用。建议先查询已有任务。确定要创建一次新的付费识别请求吗？'))return;void run(()=>modelAction('analyze'))}}>Analyze Visible 3D（调用模型）</button>
    <ExecutionStatus value={analysisStatus} testId="visible3d-analysis-state"/>
    {source&&requests.some(r=>analysisRequest([r],source,null))&&<label className="compact-field">识别请求（已有记录）<select aria-label="Analysis 已有请求" value={analysisTraceSelection} disabled={busy||analysisQuerying} onChange={e=>{setAnalysisTraceSelection(e.target.value);setAnalysisQueryError('');setError('');setTrace(null)}}><option value="latest">当前图片集合 · 最新请求</option>{analysis&&<option value="record">当前选中 Analysis 的请求</option>}{requests.filter(r=>analysisRequest([r],source,null)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(r=><option key={r.id} value={r.id}>{r.createdAt} · {r.trace?.background?.state??r.trace?.status??r.state} · {r.id.slice(0,8)}</option>)}</select></label>}
    {analysisQueryError&&<p role="alert">{analysisQueryError}</p>}
    {analysisBackground?.responseId&&<button disabled={busy||analysisQuerying||['completed','failed'].includes(analysisBackground.state)} onClick={()=>void queryAnalysis()}>{analysisQuerying?'查询中…':'查询 / 恢复已有识别任务'}</button>}
    {analysisBackground?.state==='completed'&&analysisModelRequest?.usable&&analysisModelRequest.record&&analysis?.id!==analysisModelRequest.record.id&&<button onClick={()=>{selectAnalysis(analysisModelRequest.record as Analysis);navigate('review')}}>打开已完成识别并 Review</button>}
    <p className="hint">选择图片不会调用模型。仅识别可见证据，空间解释与 Geometry Valid 分开审核。</p>
    {analysis&&<p role="status">{analysis.origin==='model'?'已保存模型识别':'人工标注'} · {analysis.evidence.observations.length} 个可见实例 · {analysis.id.slice(0,8)}</p>}
   <details><summary>人工标注 / 离线验证（不调用模型）</summary><p>导入 VisibleEvidence3D JSON；必须保留可见区域或边角证据。人工标注不代表 Vision 识别成功率。</p><textarea spellCheck={false} aria-label="Visible 3D 人工标注 JSON" value={annotation} onChange={e => setAnnotation(e.target.value)}/><input aria-label="导入 3D 标注文件" type="file" accept="application/json" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f)
        void f.text().then(setAnnotation); }}/><button disabled={busy || !source} onClick={() => void run(async () => { const a = await api<Analysis>('annotate', { sourceId: source!.id, evidence: parseVisibleEvidence(JSON.parse(annotation)) }); selectAnalysis(a); await refresh(); navigate('review'); })}>保存人工标注并 Review</button></details>

   </section>}
   {stage === 'review' && <>{selectedReview ? <ReviewObservationInspector key={`${analysis?.id}/${selectedReview.id}`} piece={selectedReview} evidence={selectedEvidence} profiles={registry.profiles} busy={busy} currentImageId={frame.activeId} onEdit={editPiece} onImage={frame.select} images={(selectedEvidence?.imageEvidence??[]).map(e=>({id:e.imageId,name:frame.entries.find(i=>i.sourceId===e.imageId)?.name??e.imageId,selected:frame.activeId===e.imageId,available:reviewDisplay.imageIds.includes(e.imageId)}))}/> : <p>请先在图片阶段分析或导入标注。</p>}
    <details className="review-spatial-evidence" data-testid="review-spatial-evidence"><summary>空间解释与证据 · {analysis?.evidence.spatialInterpretation?.connections.length??0} 条可见连接</summary>
     <SpatialUnderstandingPanel key={analysis?.id} compact label="Vision 整体空间理解" value={analysis?.evidence.spatialInterpretation} onChoose={chooseVisualConnection} disabled={busy}/>
    <label>整体解释人工审核<select aria-label="3D 整体解释审核" disabled={busy} value={form.interpretationReview?.status??'unreviewed'} onChange={e=>setForm(f=>({...f,interpretationReview:{status:e.target.value as 'unreviewed'|'accepted'|'corrected'|'rejected',note:f.interpretationReview?.note??''}}))}><option value="unreviewed">未确认</option><option value="accepted">接受为待几何验证的解释</option><option value="corrected">已纠正（填写说明）</option><option value="rejected">拒绝此解释</option></select></label><label>空间解释修正说明<textarea aria-label="3D 空间解释修正说明" disabled={busy} value={form.interpretationReview?.note??''} onChange={e=>setForm(f=>({...f,interpretationReview:{status:f.interpretationReview?.status??'corrected',note:e.target.value}}))}/></label>
    </details>
    <details className="review-geometry-settings"><summary>审核设置</summary><label>Profile 单位厚度<input aria-label="3D Review 厚度" type="number" min="0.001" step="0.01" value={thickness} onChange={e => setThickness(+e.target.value)}/></label></details>
    <details className="review-connection-form" open={connectionOpen} onToggle={e=>setConnectionOpen(e.currentTarget.open)}><summary>确认连接边 / 二面角（可 Unknown）</summary>{['A', 'B'].map((side, i) => <div key={side}><label>实例 {side}<select aria-label={`3D 连接实例 ${side}`} value={i ? edgeB : edgeA} onChange={e => { if (i) {
            setEdgeB(e.target.value);
            setPortB('');setEdgeRefs([]);setEdgeRange(null);
        }
        else {
            setEdgeA(e.target.value);
            setPortA('');setEdgeRefs([]);setEdgeRange(null);
        } }}><option value="">选择已确认实例</option>{form.pieces.filter(p => p.confirmed && !p.excluded).map(p => <option key={p.id}>{p.id}</option>)}</select></label><label>Port {side}<select aria-label={`3D 连接 Port ${side}`} value={i ? portB : portA} onChange={e => i ? setPortB(e.target.value) : setPortA(e.target.value)}><option value="">Unknown</option>{ports(i ? edgeB : edgeA).map(p => <option key={p.portId} value={p.portId}>{p.portId} · {p.length.toFixed(3)}</option>)}</select></label></div>)}<label>二面角候选（逗号分隔；空白 Unknown）<input aria-label="3D Review 二面角候选" value={angles} onChange={e => setAngles(e.target.value)}/></label><label>角度区间下限（空白 Unknown）<input aria-label="3D Review 角度下限" type="number" min="-180" max="180" value={edgeRange?.min??''} onChange={e=>setEdgeRange(e.target.value===''?null:{min:+e.target.value,max:edgeRange?.max??+e.target.value})}/></label><label>角度区间上限<input aria-label="3D Review 角度上限" type="number" min="-180" max="180" value={edgeRange?.max??''} onChange={e=>setEdgeRange(e.target.value===''?null:{min:edgeRange?.min??+e.target.value,max:+e.target.value})}/></label><label>flip<select value={flip} onChange={e => setFlip(e.target.value)}><option value="unknown">Unknown</option><option value="false">false</option><option value="true">true</option></select></label><label>连接证据说明<input value={edgeNote} onChange={e => setEdgeNote(e.target.value)}/></label><button disabled={!edgeA || !edgeB || edgeA === edgeB || busy} onClick={() => { const c: ConnectionHypothesis3D = { pieceA: edgeA, pieceB: edgeB, portA: portA || null, portB: portB || null, intent: 'connect', angles: angles.trim() ? angles.split(',').map(Number) : [], angleRange: edgeRange, flip: flip === 'unknown' ? null : flip === 'true', evidenceRefs: edgeRefs.length?edgeRefs:[edgeA, edgeB], evidence: edgeNote, uncertainty: '人工输入；照片匹配仍需审核' }; setForm(f => ({ ...f, constraints: [...f.constraints.filter(c => [c.pieceA, c.pieceB].sort().join('|') !== [edgeA, edgeB].sort().join('|')), c] })); }}>加入 / 替换人工连接约束</button><fieldset><legend>相对空间检查（独立于模型连接角度）</legend><label>关系<select aria-label="已审核空间关系" value={spaceRelation} onChange={e=>setSpaceRelation(e.target.value as ReviewedSpatialCheck3D['relation'])}><option value="plane-angle">无向面夹角</option><option value="shared-edge">必须建立共享边连接</option><option value="occludes">原图遮挡（继续 Unverified）</option><option value="above-in-image">图片上下（继续 Unverified）</option></select></label>{spaceRelation==='plane-angle'&&<><p>平行为 0°，垂直为 90°；不依赖世界轴、法向正负或屏幕斜率。</p><label>面夹角下限<input aria-label="已审核面夹角下限" type="number" min="0" max="90" value={spaceMin} onChange={e=>setSpaceMin(+e.target.value)}/></label><label>面夹角上限<input aria-label="已审核面夹角上限" type="number" min="0" max="90" value={spaceMax} onChange={e=>setSpaceMax(+e.target.value)}/></label></>}<button disabled={busy||!edgeA||!edgeB||edgeA===edgeB} onClick={()=>setForm(f=>({...f,spatialChecks:[...(f.spatialChecks??[]).filter(c=>!(c.relation===spaceRelation&&[c.pieceA,c.pieceB].sort().join('|')===[edgeA,edgeB].sort().join('|'))),{id:'space-'+crypto.randomUUID(),pieceA:edgeA,pieceB:edgeB,relation:spaceRelation,minDeg:spaceRelation==='plane-angle'?spaceMin:null,maxDeg:spaceRelation==='plane-angle'?spaceMax:null,evidenceRefs:edgeRefs.length?edgeRefs:[edgeA,edgeB],note:edgeNote||'人工逐项确认相对关系'}]}))}>加入已审核空间检查</button>{form.spatialChecks?.map(c=><p key={c.id}>{c.pieceA} ↔ {c.pieceB} · {c.relation} {c.minDeg!==null?`${c.minDeg}..${c.maxDeg}°`:''}<button onClick={()=>setForm(f=>({...f,spatialChecks:f.spatialChecks?.filter(x=>x.id!==c.id)}))}>移除空间检查</button></p>)}</fieldset>{form.constraints.map((c, i) => <p key={i}>{c.pieceA}/{c.portA ?? '?'} ↔ {c.pieceB}/{c.portB ?? '?'} · {c.angles.join(',') || 'Unknown'}° <button onClick={() => setForm(f => ({ ...f, constraints: f.constraints.filter((_, j) => j !== i) }))}>移除约束</button></p>)}</details>
   </>}
   {stage==='reconstruction'&&<>
    <section className="intake-controls visible3d-control-section" aria-label="Spatial Planning 操作"><h3>1 · Spatial Planning</h3>
     <p className="context-notice">Review {review?.id.slice(0,8)??'未保存'} · Plan {plan?.id.slice(0,8)??'未生成'}</p>
     <ExecutionStatus value={planStatus} testId="visible3d-planning-state"/>
     {dirty&&<p role="alert">Review 有未保存修改，请先保存后再 Planning / Execution。</p>}
     {review&&head.reviewId!==review.id&&<p role="alert">Outdated：当前 Review 已过期。</p>}
     {planOutdated&&<p role="alert">Outdated：当前 Plan 的来源或 Review 已变化，请重新核对。</p>}
     {requestError&&<p role="alert">{requestError}；失败请求状态暂无法确认，可打开已保存 Plan 的 Trace。</p>}
   <label>3D Spatial Planning 模型<select aria-label="3D Spatial Planning 模型" disabled={busy} value={planningModel} onChange={e => setPlanningModel(e.target.value)}><option value="">选择模型</option>{config?.planningModels.map(m => <option key={m.id} value={m.id} disabled={!config.providers[m.provider]}>{m.label}</option>)}</select></label>
   {participation&&<div data-testid="visible3d-planning-participation" role={reviewParticipation?.blocker?'alert':'status'}>{reviewParticipation?.blocker??(!participation.confirmed?'当前范围没有可重建的交集。':`已保存 Review：${participation.confirmed}/${participation.total} 个实例已确认并参与 Planning，其中 ${participation.knownProfiles} 个具有 Exact Profile。未确认或已排除实例不参与重建。`)}</div>}
   <button disabled={busy || !review || dirty || head.reviewId !== review.id || !planningModel || !reconstruction?.scope.observationIds.length || !!participation?.blocker} onClick={() => void run(() => modelAction('plan'),'plan')}>Spatial Planning（调用模型）</button>
   <details><summary>沿用已有空间假设（不调用模型）</summary><p>修正 Review 后可明确创建新计划；原 Analysis、Plan、Trace 与旧候选保留。</p><label>来源计划<select aria-label="沿用来源计划" value={rebaseId} disabled={busy} onChange={e=>setRebaseId(e.target.value)}><option value="">明确选择已有计划</option>{history.plans.filter(p=>p.sourceId===source?.id).map(p=><option key={p.id} value={p.id}>{p.id.slice(0,8)} · Review {p.reviewId.slice(0,8)} · {p.origin}</option>)}</select></label><button disabled={busy||!rebaseId||!review||dirty||head.reviewId!==review.id} onClick={()=>void run(async()=>{const p=await api<Plan>('rebase-plan',{reviewId:review!.id,planId:rebaseId,reconstructionScope:reconstruction?.scope});setRefinement(null);setPlan(p);setExecution(null);setManual(JSON.stringify(p.plan,null,2));await refresh();setNotice('已按当前 Review 创建人工计划；请明确执行 Geometry Execution，不会自动替换 Draft。')})}>按当前 Review 创建人工计划</button></details>
   <details><summary>人工 Spatial Hypothesis / 修改后保存新版本</summary><button disabled={!review || dirty} onClick={() => setManual(JSON.stringify(plan && plan.reviewId === review?.id ? plan.plan : seedPlan(), null, 2))}>准备人工假设模板</button><textarea spellCheck={false} aria-label="3D Spatial Hypothesis JSON" value={manual} onChange={e => setManual(e.target.value)}/><button disabled={busy || !review || dirty || head.reviewId !== review.id||!reconstruction?.scope.observationIds.length} onClick={() => void run(async () => { const p = await api<Plan>('manual-plan', { reviewId: review!.id, reconstructionScope:reconstruction?.scope, plan: JSON.parse(manual) }); setRefinement(null);setPlan(p); setExecution(null); await refresh(); })}>保存人工 Spatial Hypothesis</button></details>

     {plan&&<p>当前 Plan · {plan.origin??'已保存'} · {plan.plan.parts.length} 个实例 · {plan.plan.connections.length} 条主连接 · {plan.plan.alternatives.length} 个其他解释</p>}
     {!!plan?.diagnostics?.length&&<div role="status"><b>当前人工计划适配 Diagnostic</b>{plan.diagnostics.map((d,i)=><p key={i}>{d}</p>)}</div>}
   {plan&&<section aria-label="Planning 连接候选审核"><details aria-label="Planning 推断详情"><summary>Planning 空间理解与连接解释（模型推断）</summary><SpatialUnderstandingPanel label="Planning 空间解释" value={plan.plan.spatialInterpretation}/><details aria-label="3D Planning 连接审核"><summary>模型 Connection / Port / Dihedral / Flip 候选</summary><p>可回到 Review 核对或修改单条连接；这里选择完整解释，保留原计划。</p>{[{label:'主解释',connections:plan.plan.connections},...plan.plan.alternatives].map((v,i)=><article key={i}><b>{v.label}</b>{v.connections.map((c,j)=><p key={j}>{c.pieceA}/{c.portA??'Unknown'} ↔ {c.pieceB}/{c.portB??'Unknown'}<br/>角度 {c.angles.join(', ')||'Unknown'}° · flip {c.flip===null?'Unknown':String(c.flip)}<br/>{c.evidence}<br/><small>{c.uncertainty}</small></p>)}<button disabled={busy||dirty||head.reviewId!==review?.id||plan.reviewId!==review?.id} onClick={()=>void run(()=>usePlanVariant(v.connections))}>选择解释 {i+1} 并保存人工计划</button></article>)}</details></details></section>}

    </section>
    <ConstraintRefinementPanel key={plan?.id??'no-plan'} records={refinementRecords} selection={refinement} executions={history.executions} busy={busy} blocked={!plan||planOutdated} onGenerate={async()=>{let id='';await run(async()=>{const r=await api<RefinementRecord>('refine-constraints',{planId:plan!.id,planHash:plan!.hash});id=r.id;await refresh();setNotice('修正候选已保存；尚未采用，执行输入保持不变。')});return id}} onSelect={r=>{setRefinement(r);setExecution(null);setCandidateId('');setChecked(false);setAttempt(null);setError('');setNotice(r?'已选择修正方案；请明确执行 Geometry Execution。原 Plan 未改变。':'已切回原始 Plan；请明确执行 Geometry Execution。')}}/>
    <section className="intake-controls visible3d-control-section" aria-label="Geometry Execution 操作"><h3>2 · Geometry Execution</h3><p data-testid="visible3d-execution-input">执行输入：{refinement?`Refinement ${refinement.candidateId} · ${refinement.id.slice(0,8)}`:`原始 Plan ${plan?.id.slice(0,8)??'未选择'}`}</p>{refinementMismatch&&<p role="alert">Refinement 来源或快照不匹配，请重新选择当前 Plan 的方案；未回退到原始输入。</p>}
     <ExecutionStatus value={executeStatus} testId="visible3d-execution-state"/>
   <div className="visible3d-budget"><label>连接组合预算<input aria-label="3D 连接组合预算" type="number" min="0" max="2048" value={maxAssignments} onChange={e => setMaxAssignments(+e.target.value)}/></label><label>几何检查预算<input aria-label="3D 几何检查预算" type="number" min="0" max="4096" value={maxGeometryChecks} onChange={e => setMaxGeometryChecks(+e.target.value)}/></label><label>局部子图预算<input aria-label="3D 局部子图预算" type="number" min="0" max="8192" value={maxLocalSubsets} onChange={e=>setMaxLocalSubsets(+e.target.value)}/></label><button disabled={busy || !plan || refinementMismatch || plan.reviewId !== review?.id || dirty || head.reviewId !== review?.id} onClick={() => void run(async () => { const r = await api<{
        id:string;
        state: string;
        error?: string;
        record: Execution;
    }>('execute', { planId: plan!.id,reconstructionScope:reconstruction?.scope,...(refinement?{refinement}:{}), requestId: crypto.randomUUID(), options: { maxAssignments, maxGeometryChecks,maxLocalSubsets } });setAttempt({id:r.id,kind:'execute',scope:JSON.stringify([executionScope(plan),refinement])});await refreshRequests(); if (r.state !== 'complete')
        throw Error(r.error); setExecution(r.record); setCandidateId(defaultExecutionPreview(r.record)); setChecked(false); await refresh(); },'execute')}>Geometry Execution（不调用模型）</button></div>

     {execution&&<><p role="status" data-testid="visible3d-execution-status">{execution.status} · {execution.candidates.length} 合法 Candidates · {execution.diagnosticCandidates?.length??0} Diagnostic · {execution.search.assignments}/{execution.search.maxAssignments} 组合 · {execution.search.geometryChecks}/{execution.search.maxGeometryChecks} 检查</p>
      {outdated&&<p role="alert">Outdated：来源、Review 或 Plan 已变化，禁止采用旧候选。</p>}
      {execution.status!=='candidates_found'&&execution.diagnostics.length>0&&<ul className="visible3d-failure-diagnostics" aria-label="执行失败原因">{execution.diagnostics.map((d,i)=><li key={i}>{d}</li>)}</ul>}
      {execution.search.progressive&&<><p role="status" data-testid="progressive-search-status">Progressive Partial · {execution.search.progressive.termination} · 搜索{execution.completeSearch?'已结束':'未完成'}，已验证部分结果可审核采用。最大连通 {execution.search.progressive.maxConnected}/{candidate?.coverage.totalConfirmed??form.pieces.filter(p=>p.confirmed&&!p.excluded).length}；独立组件覆盖 {execution.search.progressive.independentComponentCoverage.length}（相对位置未知，未合并）；Photo Match Unverified。</p><details><summary>渐进搜索预算、组件与失败诊断</summary><pre>{JSON.stringify(execution.search.progressive,null,2)}</pre><p>并集可能来自不同候选和姿态，不是同一完整 Assembly；单片验证不计入连通覆盖。所有未覆盖 Observation 均保留来源。</p></details></>}
      {execution.search.localSearch&&<details><summary>局部搜索预算与终止情况</summary><pre>{JSON.stringify(execution.search.localSearch,null,2)}</pre><p>completeSearch 仅表示预算内离散组合及已选父组件的子图枚举完成，不表示穷尽连续角度或重建完整。</p></details>}
      <details><summary>执行 Diagnostic · {execution.diagnostics.length} 条</summary><pre>{JSON.stringify(execution.diagnostics,null,2)}</pre></details>
     </>}
    </section>
    <section className="intake-controls visible3d-control-section" aria-label="Candidate Selection"><h3>3 · Candidate Selection</h3>
     <label className="compact-field">候选<select aria-label="3D Reconstruction Candidate" disabled={busy||!previews.length} value={candidateId} onChange={e=>{setCandidateId(e.target.value);setViewRequest(n=>n+1);setChecked(false)}}><option value="">选择候选</option>{previews.map(c=><option key={c.id} value={c.id} title={c.interpretation}>{c.id} · {c.coverage.reconstructed.length}/{c.coverage.totalConfirmed} 可见实例 · {c.kind==='diagnostic'?'Diagnostic / Geometry Invalid':'Geometry Valid'} · {c.interpretation} · Spatial {c.spatialConsistency?.status??'unverified'}</option>)}</select></label>
     {candidate&&<p className="visible3d-candidate-interpretation">{candidate.interpretation}</p>}
     {!!diagnosticErrors.length&&candidate&&<div className="visible3d-error-review" aria-label="Diagnostic Validation Errors">
      <h4>Validation Errors · {diagnosticErrors.length}</h4>
      <table className="magnetic-3d-collision-table visible3d-error-table"><thead><tr><th>错误</th><th>零件 / Port</th><th>数值</th></tr></thead><tbody>{diagnosticErrors.map((issue,index)=>{const refs=geometryIssueReferences(candidate.assembly,issue),isSelected=selectedIssue===issue;return <tr key={index} aria-selected={isSelected} data-diagnostic-error={index} title={issue.message} onClick={()=>selectDiagnosticError(index)}><td><button aria-label={`定位错误 ${index+1} ${issue.code??'other'}`} aria-pressed={isSelected} onClick={e=>{e.stopPropagation();selectDiagnosticError(index)}}>{issue.code??'other'}</button></td><td>{refs.pieceIds.join(' / ')||'位置未知'}{issue.portId&&<small>{issue.portId}</small>}{issue.connectionIndex!==undefined&&<small>Connection #{issue.connectionIndex}</small>}</td><td>{issue.penetrationDepth!==undefined?Number(issue.penetrationDepth.toPrecision(5)):'—'}</td></tr>})}</tbody></table>
      {selectedIssue&&<div data-testid="selected-diagnostic-error"><p role="status">{selectedIssue.message}</p><p className="hint">{issueVisual?.note}</p><div className="button-row"><button disabled={!issueVisual?.focusVertices.length&&!issueVisual?.collision?.center} onClick={()=>issueSelection&&setIssueSelection({...issueSelection,sequence:issueSelection.sequence+1})}>聚焦错误</button><button onClick={()=>setIssueSelection(null)}>取消错误选择</button></div></div>}
     </div>}

    </section>
   </>}
   {stage==='reconstruction'&&candidate&&<section className="intake-controls visible3d-control-section" aria-label="Candidate Review 与 Assembly"><h3>4 · Candidate Review / Assembly</h3>
    <p data-testid="candidate-validation" data-candidate-kind={diagnostic?'diagnostic':'candidate'}><b>{candidate.id} · {diagnostic?'Diagnostic / Geometry Invalid':'Geometry Valid'}</b><br/>Ideal Geometry {validation?.idealGeometry.valid?'Valid':'Invalid'} · Solid Collision {validation?.solidCollision.valid?'Valid':'Invalid'}<br/>Evidence Coverage {candidate.coverage.reconstructed.length}/{candidate.coverage.totalConfirmed}</p>
    {diagnostic&&<p role="alert">Diagnostic Candidate：严格几何验证未通过，不能通过普通 Adopt 进入 Assembly。符合条件时可明确授权进入待修复 Draft；Error / Blocker 不变。</p>}
    {candidate.coverage.reconstructed.length<candidate.coverage.totalConfirmed&&<p role="alert">局部重建：未覆盖 {candidate.coverage.totalConfirmed-candidate.coverage.reconstructed.length} 个已确认实例；不能代表完整作品。</p>}
    <p>Photo Match 未验证 · Human Review {checked?'待提交':'Pending'}</p>
    <p data-testid="visible3d-spatial-status">Spatial Interpretation Consistency · {spatial?.status??'unverified'}（仅已审核相对关系）</p>
    {spatial?.status==='contradicted'&&<p role="alert">候选违反已审核空间关系，禁止采用。请回到 Review 修正。</p>}
    <p className="hint">未解决 {candidate.coverage.unresolved.length} 片 · 排除 {candidate.coverage.excluded.length} 片 · {candidate.unverifiedConstraints.length} 项未验证约束；Geometry Valid 不代表照片匹配或物理稳定。</p>
    <details><summary>覆盖与未验证约束 · {candidate.id}</summary><p>已重建：{candidate.coverage.reconstructed.join(', ')}</p><p>未解决：{candidate.coverage.unresolved.join(', ')||'无'}</p><p>排除：{candidate.coverage.excluded.join(', ')||'无'}</p><ul>{candidate.unverifiedConstraints.map((n,i)=><li key={i}>{n}</li>)}</ul></details>
<details><summary>已审核空间检查</summary><ul>{spatial?.checks.map(c=><li key={c.id} data-spatial-check={c.id}>{c.pieces.join(' ↔ ')} · {c.status} · {c.message}</li>)}</ul>{spatial?.unverified.map((m,i)=><p key={i} className="hint">{m}</p>)}</details><details><summary>Geometry Validator Diagnostic · {candidate.id}</summary><pre>{JSON.stringify(candidate.geometry,null,2)}</pre></details>
    <details><summary>碰撞空间证据与原连接约束 · {candidate.id}</summary><pre>{JSON.stringify({validation,collisions:candidate.collisions??[],construction:candidate.construction??null},null,2)}</pre><p>接点距离和局部交叠分类仅为诊断证据，不豁免碰撞；穿透深度是 SAT 最小轴重叠，不是现实接点模型。</p></details>
    {selected&&<section aria-label="对应零件 Inspector">
     <h4>Observation {selected} → Piece {selectedPieceId??'未重建'}</h4>
     <p>{executionInput?observationState(selected,executionInput,mapping):'unresolved'}</p>
     <details><summary>零件证据 / Pose / Profile / 法向详情</summary><p>{selectedEvidence?.evidence}</p>{selectedPieceId&&<pre>{JSON.stringify({piece:candidate.assembly.pieces.find(p=>p.id===selectedPieceId),worldNormal:selectedGeometry?.normal.toArray()},null,2)}</pre>}</details>
     <button onClick={()=>navigate('review')}>回到 Review 修正选中零件</button>
    </section>}
    {diagnostic&&<p className="hint">人工采用只接受当前可核对的几何错误，不改变 Geometry Invalid、Photo Match 或物理稳定性结论；新增或变化的错误仍会阻断。</p>}
    {diagnostic&&!diagnosticEligible&&<p role="alert">此 Diagnostic 包含无法可靠定位或比较的错误，不能人工采用。</p>}
    {!diagnostic&&<label className="intake-check"><input type="checkbox" aria-label="已对照照片审核候选" checked={checked} onChange={e => setChecked(e.target.checked)}/>已对照原图，接受局部结果和未验证项</label>}
    <button disabled={busy || outdated || (diagnostic?!diagnosticEligible:!checked) || spatial?.status==='contradicted'} onClick={() => void run(async () => {
      if(diagnostic&&!diagnosticEligible)throw Error('Diagnostic 的错误无法安全追踪，不能人工采用');
      if((!diagnostic||localStorage.getItem(DRAFT_3D_KEY)!==null)&&!confirm(diagnostic?'替换当前保存的 3D Draft？当前 Diagnostic 将以 Human Accepted Diagnostic 加载，几何仍为 Invalid。':'采用此候选并替换当前保存的 3D Draft？2D 工作与教程存档不变。'))return;
      let cameraView;try{cameraView=loadCandidateCamera(localStorage,{executionId:execution!.id,executionHash:execution!.hash,candidateId:candidate.id})??undefined}catch{/* Camera metadata is independent of geometry. */}
      const origin=await api<Record<string,unknown>&{assembly:Assembly3D;id:string}>(diagnostic?'open-diagnostic-draft':'adopt',{executionId:execution!.id,executionHash:execution!.hash,candidateId:candidate.id,...(diagnostic?{humanAccepted:true}:{visualChecked:true})});
      if(diagnostic)await acceptHumanDiagnostic(origin.assembly,origin.id);
      await refresh();await adopt3D(origin.assembly,origin,cameraView);
    })}>{diagnostic?'人工采用并进入 Assembly':'采用候选到 3D Assembly Editor'}</button>
   </section>}
   {(analysis || plan || execution) && <details><summary>来源、Trace 与导出</summary><pre>{JSON.stringify({ sourceId: source?.id, sourceHash: source?.hash, analysisId: analysis?.id, reviewId: review?.id, planId: plan?.id, executionId: execution?.id,candidateId,model,refinement,analysisTraceRequestId:analysisTraceSelection }, null, 2)}</pre>{[analysis, plan].filter(Boolean).map(r => r!.traceId ? <button key={r!.id} onClick={() => stage!=='review'?openReconstructionTrace(r===analysis?'parts':'spatial'):void run(async () => setTrace(await api('trace/' + r!.traceId)))}>查看 {r!.id.slice(0, 8)} 原始 Trace</button> : <p key={r!.id}>{r!.origin} · 无模型调用 Trace</p>)}<button onClick={() => download('visible3d-evidence.json', analysis?.evidence)}>导出 Visible Evidence</button>{plan && <button onClick={() => download('visible3d-hypothesis.json', plan.plan)}>导出 Spatial Hypothesis</button>}<button onClick={() => download('visible3d-provenance.json', { source, analysis, review, plan, refinement:refinementRecord, execution, origins: history.origins?.filter(o => o.sourceId === source?.id) })}>导出完整来源记录</button></details>}
   {trace !== null && stage==='review' && <details open><summary>实际保存的模型 Trace</summary><pre>{JSON.stringify(trace, null, 2)}</pre><button onClick={() => setTrace(null)}>关闭 Trace</button></details>}
  </section></StudioSlot>
 </>;
}
