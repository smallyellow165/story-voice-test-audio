import {SpatialUnderstandingPanel,familyLabels} from './SpatialUnderstandingPanel.tsx';
import {shapeFamilies} from './spatial-understanding.ts';
import type {ShapeFamily3D,VisualConnection3D} from './spatial-understanding.ts';
import {profileSizeLabel} from '../../profiles.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StudioSlot, useStudio, imageStages } from '../../StudioLayout.tsx';
import { useProfileRegistry } from '../../ProfileRegistry.tsx';
import { ReviewWorkspace } from '../../intake/ReviewWorkspace.tsx';
import { intakeApi, prepareImage } from '../../intake/api.ts';
import type { Source, Evidence } from '../../intake/contracts.ts';
import { MagnetScene3D } from '../vendor/components/MagnetScene3D.tsx';
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
    reviewId: string;
    plan: SpatialHypothesis3D;
};
type Execution = Base & VisibleExecution3D & {
    reviewId: string;
    planId: string;
};
type History = {
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
export default function Visible3DWorkflow() {
    const { stage, intakeMode, navigate, adopt3D } = useStudio(), { registry } = useProfileRegistry();
    const active = intakeMode === 'visible3d';
    const [config, setConfig] = useState<Config | null>(null), [history, setHistory] = useState<History>({ analyses: [], reviews: [], plans: [], executions: [] });
    const [sources, setSourceOptions] = useState<Source[]>([]);
    const [source, setSource] = useState<Source | null>(null), [image, setImage] = useState(''), [analysis, setAnalysis] = useState<Analysis | null>(null), [review, setReview] = useState<Review | null>(null), [plan, setPlan] = useState<Plan | null>(null), [execution, setExecution] = useState<Execution | null>(null);
    const [form, setForm] = useState<VisibleReview3D>(emptyReview), [thickness, setThickness] = useState(.06), [head, setHead] = useState({ revision: 0, reviewId: null as string | null }), [selected, setSelected] = useState(''), [candidateId, setCandidateId] = useState(''), [pickedPiece, setPickedPiece] = useState<string | null>(null), [checked, setChecked] = useState(false);
    const [model, setModel] = useState(''), [planningModel, setPlanningModel] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [annotation, setAnnotation] = useState(JSON.stringify(emptyEvidence, null, 2)), [manual, setManual] = useState(''), [trace, setTrace] = useState<unknown>(null);
    const [maxAssignments, setMaxAssignments] = useState(128), [maxGeometryChecks, setMaxGeometryChecks] = useState(256);
    const [edgeA, setEdgeA] = useState(''), [edgeB, setEdgeB] = useState(''), [portA, setPortA] = useState(''), [portB, setPortB] = useState(''), [angles, setAngles] = useState(''), [flip, setFlip] = useState('unknown'), [edgeNote, setEdgeNote] = useState('');
    const [connectionOpen,setConnectionOpen]=useState(false),[edgeRefs,setEdgeRefs]=useState<string[]>([]),[edgeRange,setEdgeRange]=useState<{min:number;max:number}|null>(null);
    const booted = useRef(false);
    const dirty = !!review && (JSON.stringify(form) !== JSON.stringify(review.input.review) || review.input.profiles.some(s => s.thickness !== thickness));
    const outdated = !!execution && (execution.sourceId !== source?.id || execution.reviewId !== review?.id || head.reviewId !== review?.id || dirty || execution.planId !== plan?.id);
    const candidate = execution?.candidates.find(c => c.id === candidateId) ?? null;
    const selectedReview = form.pieces.find(p => p.id === selected), selectedEvidence = analysis?.evidence.observations.find(o => o.id === selected);
    async function refresh() { const h = await api<History>('history'); setHistory(h); return h; }
    async function loadSource(s: Source) { const [img, h] = await Promise.all([intakeApi<{
            mimeType: string;
            imageBase64: string;
        }>('image/' + s.id), api<typeof head>('head/' + s.id)]); setSource(s); setImage('data:' + img.mimeType + ';base64,' + img.imageBase64); setHead(h); setChecked(false); }
    function selectAnalysis(a: Analysis) { setAnalysis(a); setReview(null); setPlan(null); setExecution(null); setCandidateId(''); setChecked(false); setForm({ pieces: a.evidence.observations.map(o => ({ id: o.id, confirmed: false, excluded: false, profileId: null, profileVersion: null, color: o.color })), constraints: [] }); setSelected(a.evidence.observations[0]?.id ?? ''); setAnnotation(JSON.stringify(a.evidence, null, 2)); }
    function selectReview(r: Review) { setReview(r); setForm(structuredClone(r.input.review)); setThickness(r.input.profiles[0]?.thickness ?? .06); setChecked(false); }
    async function run(work: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try {
        await work();
    }
    catch (e) {
        setError(String(e));
    }
    finally {
        setBusy(false);
    } }
    useEffect(() => {
        void run(async () => {
            const [c, h] = await Promise.all([api<Config>('status'), refresh()]);
            setConfig(c);
            setModel(c.models.find(m => c.providers[m.provider])?.id ?? '');
            setPlanningModel(c.planningModels.find(m => c.providers[m.provider])?.id ?? '');
            const saved = JSON.parse(localStorage.getItem(key) || 'null');
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
                            setPlan(p);
                            setManual(JSON.stringify(p.plan, null, 2));
                            const x = h.executions.find(x => x.id === saved.executionId && x.planId === p.id);
                            if (x) {
                                setExecution(x);
                                setCandidateId(x.candidates[0]?.id ?? '');
                            }
                        }
                    }
                }
            }
            booted.current = true;
        });
    }, []);
    useEffect(() => { if (booted.current)
        try {
            localStorage.setItem(key, JSON.stringify({ sourceId: source?.id, analysisId: analysis?.id, reviewId: review?.id, planId: plan?.id, executionId: execution?.id }));
        }
        catch (e) {
            setError('Visible 3D 恢复索引保存失败：' + String(e));
        } }, [source, analysis, review, plan, execution, busy]);
    useEffect(() => { if (!active || !source)
        return; const update = () => void api<typeof head>('head/' + source.id).then(setHead).catch(e => setError(String(e))); update(); window.addEventListener('focus', update); return () => window.removeEventListener('focus', update); }, [active, stage, source]);
    const projectedReview = useMemo<Evidence | undefined>(() => analysis ? { sourceKind: 'unsupported', reason: '只供共享 Review 表展示；不是 2D Reconstruction 输入', relations: form.constraints.map(c => ({ from: c.pieceA, to: c.pieceB, intent: c.intent, evidence: c.evidence })), observations: analysis.evidence.observations.map(o => { const p = form.pieces.find(p => p.id === o.id), b = o.bbox; return { id: o.id, profileId: p?.profileId ?? 'unknown', profileVersion: p?.profileVersion ?? 1, color: p?.color ?? o.color, outline: b ? [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]] : [], confidence: 0, evidence: o.evidence, uncertainty: o.uncertainty, origin: 'observed', excluded: !!p?.excluded }; }) } : undefined, [analysis, form]);
    function editPiece(update: Partial<VisibleReview3D['pieces'][number]>) { setForm(f => ({ ...f, pieces: f.pieces.map(p => p.id === selected ? { ...p, ...update } : p) })); setChecked(false); }
    const ports = (id: string) => { const p = form.pieces.find(p => p.id === id), profile = registry.profiles.find(s => s.id === p?.profileId && s.version === p?.profileVersion); return profile ? adaptProfile({ profile, thickness }).shape.ports : []; };
    function chooseVisualConnection(c:VisualConnection3D){
      if(!form.pieces.some(p=>p.id===c.pieceA&&p.confirmed&&!p.excluded)||!form.pieces.some(p=>p.id===c.pieceB&&p.confirmed&&!p.excluded)){setError('请先确认建议所涉及的两个可见实例。');return}
      setEdgeA(c.pieceA);setEdgeB(c.pieceB);setPortA('');setPortB('');setAngles(c.foldAngleCandidatesDeg.join(','));setFlip('unknown');setEdgeNote(c.reasoning+' · '+c.uncertainty);setEdgeRefs(c.evidenceRefs);setEdgeRange(c.angleRange);setConnectionOpen(true);setNotice('建议已填入人工连接表单；请核对端口与角度符号后再加入约束。未自动建立连接。')
    }
    async function usePlanVariant(connections:ConnectionHypothesis3D[]){
      if(!plan||!review)return
      const p=await api<Plan>('manual-plan',{reviewId:review.id,basedOnPlanId:plan.id,plan:{...plan.plan,connections,alternatives:[]}})
      setPlan(p);setExecution(null);setManual(JSON.stringify(p.plan,null,2));await refresh();setNotice('已创建独立的人工选择计划；原模型计划与 Trace 保留，尚未执行几何。')
    }
    const seedPlan = (): SpatialHypothesis3D => ({ version: 1, parts: form.pieces.filter(p => p.confirmed && !p.excluded).map(p => ({ id: p.id, profileId: p.profileId, profileVersion: p.profileVersion, orientationEvidence: '人工待审核；世界朝向未知' })), connections: structuredClone(form.constraints), alternatives: [], relations: [], unknowns: ['相机与世界朝向尚未标定'] });
    async function modelAction(kind: 'analyze' | 'plan') {
        const r = await api<{
            state: string;
            error?: string;
            record?: Analysis | Plan;
            trace?: {
                id: string;
            };
        }>(kind, { sourceId: source?.id, reviewId: review?.id, model: kind === 'analyze' ? model : planningModel, requestId: crypto.randomUUID() });
        if (r.trace)
            setTrace(await api('trace/' + r.trace.id));
        if (r.state !== 'complete' || !r.record)
            throw Error(r.error ?? '模型未返回可用契约；请查看 Trace，不自动重试');
        if (kind === 'analyze') {
            selectAnalysis(r.record as Analysis);
            navigate('review');
        }
        else {
            setPlan(r.record as Plan);
            setExecution(null);
            setManual(JSON.stringify((r.record as Plan).plan, null, 2));
        }
        await refresh();
    }
    const imageView = <div className="visible3d-image">{image ? <svg preserveAspectRatio="none" style={{ aspectRatio: `${source?.view.width ?? 1}/${source?.view.height ?? 1}` }} viewBox="0 0 1000 1000" role="img" aria-label="Visible 3D 原图与观察证据"><image href={image} width="1000" height="1000" preserveAspectRatio="none"/>{analysis?.evidence.observations.map(o => <g key={o.id} onClick={() => setSelected(o.id)} opacity={form.pieces.find(p => p.id === o.id)?.excluded ? .3 : 1}>{o.bbox && <rect x={o.bbox[0] * 1000} y={o.bbox[1] * 1000} width={(o.bbox[2] - o.bbox[0]) * 1000} height={(o.bbox[3] - o.bbox[1]) * 1000} fill="transparent" stroke={selected === o.id ? '#e43c38' : '#248780'} strokeWidth="4"/>}{o.features.filter(f => f.points.length === 1).map(f => <circle key={f.id} cx={f.points[0][0] * 1000} cy={f.points[0][1] * 1000} r="7" fill={f.visibility === 'visible' ? '#ec5c1e' : 'none'} stroke="#ec5c1e" strokeWidth="3"/>)}{o.features.filter(f => f.points.length === 2).map(f => <polyline key={f.id} points={f.points.map(p => p.map(n => n * 1000).join(',')).join(' ')} stroke="#ec5c1e" strokeWidth="8" strokeDasharray={f.visibility === 'estimated' ? '10 8' : undefined} fill="none"/>)}<text x={(o.bbox?.[0] ?? 0) * 1000} y={(o.bbox?.[1] ?? 0) * 1000 + 25} fill="#a01818" fontSize="25">{o.id}</text></g>)}</svg> : <p>请先上传照片。只处理可见证据，不补全隐藏结构。</p>}</div>;
    return <>
  <StudioSlot column="workflow" stages={imageStages} intake="visible3d"><p>Visible 3D · {source?.name ?? '未选照片'}</p><button disabled={busy} onClick={() => void run(async () => { await refresh(); if (source)
        setHead(await api('head/' + source.id)); })}>刷新 3D 历史</button>
   {source && <><label>3D Analysis 历史<select aria-label="3D Analysis 历史" value={analysis?.id ?? ''} disabled={busy} onChange={e => { const a = history.analyses.find(a => a.id === e.target.value); if (a)
            selectAnalysis(a); }}><option value="">选择 Analysis</option>{history.analyses.filter(a => a.sourceId === source.id).map(a => <option key={a.id} value={a.id}>{a.origin} · {a.createdAt}</option>)}</select></label>
   <label>3D Review 历史<select aria-label="3D Review 历史" value={review?.id ?? ''} disabled={busy} onChange={e => { const r = history.reviews.find(r => r.id === e.target.value); if (r) {
            selectReview(r);
            setPlan(null);
            setExecution(null);
        } }}><option value="">选择 Review</option>{history.reviews.filter(r => r.analysisId === analysis?.id).map(r => <option key={r.id} value={r.id}>{r.id.slice(0, 8)}{head.reviewId === r.id ? ' · Current' : ' · Outdated'}</option>)}</select></label>
   <label>3D Plan 历史<select aria-label="3D Plan 历史" value={plan?.id ?? ''} disabled={busy} onChange={e => { const p = history.plans.find(p => p.id === e.target.value); if (p) {
            setPlan(p);
            setExecution(null);
        } }}><option value="">选择 Plan</option>{history.plans.filter(p => p.reviewId === review?.id).map(p => <option key={p.id} value={p.id}>{p.origin} · {p.id.slice(0, 8)}</option>)}</select></label>
   <label>3D Candidates 历史<select aria-label="3D Candidates 历史" value={execution?.id ?? ''} disabled={busy} onChange={e => { const x = history.executions.find(x => x.id === e.target.value); if (x) {
            setExecution(x);
            setCandidateId(x.candidates[0]?.id ?? '');
        } }}><option value="">选择 Execution</option>{history.executions.filter(x => x.planId === plan?.id).map(x => <option key={x.id} value={x.id}>{x.status} · {x.id.slice(0, 8)}</option>)}</select></label></>}
  </StudioSlot>
  <StudioSlot column="workspace" stages={['source']} intake="visible3d"><section className="visible3d-workspace"><h3>Visible 3D · Vision Analysis</h3><label>上传 Visible 3D 照片<input aria-label="上传 Visible 3D 照片" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file)
        void run(async () => { const s = await intakeApi<Source>('sources', await prepareImage(file)); await loadSource(s); setAnalysis(null); setReview(null); setPlan(null); setExecution(null); setForm(emptyReview); }); }}/></label>
   <label>已有图片来源<select aria-label="已有图片来源" disabled={busy} value={source?.id ?? ''} onFocus={() => void intakeApi<{
        sources: Source[];
    }>('history').then(h => { setSourceOptions(h.sources); }).catch(e => setError(String(e)))} onChange={e => void run(async () => { const s = await intakeApi<Source>('sources/' + e.target.value); await loadSource(s); setAnalysis(null); setReview(null); setPlan(null); setExecution(null); })}><option value="">选择图片</option>{sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label>3D Vision 模型<select value={model} onChange={e => setModel(e.target.value)} disabled={busy}><option value="">选择已配置模型</option>{config?.models.map(m => <option key={m.id} value={m.id} disabled={!config.providers[m.provider]}>{m.label}</option>)}</select></label><button disabled={busy || !source || !model} onClick={() => void run(() => modelAction('analyze'))}>Analyze Visible 3D（调用模型）</button>{imageView}
   <details><summary>人工标注 / 离线验证（不调用模型）</summary><p>导入 VisibleEvidence3D JSON；必须保留可见区域或边角证据。人工标注不代表 Vision 识别成功率。</p><textarea spellCheck={false} aria-label="Visible 3D 人工标注 JSON" value={annotation} onChange={e => setAnnotation(e.target.value)}/><input aria-label="导入 3D 标注文件" type="file" accept="application/json" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f)
        void f.text().then(setAnnotation); }}/><button disabled={busy || !source} onClick={() => void run(async () => { const a = await api<Analysis>('annotate', { sourceId: source!.id, evidence: parseVisibleEvidence(JSON.parse(annotation)) }); selectAnalysis(a); await refresh(); navigate('review'); })}>保存人工标注并 Review</button></details>
  </section></StudioSlot>
  <StudioSlot column="workspace" stages={['review']} intake="visible3d"><ReviewWorkspace spatial spatialLabels={Object.fromEntries((analysis?.evidence.observations??[]).map(o=>[o.id,o.shapeAssessment?familyLabels[o.shapeAssessment.family]:'V1 未记录 Shape Family']))} confirmedIds={form.pieces.filter(p => p.confirmed && !p.excluded).map(p => p.id)} active={active && stage === 'review'} evidence={projectedReview} imageWidth={source?.view.width ?? 1} imageHeight={source?.view.height ?? 1} selected={selected} onSelect={setSelected} busy={busy} saveControl={<button disabled={busy || !analysis} onClick={() => void run(async () => { const r = await api<{
        record: Review;
        head: typeof head;
    }>('reviews', { analysisId: analysis!.id, review: form, thickness, expectedRevision: head.revision }); selectReview(r.record); setHead(r.head); setPlan(null); setExecution(null); await refresh(); setNotice('3D Review 已保存，实例集固定；下一步 Spatial Planning'); })}>保存 3D Review</button>} inputControl={<button disabled={!review || dirty} onClick={() => navigate('reconstruction')}>进入 3D Reconstruction</button>} onAdd={() => { }} addDisabled>{imageView}</ReviewWorkspace></StudioSlot>
  <StudioSlot column="workspace" stages={['reconstruction']} intake="visible3d"><section className="visible3d-workspace"><h3>Spatial Planning → Magnetic Geometry Execution</h3><p>来源 {source?.name} · Review {review?.id.slice(0, 8) ?? '未保存'}{dirty ? ' · 有未保存修改' : ''}{review && head.reviewId !== review.id ? ' · Outdated' : ''}</p>
   <label>3D Spatial Planning 模型<select disabled={busy} value={planningModel} onChange={e => setPlanningModel(e.target.value)}><option value="">选择模型</option>{config?.planningModels.map(m => <option key={m.id} value={m.id} disabled={!config.providers[m.provider]}>{m.label}</option>)}</select></label><button disabled={busy || !review || dirty || head.reviewId !== review.id || !planningModel} onClick={() => void run(() => modelAction('plan'))}>Spatial Planning（调用模型）</button>
   <details><summary>人工 Spatial Hypothesis / 修改后保存新版本</summary><button disabled={!review || dirty} onClick={() => setManual(JSON.stringify(plan && plan.reviewId === review?.id ? plan.plan : seedPlan(), null, 2))}>准备人工假设模板</button><textarea spellCheck={false} aria-label="3D Spatial Hypothesis JSON" value={manual} onChange={e => setManual(e.target.value)}/><button disabled={busy || !review || dirty || head.reviewId !== review.id} onClick={() => void run(async () => { const p = await api<Plan>('manual-plan', { reviewId: review!.id, plan: JSON.parse(manual) }); setPlan(p); setExecution(null); await refresh(); })}>保存人工 Spatial Hypothesis</button></details>
   <div className="visible3d-budget"><label>连接组合预算<input aria-label="3D 连接组合预算" type="number" min="0" max="2048" value={maxAssignments} onChange={e => setMaxAssignments(+e.target.value)}/></label><label>几何检查预算<input aria-label="3D 几何检查预算" type="number" min="0" max="4096" value={maxGeometryChecks} onChange={e => setMaxGeometryChecks(+e.target.value)}/></label><button disabled={busy || !plan || plan.reviewId !== review?.id || dirty || head.reviewId !== review?.id} onClick={() => void run(async () => { const r = await api<{
        state: string;
        error?: string;
        record: Execution;
    }>('execute', { planId: plan!.id, requestId: crypto.randomUUID(), options: { maxAssignments, maxGeometryChecks } }); if (r.state !== 'complete')
        throw Error(r.error); setExecution(r.record); setCandidateId(r.record.candidates[0]?.id ?? ''); setChecked(false); await refresh(); })}>Geometry Execution（不调用模型）</button></div>
   {execution && <><p role="status" data-testid="visible3d-execution-status">{execution.status} · {execution.candidates.length} Candidates · {execution.search.assignments}/{execution.search.maxAssignments} 组合 · {execution.search.geometryChecks}/{execution.search.maxGeometryChecks} 检查</p>{outdated && <p role="alert">Outdated：来源、Review 或 Plan 已变化，禁止采用旧候选。</p>}<div role="group" aria-label="3D Candidates">{execution.candidates.map(c => <button key={c.id} aria-pressed={candidateId === c.id} onClick={() => { setCandidateId(c.id); setChecked(false); setPickedPiece(null); }}>{c.id} · {c.coverage.reconstructed.length}/{c.coverage.totalConfirmed} 可见实例 · {c.interpretation}</button>)}</div><details><summary>执行 Diagnostic</summary><pre>{JSON.stringify(execution.diagnostics, null, 2)}</pre></details></>}
   {candidate && <><p>Geometry Valid · Evidence Coverage {candidate.coverage.reconstructed.length}/{candidate.coverage.totalConfirmed} · Photo Match 未验证 · Human Review {checked ? '待提交' : 'Pending'}</p>{active && stage === 'reconstruction' && <MagnetScene3D assembly={candidate.assembly} selected={pickedPiece} onSelect={setPickedPiece}/>}<details open><summary>原图对照（需要人工确认）</summary>{imageView}</details></>}
  </section></StudioSlot>
  <StudioSlot column="inspector" stages={imageStages} intake="visible3d"><section className="visible3d-inspector"><h3>Visible 3D Inspector</h3>{busy && <p role="status">正在处理；不会自动重试模型请求…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
   {stage === 'review' && <>{selectedReview ? <><h4>{selectedReview.id}</h4><p>{selectedEvidence?.evidence}</p><p>{selectedEvidence?.occlusion} · {selectedEvidence?.uncertainty}</p><label><input type="checkbox" checked={selectedReview.confirmed} disabled={busy} onChange={e => editPiece({ confirmed: e.target.checked })}/>确认可见实例</label><label><input type="checkbox" checked={selectedReview.excluded} disabled={busy} onChange={e => editPiece({ excluded: e.target.checked })}/>排除实例（保留证据）</label><div className="visible3d-shape" aria-label="AI 形状与 Profile 建议"><h4>基础形状与透视 · AI 建议</h4>{selectedEvidence?.shapeAssessment?<><p><b>{familyLabels[selectedEvidence.shapeAssessment.family]}</b> · 其他可能：{selectedEvidence.shapeAssessment.alternativeFamilies.map(f=>familyLabels[f]).join(', ')||'无'}</p><p>{selectedEvidence.shapeAssessment.evidence}</p><p>透视 / 遮挡：{selectedEvidence.shapeAssessment.perspectiveUncertainty}</p><p>准确规格：{selectedEvidence.shapeAssessment.exactProfileUncertainty}</p><button disabled={busy} onClick={()=>editPiece({shapeFamily:selectedEvidence.shapeAssessment!.family,shapeNote:'用户采用 AI 基础形状建议；不等于准确规格确认'})}>采用 AI 形状判断</button></>:<p>V1 未记录独立 Shape Family。</p>}<label>人工形状判断<select aria-label="3D 人工 Shape Family" disabled={busy} value={selectedReview.shapeFamily??'unknown'} onChange={e=>editPiece({shapeFamily:e.target.value as ShapeFamily3D,shapeNote:'用户修正基础形状；准确 Profile 独立确认'})}>{shapeFamilies.map(f=><option key={f} value={f}>{familyLabels[f]}</option>)}</select></label><p>Exact Profile 候选（需确认）：</p>{selectedEvidence?.profileCandidates.map(p=>{const profile=registry.profiles.find(r=>r.id===p.profileId&&r.version===p.profileVersion);return <article key={`${p.profileId}@${p.profileVersion}`}><b>{p.profileId}@{p.profileVersion}</b><p>{profile?profileSizeLabel(profile):'Catalog 当前不可用'}</p><p>{p.reason}</p><button disabled={busy||!profile} onClick={()=>editPiece({profileId:p.profileId,profileVersion:p.profileVersion})}>使用 Profile 候选 {p.profileId}@{p.profileVersion}</button></article>})}{!selectedEvidence?.profileCandidates.length&&<p>无准确 Profile 候选；基础形状仍可保留，Geometry 继续 Unknown。</p>}</div><label>确认 Profile<select aria-label="3D Review Profile" value={selectedReview.profileId ? `${selectedReview.profileId}@${selectedReview.profileVersion}` : ''} disabled={busy} onChange={e => { const p = registry.profiles.find(p => `${p.id}@${p.version}` === e.target.value); editPiece({ profileId: p?.id ?? null, profileVersion: p?.version ?? null }); }}><option value="">Unknown</option>{registry.profiles.map(p => <option key={`${p.id}@${p.version}`} value={`${p.id}@${p.version}`}>{p.name} · {p.id}@{p.version}</option>)}</select></label><label>颜色<input aria-label="3D Review 颜色" type="color" value={selectedReview.color} onChange={e => editPiece({ color: e.target.value })}/></label><details><summary>模型 Profile 候选 / 可见边角</summary><pre>{JSON.stringify(selectedEvidence, null, 2)}</pre></details></> : <p>请先在图片阶段分析或导入标注。</p>}
    <SpatialUnderstandingPanel label="Vision 整体空间理解" value={analysis?.evidence.spatialInterpretation} onChoose={chooseVisualConnection} disabled={busy}/>
    <label>整体解释人工审核<select aria-label="3D 整体解释审核" disabled={busy} value={form.interpretationReview?.status??'unreviewed'} onChange={e=>setForm(f=>({...f,interpretationReview:{status:e.target.value as 'unreviewed'|'accepted'|'corrected'|'rejected',note:f.interpretationReview?.note??''}}))}><option value="unreviewed">未确认</option><option value="accepted">接受为待几何验证的解释</option><option value="corrected">已纠正（填写说明）</option><option value="rejected">拒绝此解释</option></select></label><label>空间解释修正说明<textarea aria-label="3D 空间解释修正说明" disabled={busy} value={form.interpretationReview?.note??''} onChange={e=>setForm(f=>({...f,interpretationReview:{status:f.interpretationReview?.status??'corrected',note:e.target.value}}))}/></label>
    <label>Profile 单位厚度<input aria-label="3D Review 厚度" type="number" min="0.001" step="0.01" value={thickness} onChange={e => setThickness(+e.target.value)}/></label>
    <details open={connectionOpen} onToggle={e=>setConnectionOpen(e.currentTarget.open)}><summary>确认连接边 / 二面角（可 Unknown）</summary>{['A', 'B'].map((side, i) => <div key={side}><label>实例 {side}<select aria-label={`3D 连接实例 ${side}`} value={i ? edgeB : edgeA} onChange={e => { if (i) {
            setEdgeB(e.target.value);
            setPortB('');setEdgeRefs([]);setEdgeRange(null);
        }
        else {
            setEdgeA(e.target.value);
            setPortA('');setEdgeRefs([]);setEdgeRange(null);
        } }}><option value="">选择已确认实例</option>{form.pieces.filter(p => p.confirmed && !p.excluded).map(p => <option key={p.id}>{p.id}</option>)}</select></label><label>Port {side}<select aria-label={`3D 连接 Port ${side}`} value={i ? portB : portA} onChange={e => i ? setPortB(e.target.value) : setPortA(e.target.value)}><option value="">Unknown</option>{ports(i ? edgeB : edgeA).map(p => <option key={p.portId} value={p.portId}>{p.portId} · {p.length.toFixed(3)}</option>)}</select></label></div>)}<label>二面角候选（逗号分隔；空白 Unknown）<input aria-label="3D Review 二面角候选" value={angles} onChange={e => setAngles(e.target.value)}/></label><label>角度区间下限（空白 Unknown）<input aria-label="3D Review 角度下限" type="number" min="-180" max="180" value={edgeRange?.min??''} onChange={e=>setEdgeRange(e.target.value===''?null:{min:+e.target.value,max:edgeRange?.max??+e.target.value})}/></label><label>角度区间上限<input aria-label="3D Review 角度上限" type="number" min="-180" max="180" value={edgeRange?.max??''} onChange={e=>setEdgeRange(e.target.value===''?null:{min:edgeRange?.min??+e.target.value,max:+e.target.value})}/></label><label>flip<select value={flip} onChange={e => setFlip(e.target.value)}><option value="unknown">Unknown</option><option value="false">false</option><option value="true">true</option></select></label><label>连接证据说明<input value={edgeNote} onChange={e => setEdgeNote(e.target.value)}/></label><button disabled={!edgeA || !edgeB || edgeA === edgeB || busy} onClick={() => { const c: ConnectionHypothesis3D = { pieceA: edgeA, pieceB: edgeB, portA: portA || null, portB: portB || null, intent: 'connect', angles: angles.trim() ? angles.split(',').map(Number) : [], angleRange: edgeRange, flip: flip === 'unknown' ? null : flip === 'true', evidenceRefs: edgeRefs.length?edgeRefs:[edgeA, edgeB], evidence: edgeNote, uncertainty: '人工输入；照片匹配仍需审核' }; setForm(f => ({ ...f, constraints: [...f.constraints.filter(c => [c.pieceA, c.pieceB].sort().join('|') !== [edgeA, edgeB].sort().join('|')), c] })); }}>加入 / 替换人工连接约束</button>{form.constraints.map((c, i) => <p key={i}>{c.pieceA}/{c.portA ?? '?'} ↔ {c.pieceB}/{c.portB ?? '?'} · {c.angles.join(',') || 'Unknown'}° <button onClick={() => setForm(f => ({ ...f, constraints: f.constraints.filter((_, j) => j !== i) }))}>移除约束</button></p>)}</details>
   </>}
   {stage==='reconstruction'&&plan&&<section aria-label="Planning 连接候选审核"><details aria-label="Planning 推断详情"><summary>Planning 空间理解与连接解释（模型推断）</summary><SpatialUnderstandingPanel label="Planning 空间解释" value={plan.plan.spatialInterpretation}/><details aria-label="3D Planning 连接审核"><summary>模型 Connection / Port / Dihedral / Flip 候选</summary><p>可回到 Review 核对或修改单条连接；这里选择完整解释，保留原计划。</p>{[{label:'主解释',connections:plan.plan.connections},...plan.plan.alternatives].map((v,i)=><article key={i}><b>{v.label}</b>{v.connections.map((c,j)=><p key={j}>{c.pieceA}/{c.portA??'Unknown'} ↔ {c.pieceB}/{c.portB??'Unknown'}<br/>角度 {c.angles.join(', ')||'Unknown'}° · flip {c.flip===null?'Unknown':String(c.flip)}<br/>{c.evidence}<br/><small>{c.uncertainty}</small></p>)}<button disabled={busy||dirty||head.reviewId!==review?.id||plan.reviewId!==review?.id} onClick={()=>void run(()=>usePlanVariant(v.connections))}>选择解释 {i+1} 并保存人工计划</button></article>)}</details></details></section>}
   {stage === 'reconstruction' && candidate && <><h4>{candidate.id}</h4><details><summary>Geometry Validator Diagnostic</summary><pre>{JSON.stringify(candidate.geometry, null, 2)}</pre></details><p>已重建：{candidate.coverage.reconstructed.join(', ')}</p><p>未解决：{candidate.coverage.unresolved.join(', ') || '无'}</p><p>排除：{candidate.coverage.excluded.join(', ') || '无'}</p><ul>{candidate.unverifiedConstraints.map((n, i) => <li key={i}>{n}</li>)}</ul>{pickedPiece && <pre>{JSON.stringify(candidate.assembly.pieces.find(p => p.id === pickedPiece), null, 2)}</pre>}<label><input type="checkbox" aria-label="已对照照片审核候选" checked={checked} onChange={e => setChecked(e.target.checked)}/>已对照原图，接受局部结果和未验证项</label><button disabled={busy || outdated || !checked} onClick={() => void run(async () => { if (!confirm('采用此候选并替换当前保存的 3D Draft？2D 工作与教程存档不变。'))
        return; const origin = await api<Record<string, unknown> & {
        assembly: Assembly3D;
    }>('adopt', { executionId: execution!.id, candidateId: candidate.id, visualChecked: true }); await refresh(); adopt3D(origin.assembly, origin); })}>采用候选到 3D Assembly Editor</button></>}
   {(analysis || plan || execution) && <details><summary>来源、Trace 与导出</summary><pre>{JSON.stringify({ sourceId: source?.id, sourceHash: source?.hash, analysisId: analysis?.id, reviewId: review?.id, planId: plan?.id, executionId: execution?.id }, null, 2)}</pre>{[analysis, plan].filter(Boolean).map(r => r!.traceId ? <button key={r!.id} onClick={() => void run(async () => setTrace(await api('trace/' + r!.traceId)))}>查看 {r!.id.slice(0, 8)} 原始 Trace</button> : <p key={r!.id}>{r!.origin} · 无模型调用 Trace</p>)}<button onClick={() => download('visible3d-evidence.json', analysis?.evidence)}>导出 Visible Evidence</button>{plan && <button onClick={() => download('visible3d-hypothesis.json', plan.plan)}>导出 Spatial Hypothesis</button>}<button onClick={() => download('visible3d-provenance.json', { source, analysis, review, plan, execution, origins: history.origins?.filter(o => o.sourceId === source?.id) })}>导出完整来源记录</button></details>}
   {trace !== null && <details open><summary>实际保存的模型 Trace</summary><pre>{JSON.stringify(trace, null, 2)}</pre><button onClick={() => setTrace(null)}>关闭 Trace</button></details>}
  </section></StudioSlot>
 </>;
}
