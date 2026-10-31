import type { Assembly3D } from '../assembly.ts';
import { solveAssembly3D, validateAssembly3D } from '../engine-adapter.ts';
import { parseSpatialHypothesis, validateVisibleInput } from './contracts.ts';
import type { ConnectionHypothesis3D, SpatialHypothesis3D, VisibleInput3D } from './contracts.ts';
import type { Connection } from '../vendor/engine/types.ts';
export type VisibleCandidate3D = {
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
    version: 1;
    status: 'candidates_found' | 'no_valid_candidate' | 'budget_exhausted';
    completeSearch: boolean;
    search: {
        assignments: number;
        geometryChecks: number;
        maxAssignments: number;
        maxGeometryChecks: number;
    };
    candidates: VisibleCandidate3D[];
    diagnostics: string[];
};
export function executeVisible3D(planValue: SpatialHypothesis3D, inputValue: VisibleInput3D, options: {
    maxAssignments?: number;
    maxGeometryChecks?: number;
    topK?: number;
} = {}): VisibleExecution3D {
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
    function evaluate(connections: Connection[], notes: string[], label: string) {
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
                const assembly = solveAssembly3D(a), geometry = validateAssembly3D(assembly);
                if (!geometry.valid) {
                    diagnostics.add('GEOMETRY_REJECTED: ' + JSON.stringify(geometry));
                    continue;
                }
                const key = JSON.stringify({ pieces: assembly.pieces, connections: assembly.connections });
                if (dedup.has(key))
                    continue;
                dedup.add(key);
                const unresolved = input.review.pieces.filter(p => !p.excluded && !set.has(p.id)).map(p => p.id);
                candidates.push({ id: 'pending', assembly, geometry, coverage: { reconstructed: group, unresolved, excluded, totalConfirmed: confirmed.length },
                    photoMatch: { status: 'unverified', score: null }, humanReview: 'pending', unverifiedConstraints: [...notes, ...plan.unknowns, ...plan.relations.map(r => `${r.from}/${r.to}: ${r.kind} 图片关系未作重投影验证`),
                        '绝对位置、相机、世界朝向及比例标定未验证；局部坐标系只用于求解', ...input.profiles.filter(s => s.profile.sizeEvidence?.status === 'estimated').map(s => `Profile ${s.profile.id}@${s.profile.version} 的尺寸来源为 estimated，几何合法不证明实物尺寸`), ...(unresolved.length ? ['PARTIAL: 未解决实例未生成；不可把局部候选当作完整作品'] : [])], rank: 0, frame: 'component-local-unregistered', interpretation: label });
            }
            catch (e) {
                diagnostics.add('SOLVER_REJECTED: ' + String(e));
            }
        }
    }
    for (const variant of variants) {
        const overrides = input.review.constraints, pairs = new Set(overrides.map(c => [c.pieceA, c.pieceB].sort().join('|')));
        const combined = [...variant.connections.filter(c => !pairs.has([c.pieceA, c.pieceB].sort().join('|'))), ...overrides];
        if (overrides.length)
            diagnostics.add('REVIEW_CONSTRAINTS: 人工连接约束优先于模型同对假设；原计划保留');
        const domains = combined.map(domain);
        function visit(i: number, chosen: Connection[], notes: string[]) {
            if (exhausted)
                return;
            if (i === domains.length) {
                evaluate(chosen, notes, variant.label);
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
    candidates.sort((a, b) => b.coverage.reconstructed.length - a.coverage.reconstructed.length || a.unverifiedConstraints.length - b.unverifiedConstraints.length || JSON.stringify(a.assembly).localeCompare(JSON.stringify(b.assembly)));
    if (exhausted)
        diagnostics.add('BUDGET_EXHAUSTED: 未完成有限候选枚举；本次结果不提供可采用候选，请缩小假设或增加预算');
    const accepted = exhausted ? [] : candidates.slice(0, topK);
    accepted.forEach((c, i) => { c.id = `candidate-${i + 1}`; c.rank = i + 1; c.assembly.id = `visible-${i + 1}`; });
    return { version: 1, status: exhausted ? 'budget_exhausted' : accepted.length ? 'candidates_found' : 'no_valid_candidate', completeSearch: !exhausted, search, candidates: accepted, diagnostics: [...diagnostics].slice(0, 50) };
}
