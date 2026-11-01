import {executeConflictedComponents} from './conflict-search.ts';
import {candidateObservationMap,inspectSpatialConsistency} from './spatial-consistency.ts';
import type {ObservationPieceMap3D,SpatialConsistency3D} from './spatial-consistency.ts';
import type { Assembly3D } from '../assembly.ts';
import { solveAssembly3D, validateAssembly3D,assemblyValidationLayers,inspectAssemblyCollisions } from '../engine-adapter.ts';
import { parseSpatialHypothesis, validateVisibleInput } from './contracts.ts';
import type { ConnectionHypothesis3D, SpatialHypothesis3D, VisibleInput3D } from './contracts.ts';
import type { Connection } from '../vendor/engine/types.ts';
export type VisibleCandidate3D = {
    kind?:'candidate'|'diagnostic';
    validation?:ReturnType<typeof assemblyValidationLayers>;
    collisions?:ReturnType<typeof inspectAssemblyCollisions>;
    construction?:{variantIndex:number;combinationIndex:number;componentPieceIds:string[];source:'component'|'local-subgraph';omittedHypotheses:ConnectionHypothesis3D[];parentConnections:Connection[]};
    observationMap?:ObservationPieceMap3D;
    spatialConsistency?:SpatialConsistency3D;
    id: string;
    assembly: Assembly3D;
    geometry: ReturnType<typeof validateAssembly3D>;
    coverage: {
        reconstructed: string[];
        unresolved: string[];
        excluded: string[];
        totalConfirmed: number;
    };
    photoMatch: {
        status: 'unverified';
        score: null;
    };
    humanReview: 'pending';
    unverifiedConstraints: string[];
    rank: number;
    frame: 'component-local-unregistered';
    interpretation: string;
};
export type VisibleExecution3D = {
    version: 1 | 2 | 3 | 4;
    status: 'candidates_found' | 'no_valid_candidate' | 'budget_exhausted';
    /** Completion of the declared finite search scope, not an exhaustive photo/angle proof. */
    completeSearch: boolean;
    search: {
        assignments: number;
        geometryChecks: number;
        maxAssignments: number;
        maxGeometryChecks: number;
        componentSearch?:{scope:'nominal-fixed-pose-component-subgraphs';fullHypothesisSearchComplete:false;fullGraphsProvenInvalid:true;cacheHits:number;mandatoryPortConflicts:{variantIndex:number;ports:{port:string;pairs:string[]}[]}[]};
        localSearch?:{considered:number;geometryChecks:number;deduplicated:number;maxSubsets:number;parents:number;parentLimit:number;parentsTruncated:boolean;complete:boolean;proofPruned?:number;componentSplits?:number};
    };
    candidates: VisibleCandidate3D[];
    diagnosticCandidates?:VisibleCandidate3D[];
    diagnostics: string[];
};
export type VisibleExecutionOptions={
    maxAssignments?: number;
    maxGeometryChecks?: number;
    topK?: number;
    algorithmVersion?:2|3|4;
    maxLocalSubsets?:number;
    maxLocalParents?:number;
    maxDiagnosticCandidates?:number;
};
type AttemptContext={variantIndex:number;combinationIndex:number;componentPieceIds:string[];hypotheses:ConnectionHypothesis3D[];connections:Connection[];notes:string[];label:string};
type Observer={solved:(assembly:Assembly3D,geometry:ReturnType<typeof validateAssembly3D>,context:AttemptContext)=>void;accepted:(candidate:VisibleCandidate3D,context:AttemptContext)=>void};
/** Frozen V2 search remains the historical adoption replay path. V3 observes the
 * same enumeration/solver, retaining rejected poses and extending local search. */
function executeBase(planValue: SpatialHypothesis3D, inputValue: VisibleInput3D, options:VisibleExecutionOptions = {},observer?:Observer): VisibleExecution3D {
    const input = validateVisibleInput(inputValue), plan = parseSpatialHypothesis(planValue, input);
    const maxAssignments = options.maxAssignments ?? 128, maxGeometryChecks = options.maxGeometryChecks ?? 256, topK = options.topK ?? 5;
    if (![maxAssignments, maxGeometryChecks, topK].every(Number.isSafeInteger) || maxAssignments < 0 || maxAssignments > 2048 || maxGeometryChecks < 0 || maxGeometryChecks > 4096 || topK < 1 || topK > 20)
        throw Error('Geometry Execution 搜索预算无效');
    const search = { assignments: 0, geometryChecks: 0, maxAssignments, maxGeometryChecks }, diagnostics = new Set<string>(), candidates: VisibleCandidate3D[] = [], dedup = new Set<string>();
    let exhausted = false;
    const confirmed = input.review.pieces.filter(p => p.confirmed && !p.excluded), known = confirmed.filter(p => p.profileId !== null), excluded = input.review.pieces.filter(p => p.excluded).map(p => p.id);
    if (!known.length)
        diagnostics.add('NO_REVIEWED_PROFILE: 没有具有准确 Profile 的可执行实例');
    const variants = [{ label: 'primary', connections: plan.connections }, ...plan.alternatives];
    function domain(c: ConnectionHypothesis3D): {
        connection: Connection | null;
        notes: string[];
    }[] {
        if (c.intent === 'separate')
            return [{ connection: null, notes: [`${c.pieceA}/${c.pieceB}: separate 距离缺乏相机尺度约束，未验证`] }];
        const angles = [...new Set([...c.angles, ...(c.angleRange ? [c.angleRange.min, (c.angleRange.min + c.angleRange.max) / 2, c.angleRange.max] : [])])];
        if (!c.portA || !c.portB || !angles.length)
            return [{ connection: null, notes: [`${c.pieceA}/${c.pieceB}: Unknown Port/二面角，未执行连接`] }];
        const notes = c.angleRange && c.angleRange.min !== c.angleRange.max ? [`${c.pieceA}/${c.pieceB}: 连续角度区间仅采样端点及中点，未穷尽区间`] : [];
        if (c.flip === null)
            notes.push(`${c.pieceA}/${c.pieceB}: flip 为枚举假设`);
        const result: {
            connection: Connection | null;
            notes: string[];
        }[] = angles.flatMap(dihedralDeg => (c.flip === null ? [false, true] : [c.flip]).map(flip => ({ connection: { pieceA: c.pieceA, pieceB: c.pieceB, portA: c.portA!, portB: c.portB!, dihedralDeg, flip }, notes })));
        if (c.intent === 'uncertain')
            result.push({ connection: null, notes: [`${c.pieceA}/${c.pieceB}: uncertain 连接暂未采用`] });
        return result;
    }
    function evaluate(connections: Connection[], notes: string[], label: string,variantIndex:number,hypotheses:ConnectionHypothesis3D[]) {
        if (search.assignments >= maxAssignments) {
            exhausted = true;
            return;
        }
        search.assignments++;
        // Component-relative translations/depth are not observed. Solve independently;
        // never place multiple unknown components at arbitrary offsets to avoid collisions.
        const remaining = new Set(known.map(p => p.id)), groups: string[][] = [];
        while (remaining.size) {
            const group = [remaining.values().next().value!];
            remaining.delete(group[0]);
            for (let i = 0; i < group.length; i++)
                for (const c of connections) {
                    const next = c.pieceA === group[i] ? c.pieceB : c.pieceB === group[i] ? c.pieceA : null;
                    if (next && remaining.has(next)) {
                        remaining.delete(next);
                        group.push(next);
                    }
                }
            groups.push(group.sort());
        }
        if (groups.length > 1)
            diagnostics.add('MULTIPLE_COMPONENTS: 组件间深度/位置未知，分别输出局部候选，不伪造整体空间布局');
        for (const group of groups) {
            if (search.geometryChecks >= maxGeometryChecks) {
                exhausted = true;
                return;
            }
            search.geometryChecks++;
            const set = new Set(group), pieces = known.filter(p => set.has(p.id));
            const a: Assembly3D = { kind: 'magnetic-assembly-3d', schemaVersion: 1, id: 'visible-candidate', revision: 0, profiles: structuredClone(input.profiles),
                pieces: pieces.map(p => ({ id: p.id, profileId: p.profileId!, profileVersion: p.profileVersion!, color: p.color, pose: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] } })),
                connections: connections.filter(c => set.has(c.pieceA) && set.has(c.pieceB)) };
            try {
                const assembly = solveAssembly3D(a), rawGeometry = validateAssembly3D(assembly);
                const geometry=observer?rawGeometry:{...rawGeometry,issues:rawGeometry.issues.map(({relatedPieceIds:_pair,penetrationDepth:_depth,...issue})=>issue)};
                const context:AttemptContext={variantIndex,combinationIndex:search.assignments,componentPieceIds:group,hypotheses,connections,notes,label};
                observer?.solved(assembly,geometry,context);
                if (!geometry.valid) {
                    diagnostics.add('GEOMETRY_REJECTED: ' + JSON.stringify(geometry));
                    continue;
                }
                const key = JSON.stringify({ pieces: assembly.pieces, connections: assembly.connections });
                if (dedup.has(key))
                    continue;
                dedup.add(key);
                const unresolved = input.review.pieces.filter(p => !p.excluded && !set.has(p.id)).map(p => p.id);
                const candidate:VisibleCandidate3D={ id: 'pending', assembly, geometry, observationMap:candidateObservationMap(assembly,input),spatialConsistency:inspectSpatialConsistency(assembly,input), coverage: { reconstructed: group, unresolved, excluded, totalConfirmed: confirmed.length },
                    photoMatch: { status: 'unverified', score: null }, humanReview: 'pending', unverifiedConstraints: [...notes, ...plan.unknowns, ...plan.relations.map(r => `${r.from}/${r.to}: ${r.kind} 图片关系未作重投影验证`),
                        '绝对位置、相机、世界朝向及比例标定未验证；局部坐标系只用于求解', ...input.profiles.filter(s => s.profile.sizeEvidence?.status === 'estimated').map(s => `Profile ${s.profile.id}@${s.profile.version} 的尺寸来源为 estimated，几何合法不证明实物尺寸`), ...(unresolved.length ? ['PARTIAL: 未解决实例未生成；不可把局部候选当作完整作品'] : [])], rank: 0, frame: 'component-local-unregistered', interpretation: label };
                candidates.push(candidate);observer?.accepted(candidate,context);
            }
            catch (e) {
                diagnostics.add('SOLVER_REJECTED: ' + String(e));
            }
        }
    }
    for (const [variantIndex,variant] of variants.entries()) {
        const overrides = input.review.constraints, pairs = new Set(overrides.map(c => [c.pieceA, c.pieceB].sort().join('|')));
        const combined = [...variant.connections.filter(c => !pairs.has([c.pieceA, c.pieceB].sort().join('|'))), ...overrides];
        if (overrides.length)
            diagnostics.add('REVIEW_CONSTRAINTS: 人工连接约束优先于模型同对假设；原计划保留');
        const domains = combined.map(domain);
        function visit(i: number, chosen: Connection[], notes: string[]) {
            if (exhausted)
                return;
            if (i === domains.length) {
                evaluate(chosen, notes, variant.label,variantIndex,combined);
                return;
            }
            for (const d of domains[i]) {
                visit(i + 1, d.connection ? [...chosen, d.connection] : chosen, [...notes, ...d.notes]);
                if (exhausted)
                    break;
            }
        }
        visit(0, [], []);
        if (exhausted)
            break;
    }
    candidates.sort((a, b) => Number(a.spatialConsistency?.status==='contradicted')-Number(b.spatialConsistency?.status==='contradicted') || b.coverage.reconstructed.length - a.coverage.reconstructed.length || a.unverifiedConstraints.length - b.unverifiedConstraints.length || JSON.stringify(a.assembly).localeCompare(JSON.stringify(b.assembly)));
    if (exhausted)
        diagnostics.add('BUDGET_EXHAUSTED: 未完成有限候选枚举；本次结果不提供可采用候选，请缩小假设或增加预算');
    const accepted = exhausted ? [] : candidates.slice(0, topK);
    accepted.forEach((c, i) => { c.id = `candidate-${i + 1}`; c.rank = i + 1; c.assembly.id = `visible-${i + 1}`; });
    return { version: 2, status: exhausted ? 'budget_exhausted' : accepted.length ? 'candidates_found' : 'no_valid_candidate', completeSearch: !exhausted, search, candidates: accepted, diagnostics: [...diagnostics].slice(0, 50) };
}

/** Key rounding is ONLY deduplication; authoritative poses are never rounded. */
function assemblyKey(a:Assembly3D){return JSON.stringify({pieces:[...a.pieces].sort((a,b)=>a.id.localeCompare(b.id)).map(p=>{
  const sign=(p.pose.quaternion.findLast(v=>Math.abs(v)>1e-10)??1)<0?-1:1;
  return [p.id,p.profileId,p.profileVersion,p.pose.position.map(v=>Math.round(v*1e8)/1e8),p.pose.quaternion.map(v=>Math.round(v*sign*1e8)/1e8)];
}),connections:[...a.connections].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});}

export function executeVisible3D(planValue:SpatialHypothesis3D,inputValue:VisibleInput3D,options:VisibleExecutionOptions={}):VisibleExecution3D{
  if(options.algorithmVersion===2)return executeBase(planValue,inputValue,options);
  // Opt in only new runs. Inputs without a proved conflict retain the frozen V3
  // output/version so historical hashes and adoption replay stay unchanged.
  if(options.algorithmVersion===4){const input=validateVisibleInput(inputValue),plan=parseSpatialHypothesis(planValue,input);const result=executeConflictedComponents(plan,input,options,assemblyKey);if(result)return result;}
  const input=validateVisibleInput(inputValue),plan=parseSpatialHypothesis(planValue,input),maxLocalSubsets=options.maxLocalSubsets??1024,maxLocalParents=options.maxLocalParents??32,maxDiagnosticCandidates=options.maxDiagnosticCandidates??8;
  if(!Number.isSafeInteger(maxLocalSubsets)||maxLocalSubsets<0||maxLocalSubsets>8192||!Number.isSafeInteger(maxLocalParents)||maxLocalParents<1||maxLocalParents>64||!Number.isSafeInteger(maxDiagnosticCandidates)||maxDiagnosticCandidates<1||maxDiagnosticCandidates>20)throw Error('局部搜索 / Diagnostic 预算无效');
  const valid=new Map<string,VisibleCandidate3D>(),failed=new Map<string,{assembly:Assembly3D;geometry:ReturnType<typeof validateAssembly3D>;context:AttemptContext}>();
  const enrich=(candidate:VisibleCandidate3D,context:AttemptContext,source:'component'|'local-subgraph'):VisibleCandidate3D=>{
    const ids=new Set(candidate.assembly.pieces.map(p=>p.id)),omittedHypotheses=context.hypotheses.filter(c=>c.intent!=='separate'&&(!ids.has(c.pieceA)||!ids.has(c.pieceB)||!candidate.assembly.connections.some(x=>[x.pieceA,x.pieceB].sort().join('|')===[c.pieceA,c.pieceB].sort().join('|'))));
    return {...structuredClone(candidate),kind:'candidate',validation:assemblyValidationLayers(candidate.geometry),construction:{variantIndex:context.variantIndex,combinationIndex:context.combinationIndex,componentPieceIds:[...context.componentPieceIds],source,omittedHypotheses:structuredClone(omittedHypotheses),parentConnections:structuredClone(context.connections)},
      unverifiedConstraints:[...candidate.unverifiedConstraints,...(omittedHypotheses.length?[`CONSTRAINT_COVERAGE: ${omittedHypotheses.length} 条原连接假设未在此局部结构中实现，不能声称满足完整结构。`]:[])]};
  };
  const base=executeBase(plan,input,options,{solved:(assembly,geometry,context)=>{if(!geometry.valid){const key=assemblyKey(assembly);if(!failed.has(key))failed.set(key,{assembly,geometry,context:structuredClone(context)})}},accepted:(candidate,context)=>{const c=enrich(candidate,context,'component');valid.set(assemblyKey(c.assembly),c)}});
  const parentOrder=[...failed.values()].sort((a,b)=>b.assembly.pieces.length-a.assembly.pieces.length||b.assembly.connections.length-a.assembly.connections.length||a.context.variantIndex-b.context.variantIndex||a.context.combinationIndex-b.context.combinationIndex),parents=parentOrder.slice(0,maxLocalParents);
  const local={considered:0,geometryChecks:0,deduplicated:0,maxSubsets:maxLocalSubsets,parents:parents.length,parentLimit:maxLocalParents,parentsTruncated:maxLocalSubsets>0&&parentOrder.length>parents.length,complete:true};
  const seen=new Set([...valid.keys(),...failed.keys()]);let localStopped=false;
  const confirmed=input.review.pieces.filter(p=>p.confirmed&&!p.excluded),excluded=input.review.pieces.filter(p=>p.excluded).map(p=>p.id);
  function partial(parent:typeof parents[number],ids:string[]){
    if(local.considered>=maxLocalSubsets){local.complete=false;localStopped=true;return}local.considered++;
    const set=new Set(ids),connections=parent.assembly.connections.filter(c=>set.has(c.pieceA)&&set.has(c.pieceB)),reach=new Set([ids[0]]);
    for(let i=0;i<ids.length;i++)for(const c of connections){if(reach.has(c.pieceA))reach.add(c.pieceB);if(reach.has(c.pieceB))reach.add(c.pieceA)}if(reach.size!==ids.length)return;
    const assembly:Assembly3D={...structuredClone(parent.assembly),pieces:structuredClone(parent.assembly.pieces.filter(p=>set.has(p.id))),connections:structuredClone(connections)},key=assemblyKey(assembly);
    if(seen.has(key)){local.deduplicated++;return}seen.add(key);
    if(base.search.geometryChecks>=(options.maxGeometryChecks??256)){local.complete=false;localStopped=true;return}base.search.geometryChecks++;local.geometryChecks++;
    const geometry=validateAssembly3D(assembly);if(!geometry.valid)return;
    const candidate:VisibleCandidate3D={id:'pending',assembly,geometry,observationMap:candidateObservationMap(assembly,input),spatialConsistency:inspectSpatialConsistency(assembly,input),coverage:{reconstructed:[...ids],unresolved:input.review.pieces.filter(p=>!p.excluded&&!set.has(p.id)).map(p=>p.id),excluded,totalConfirmed:confirmed.length},photoMatch:{status:'unverified',score:null},humanReview:'pending',unverifiedConstraints:[...parent.context.notes,...plan.unknowns,...plan.relations.map(r=>`${r.from}/${r.to}: ${r.kind} 图片关系未作重投影验证`),...input.profiles.filter(s=>s.profile.sizeEvidence?.status==='estimated').map(s=>`Profile ${s.profile.id}@${s.profile.version} 的尺寸来源为 estimated，几何合法不证明实物尺寸`),'PARTIAL: 从已求解组件保留原始 Pose 的局部子图；原完整结构的约束未全部满足。','照片匹配、世界朝向与物理稳定性未验证。'],rank:0,frame:'component-local-unregistered',interpretation:parent.context.label+' · local subgraph'};
    valid.set(key,enrich(candidate,parent.context,'local-subgraph'));
  }
  // Compare the largest subgraphs across all retained parents before smaller
  // ones; one failed branch must not consume the budget on tiny subsets first.
  if(base.completeSearch&&maxLocalSubsets>0)for(let size=(parents[0]?.assembly.pieces.length??1)-1;size>=1&&!localStopped;size--)for(const parent of parents){
    const ids=parent.assembly.pieces.map(p=>p.id).sort();
    if(size>=ids.length)continue;
      const visit=(start:number,selected:string[])=>{if(localStopped)return;if(selected.length===size){partial(parent,selected);return}for(let i=start;i<=ids.length-(size-selected.length)&&!localStopped;i++)visit(i+1,[...selected,ids[i]])};visit(0,[]);
    if(localStopped)break;
  }
  if(local.parentsTruncated)local.complete=false;
  const diagnostics=[...base.diagnostics];if(!local.complete)diagnostics.push('LOCAL_BUDGET_EXHAUSTED: 局部搜索未完成；保留 Diagnostic，禁止将未完成搜索作为可采用结果。');
  const completeSearch=base.completeSearch&&local.complete;
  const candidates=completeSearch?[...valid.values()].sort((a,b)=>b.coverage.reconstructed.length-a.coverage.reconstructed.length||Number(a.spatialConsistency?.status==='contradicted')-Number(b.spatialConsistency?.status==='contradicted')||a.unverifiedConstraints.length-b.unverifiedConstraints.length||assemblyKey(a.assembly).localeCompare(assemblyKey(b.assembly))).slice(0,options.topK??5):[];
  candidates.forEach((c,i)=>{c.id=`candidate-${i+1}`;c.rank=i+1;c.assembly.id=`visible-${i+1}`});
  const diagnosticCandidates=parentOrder.slice(0,maxDiagnosticCandidates).map(({assembly,geometry,context},i)=>{
    const ids=assembly.pieces.map(p=>p.id),candidate:VisibleCandidate3D={id:`diagnostic-${i+1}`,kind:'diagnostic',assembly:structuredClone(assembly),geometry,validation:assemblyValidationLayers(geometry),collisions:inspectAssemblyCollisions(assembly,geometry),observationMap:candidateObservationMap(assembly,input),spatialConsistency:inspectSpatialConsistency(assembly,input),coverage:{reconstructed:ids,unresolved:input.review.pieces.filter(p=>!p.excluded&&!ids.includes(p.id)).map(p=>p.id),excluded,totalConfirmed:confirmed.length},photoMatch:{status:'unverified',score:null},humanReview:'pending',unverifiedConstraints:[...context.notes,...plan.unknowns,'DIAGNOSTIC_ONLY: 严格 Validator 未通过，禁止普通采用。'],rank:i+1,frame:'component-local-unregistered',interpretation:context.label};
    const out=enrich(candidate,context,'component');out.kind='diagnostic';out.collisions=candidate.collisions;out.assembly.id=`diagnostic-${i+1}`;return out;
  });
  return {version:3,status:!completeSearch?'budget_exhausted':candidates.length?'candidates_found':'no_valid_candidate',completeSearch,search:{...base.search,localSearch:local},candidates,diagnosticCandidates,diagnostics};
}
