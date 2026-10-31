import { adaptProfile, profileKey3D } from '../profile-adapter.ts';
import type { ProfileSnapshot3D } from '../profile-adapter.ts';
export type Feature3D = {
    id: string;
    points: [
        number,
        number
    ][];
    visibility: 'visible' | 'estimated';
    note: string;
};
export type VisibleObservation3D = {
    id: string;
    color: string;
    bbox: [
        number,
        number,
        number,
        number
    ] | null;
    features: Feature3D[];
    occlusion: string;
    evidence: string;
    uncertainty: string;
    profileCandidates: {
        profileId: string;
        profileVersion: number;
        reason: string;
    }[];
};
export type VisibleEvidence3D = {
    version: 1;
    observations: VisibleObservation3D[];
    unknowns: string[];
};
export type ReviewedPiece3D = {
    id: string;
    confirmed: boolean;
    excluded: boolean;
    profileId: string | null;
    profileVersion: number | null;
    color: string;
};
export type ConnectionHypothesis3D = {
    pieceA: string;
    pieceB: string;
    portA: string | null;
    portB: string | null;
    intent: 'connect' | 'uncertain' | 'separate';
    angles: number[];
    angleRange: {
        min: number;
        max: number;
    } | null;
    flip: boolean | null;
    evidenceRefs: string[];
    evidence: string;
    uncertainty: string;
};
export type VisibleReview3D = {
    pieces: ReviewedPiece3D[];
    constraints: ConnectionHypothesis3D[];
};
export type SpatialHypothesis3D = {
    version: 1;
    parts: {
        id: string;
        profileId: string | null;
        profileVersion: number | null;
        orientationEvidence: string;
    }[];
    connections: ConnectionHypothesis3D[];
    alternatives: {
        label: string;
        connections: ConnectionHypothesis3D[];
    }[];
    relations: {
        from: string;
        to: string;
        kind: 'occludes' | 'projection_overlap' | 'above_in_image' | 'unknown';
        evidence: string;
    }[];
    unknowns: string[];
};
export type VisibleInput3D = {
    evidence: VisibleEvidence3D;
    review: VisibleReview3D;
    profiles: ProfileSnapshot3D[];
};
const fail = (s: string): never => { throw Error(s); };
export const visibleId = (x: unknown): x is string => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(x) && !['constructor', 'prototype', '__proto__'].includes(x);
function obj(x: unknown, keys: string[]): void {
    if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(x, k)))
        fail('Visible 3D 字段缺失或包含未支持字段');
}
const list = (x: unknown, max = 64): void => { if (!Array.isArray(x) || x.length > max)
    fail('Visible 3D 列表超出范围'); };
const text = (x: unknown): void => { if (typeof x !== 'string' || x.length > 4000)
    fail('Visible 3D 文本无效'); };
const ref = (id: unknown, version: unknown): void => {
    if (!(id === null && version === null) && !(visibleId(id) && Number.isSafeInteger(version) && Number(version) > 0))
        fail('Profile 必须是准确 ID@Version 或 null/null');
};
const color = (x: unknown): void => { if (typeof x !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(x))
    fail('颜色需要 #RRGGBB'); };
function strings(x: unknown): void { list(x); (x as unknown[]).forEach(text); }
export function parseVisibleEvidence(value: unknown): VisibleEvidence3D {
    const v = value as VisibleEvidence3D;
    obj(v, ['version', 'observations', 'unknowns']);
    if (v.version !== 1)
        fail('Visible Evidence 版本错误');
    list(v.observations, 12);
    strings(v.unknowns);
    const ids = new Set<string>();
    for (const o of v.observations) {
        obj(o, ['id', 'color', 'bbox', 'features', 'occlusion', 'evidence', 'uncertainty', 'profileCandidates']);
        if (!visibleId(o.id) || ids.has(o.id))
            fail('Observation ID 重复或无效');
        ids.add(o.id);
        color(o.color);
        for (const s of [o.occlusion, o.evidence, o.uncertainty])
            text(s);
        if (!o.evidence.trim())
            fail('每片必须具有可见证据说明');
        if (o.bbox !== null && (!Array.isArray(o.bbox) || o.bbox.length !== 4 || !o.bbox.every(n => Number.isFinite(n) && n >= 0 && n <= 1) || o.bbox[0] >= o.bbox[2] || o.bbox[1] >= o.bbox[3]))
            fail('可见区域 bbox 无效');
        list(o.features, 32);
        const features = new Set<string>();
        for (const f of o.features) {
            obj(f, ['id', 'points', 'visibility', 'note']);
            if (!visibleId(f.id) || features.has(f.id))
                fail('Feature ID 无效');
            features.add(f.id);
            if (!['visible', 'estimated'].includes(f.visibility))
                fail('Feature visibility 无效');
            text(f.note);
            list(f.points, 2);
            if (f.points.length < 1 || f.points.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => !Number.isFinite(n) || n < 0 || n > 1)))
                fail('Feature 坐标需要归一化至 0..1');
        }
        if (!o.bbox && !o.features.some(f => f.visibility === 'visible'))
            fail('不得添加没有可见区域或边角证据的零件');
        list(o.profileCandidates, 8);
        for (const p of o.profileCandidates) {
            obj(p, ['profileId', 'profileVersion', 'reason']);
            ref(p.profileId, p.profileVersion);
            if (!p.profileId)
                fail('候选 Profile 不可为 null');
            text(p.reason);
        }
    }
    return structuredClone(v);
}
function connections(values: ConnectionHypothesis3D[], input: VisibleInput3D): void {
    list(values, 48);
    const parts = input.review.pieces.filter(p => p.confirmed && !p.excluded), ids = new Set(parts.map(p => p.id)), pairs = new Set<string>();
    const features = new Set(input.evidence.observations.flatMap(o => [o.id, ...o.features.map(f => o.id + ':' + f.id)]));
    for (const c of values) {
        obj(c, ['pieceA', 'pieceB', 'portA', 'portB', 'intent', 'angles', 'angleRange', 'flip', 'evidenceRefs', 'evidence', 'uncertainty']);
        const pair = [c.pieceA, c.pieceB].sort().join('|');
        if (!ids.has(c.pieceA) || !ids.has(c.pieceB) || c.pieceA === c.pieceB || pairs.has(pair))
            fail('连接必须引用已确认实例，每对只能有一个假设');
        pairs.add(pair);
        if (!['connect', 'uncertain', 'separate'].includes(c.intent))
            fail('连接 intent 无效');
        for (const [id, port] of [[c.pieceA, c.portA], [c.pieceB, c.portB]]) {
            if (port === null)
                continue;
            if (typeof port !== 'string')
                fail('Port 必须是 ID 或 null');
            const p = parts.find(p => p.id === id)!, s = input.profiles.find(s => s.profile.id === p.profileId && s.profile.version === p.profileVersion);
            if (!s || !adaptProfile(s).shape.ports.some(p => p.portId === port))
                fail('Port 不属于该准确 Profile 版本');
        }
        list(c.angles, 9);
        if (c.angles.some(n => !Number.isFinite(n) || Math.abs(n) > 180))
            fail('二面角需要在 -180..180');
        if (c.angleRange !== null) {
            obj(c.angleRange, ['min', 'max']);
            if (![c.angleRange.min, c.angleRange.max].every(n => Number.isFinite(n) && Math.abs(n) <= 180) || c.angleRange.min > c.angleRange.max)
                fail('角度区间无效');
        }
        if (c.flip !== null && typeof c.flip !== 'boolean')
            fail('flip 必须为 boolean 或 null');
        strings(c.evidenceRefs);
        if (c.evidenceRefs.some(r => !features.has(r)))
            fail('连接证据引用不存在');
        text(c.evidence);
        text(c.uncertainty);
    }
}
export function validateVisibleInput(input: VisibleInput3D): VisibleInput3D {
    obj(input, ['evidence', 'review', 'profiles']);
    parseVisibleEvidence(input.evidence);
    obj(input.review, ['pieces', 'constraints']);
    list(input.review.pieces, 12);
    list(input.profiles, 12);
    const ids = new Set<string>(), keys = new Set<string>();
    for (const s of input.profiles) {
        adaptProfile(s);
        const key = profileKey3D(s.profile);
        if (keys.has(key))
            fail('重复 Profile Snapshot');
        keys.add(key);
    }
    for (const p of input.review.pieces) {
        obj(p, ['id', 'confirmed', 'excluded', 'profileId', 'profileVersion', 'color']);
        if (!input.evidence.observations.some(o => o.id === p.id) || ids.has(p.id))
            fail('Review 不能增加或重复 Observation');
        ids.add(p.id);
        if (typeof p.confirmed !== 'boolean' || typeof p.excluded !== 'boolean')
            fail('Review 确认状态无效');
        ref(p.profileId, p.profileVersion);
        color(p.color);
        if (p.profileId && !keys.has(`${p.profileId}@${p.profileVersion}`))
            fail('缺少 Review ProfileSnapshot');
    }
    if (ids.size !== input.evidence.observations.length)
        fail('Review 必须保留全部 Observation，删除请用 excluded');
    connections(input.review.constraints, input);
    return structuredClone(input);
}
export function parseSpatialHypothesis(value: unknown, input: VisibleInput3D): SpatialHypothesis3D {
    validateVisibleInput(input);
    const v = value as SpatialHypothesis3D;
    obj(v, ['version', 'parts', 'connections', 'alternatives', 'relations', 'unknowns']);
    if (v.version !== 1)
        fail('Spatial Hypothesis 版本错误');
    list(v.parts, 12);
    const confirmed = input.review.pieces.filter(p => p.confirmed && !p.excluded), ids = new Set<string>();
    for (const p of v.parts) {
        obj(p, ['id', 'profileId', 'profileVersion', 'orientationEvidence']);
        const original = confirmed.find(o => o.id === p.id);
        if (!original || ids.has(p.id) || p.profileId !== original.profileId || p.profileVersion !== original.profileVersion)
            fail('Spatial Planning 不得改变已确认的实例及 Profile');
        ids.add(p.id);
        text(p.orientationEvidence);
    }
    if (ids.size !== confirmed.length)
        fail('Spatial Planning 丢失已确认实例');
    connections(v.connections, input);
    list(v.alternatives, 8);
    for (const a of v.alternatives) {
        obj(a, ['label', 'connections']);
        text(a.label);
        connections(a.connections, input);
    }
    list(v.relations, 48);
    for (const r of v.relations) {
        obj(r, ['from', 'to', 'kind', 'evidence']);
        if (!ids.has(r.from) || !ids.has(r.to) || r.from === r.to || !['occludes', 'projection_overlap', 'above_in_image', 'unknown'].includes(r.kind))
            fail('空间关系无效');
        text(r.evidence);
    }
    strings(v.unknowns);
    return structuredClone(v);
}
