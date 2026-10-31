// Adapted MIT upstream snap implementation. See third_party/3D_Magnetic_Pieces/EDITOR.md.
import { Vector3, Quaternion } from 'three';
import type { Connection, ShapeDef, PieceTransform } from '../engine/types.ts';
import { getPort } from '../engine/shapes.ts';
import { computeTransformFromConnection } from '../engine/solver.ts';
import type { EditorProject } from '../../editor-project.ts';
import { toEnginePose as transformFromSerializable } from '../../assembly.ts';

/**
 * 端口吸附与连接管理逻辑。
 * 复用 engine 的 computeTransformFromConnection / portWorldEndpoints,
 * 不使用"看起来靠在一起"的视觉吸附,而是创建真实 Connection 数据。
 */

const PORT_LENGTH_TOLERANCE_RATIO = 0.01; // Match the shared validator.
const SNAP_DISTANCE = 0.6; // 世界单位,吸附触发距离

function makeGetShape(project: EditorProject) {
  const partMap = new Map(project.parts.map((p) => [p.id, p]));
  return (pid: string): ShapeDef | undefined => {
    const piece = project.pieces.find((pp) => pp.id === pid);
    if (!piece) return undefined;
    const part = partMap.get(piece.partId);
    return part ? project.shapes.get(part.shape) : undefined;
  };
}

/** 某零件某端口是否已被任何连接占用。 */
export function isPortOccupied(pieceId: string, portId: string, connections: Connection[]): boolean {
  return connections.some(
    (c) =>
      (c.pieceA === pieceId && c.portA === portId) ||
      (c.pieceB === pieceId && c.portB === portId),
  );
}

/** 两个端口是否长度兼容(可连接)。 */
export function portsCompatible(portA: { length: number }, portB: { length: number }): boolean {
  const avg = (portA.length + portB.length) / 2;
  if (avg <= 0) return false;
  return Math.abs(portA.length - portB.length) / avg <= PORT_LENGTH_TOLERANCE_RATIO;
}

/**
 * 计算显示用变换：仅转换 Assembly3D 的保存 Pose，不执行求解。
 */
export function getDisplayTransforms(project: EditorProject): Record<string, PieceTransform> {
  const solverTfs = project.transforms; // Stored poses are authoritative; no implicit solve.
  const out: Record<string, PieceTransform> = {};
  for (const p of project.pieces) {
    const s = solverTfs[p.id];
    if (s) {
      out[p.id] = transformFromSerializable(s);
    } else if (project.transforms[p.id]) {
      out[p.id] = transformFromSerializable(project.transforms[p.id]);
    } else {
      out[p.id] = { position: new Vector3(0, 0, 0), quaternion: new Quaternion() };
    }
  }
  return out;
}

/**
 * P0-1: 轻量级显示变换 — 直接读 project.transforms 缓存,不调用 solver。
 *
 * 用于拖拽期间的高频调用(findBestSnapCandidate),避免每帧全量求解。
 * 拖拽期间 project.connections 不变，使用保存 Pose 加实时拖动覆盖。
 * 缺失 transform 的零件回退到原点(与 getDisplayTransforms 兜底一致)。
 */
function getDisplayTransformsFromCache(project: EditorProject): Record<string, PieceTransform> {
  const out: Record<string, PieceTransform> = {};
  for (const p of project.pieces) {
    const s = project.transforms[p.id];
    if (s) {
      out[p.id] = transformFromSerializable(s);
    } else {
      out[p.id] = { position: new Vector3(0, 0, 0), quaternion: new Quaternion() };
    }
  }
  return out;
}

export interface PortRef {
  pieceId: string;
  portId: string;
}

export interface CompatibleTarget {
  pieceId: string;
  portId: string;
  edgeId: string;
  length: number;
}

/** 列出与源端口兼容且未占用的目标端口。 */
export function findCompatibleTargets(source: PortRef, project: EditorProject): CompatibleTarget[] {
  const getShape = makeGetShape(project);
  const sourceShape = getShape(source.pieceId);
  if (!sourceShape) return [];

  // P0-三.2: 修复空 portId 问题。portId 为空时,枚举源零件所有未占用端口,
  // 对每个端口查找兼容目标并合并去重。
  const sourcePorts = source.portId
    ? [getPort(sourceShape, source.portId)].filter(Boolean) as typeof sourceShape.ports
    : sourceShape.ports.filter((p) => !isPortOccupied(source.pieceId, p.portId, project.connections));

  const results: CompatibleTarget[] = [];
  const seen = new Set<string>();
  for (const sourcePort of sourcePorts) {
    if (isPortOccupied(source.pieceId, sourcePort.portId, project.connections)) continue;
    for (const piece of project.pieces) {
      if (piece.id === source.pieceId) continue;
      const shape = getShape(piece.id);
      if (!shape) continue;
      for (const port of shape.ports) {
        if (isPortOccupied(piece.id, port.portId, project.connections)) continue;
        if (!portsCompatible(sourcePort, port)) continue;
        const key = `${piece.id}:${port.portId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ pieceId: piece.id, portId: port.portId, edgeId: port.edgeId, length: port.length });
      }
    }
  }
  return results;
}

export interface SnapProposal {
  connection: Connection;
  resultingTransform: PieceTransform;
  basePieceId: string;
  basePortId: string;
  attachPieceId: string;
  attachPortId: string;
}

/**
 * 计算将 attachPiece 的 attachPort 连接到 basePiece 的 basePort 上的结果变换。
 * 复用 computeTransformFromConnection。
 */
export function computeSnapTransform(
  basePieceId: string,
  basePortId: string,
  attachPieceId: string,
  attachPortId: string,
  dihedralDeg: number,
  flip: boolean,
  project: EditorProject,
): PieceTransform | null {
  const getShape = makeGetShape(project);
  const baseShape = getShape(basePieceId);
  const attachShape = getShape(attachPieceId);
  if (!baseShape || !attachShape) return null;

  const display = getDisplayTransforms(project);
  const baseTf = display[basePieceId];
  if (!baseTf) return null;

  return computeTransformFromConnection(
    baseTf,
    baseShape,
    basePortId,
    attachShape,
    attachPortId,
    dihedralDeg,
    flip,
  );
}

const DEFAULT_DIHEDRAL_CANDIDATES: { dihedralDeg: number; flip: boolean }[] = [
  { dihedralDeg: 0, flip: true },
  { dihedralDeg: 90, flip: false },
  { dihedralDeg: -90, flip: false },
  { dihedralDeg: 180, flip: true },
];

/**
 * 为一个待放置零件寻找最近的吸附候选(用于拖放时自动吸附)。
 *
 * P0-三.1: 新增 liveAttachTransform 参数,磁吸候选必须基于 TransformControls
 * 当前实时 position/quaternion 计算,而不是上一轮 project.transforms。
 * 若不传则回退到 getDisplayTransforms(project)(向后兼容)。
 */
export function findBestSnapCandidate(
  attachPieceId: string,
  project: EditorProject,
  candidates: { dihedralDeg: number; flip: boolean }[] = DEFAULT_DIHEDRAL_CANDIDATES,
  liveAttachTransform?: PieceTransform,
): SnapProposal | null {
  const getShape = makeGetShape(project);
  const attachShape = getShape(attachPieceId);
  if (!attachShape) return null;

  // P0-1: 拖拽热路径 — 直接读 project.transforms 缓存,跳过全量 solver 求解。
  // 拖拽期间 connections 不变,project.transforms 是上次 commit 的稳定快照。
  const display = getDisplayTransformsFromCache(project);
  const attachTf = liveAttachTransform ?? display[attachPieceId];
  if (!attachTf) return null;

  let best: SnapProposal | null = null;
  let bestDist = SNAP_DISTANCE;

  for (const attachPort of attachShape.ports) {
    if (isPortOccupied(attachPieceId, attachPort.portId, project.connections)) continue;

    for (const basePiece of project.pieces) {
      if (basePiece.id === attachPieceId) continue;
      const baseShape = getShape(basePiece.id);
      if (!baseShape) continue;
      const baseTf = display[basePiece.id];
      if (!baseTf) continue;
      for (const basePort of baseShape.ports) {
        if (isPortOccupied(basePiece.id, basePort.portId, project.connections)) continue;
        if (!portsCompatible(attachPort, basePort)) continue;

        for (const cand of candidates) {
          // P0-三.1: 直接用 baseTf 计算,而不是依赖 project.transforms
          const tf = computeTransformFromConnection(
            baseTf,
            baseShape,
            basePort.portId,
            attachShape,
            attachPort.portId,
            cand.dihedralDeg,
            cand.flip,
          );
          if (!tf) continue;
          const dist = tf.position.distanceTo(attachTf.position);
          if (dist < bestDist) {
            bestDist = dist;
            best = {
              connection: {
                pieceA: basePiece.id,
                portA: basePort.portId,
                pieceB: attachPieceId,
                portB: attachPort.portId,
                dihedralDeg: cand.dihedralDeg,
                flip: cand.flip,
              },
              resultingTransform: tf,
              basePieceId: basePiece.id,
              basePortId: basePort.portId,
              attachPieceId,
              attachPortId: attachPort.portId,
            };
          }
        }
      }
    }
  }

  return best;
}

/** 端口占用状态汇总(供 UI 渲染端口状态)。 */
export function buildPortUsage(project: EditorProject): Set<string> {
  const used = new Set<string>();
  for (const c of project.connections) {
    used.add(`${c.pieceA}:${c.portA}`);
    used.add(`${c.pieceB}:${c.portB}`);
  }
  return used;
}

