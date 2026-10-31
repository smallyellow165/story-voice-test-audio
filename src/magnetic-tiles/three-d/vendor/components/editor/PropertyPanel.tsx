// Upstream PieceProps/ConnectionProps retained; host data and field labels adapted.
// MIT source: third_party/3D_Magnetic_Pieces/EDITOR.md.
import { useState, useMemo, useEffect } from 'react'
import * as THREE from 'three'
import type { EditorProject, Selection, SerializableTransform } from '../../../editor-project.ts'
const ALL_COLORS = ['#f5b942','#ef795d','#55b8ac','#7e9bda','#b895cf']
const colorLabels: Record<string,string> = Object.fromEntries(ALL_COLORS.map(c=>[c,c]))
const colorSwatch = (c: string) => c
let fieldIdCounter = 0
const nextFieldId = () => `magnetic-pf-${++fieldIdCounter}`
interface Props {
  project: EditorProject; selection: Selection
  onSetPieceColor: (id: string, color: string) => void
  onDuplicatePiece: () => void; onDeleteSelected: () => void
  onUpdateConnection: (index: number, patch: {dihedralDeg?:number;flip?:boolean}) => void
  onRemoveConnection: (index: number) => void
  onSetPieceTransform: (id:string, pose:SerializableTransform) => void
}
export function PropertyPanel(props: Props) {
  return <div className="magnetic-3d-editor-properties">
    {props.selection.kind==='piece' ? <PieceProps key={props.selection.id} {...props}/> : props.selection.kind==='connection' ? <ConnectionProps key={props.selection.index} {...props}/> : <p>选择零件或连接进行编辑。</p>}
  </div>
}
function PieceProps(props: Props) {
  const { project, selection, onSetPieceColor, onDuplicatePiece, onDeleteSelected, onSetPieceTransform } = props;
  const piece = project.pieces.find((p) => p.id === (selection as any).id);
  const [posDraft, setPosDraft] = useState<{ x: string; y: string; z: string } | null>(null);
  const [rotDraft, setRotDraft] = useState<{ x: string; y: string; z: string } | null>(null);

  if (!piece) return <p className="text-xs text-gray-400 p-4">零件不存在</p>;
  const part = project.parts.find((p) => p.id === piece.partId);
  if (!part) return <p className="text-xs text-red-500 p-4">partId 悬空: {piece.partId}</p>;
  const shape = part.shape;
  const tf = project.transforms[piece.id];

  // 当前位置和旋转(显示用)
  const curPos = tf?.position ?? [0, 0, 0];
  const curQuat = new THREE.Quaternion(
    tf?.quaternion[0] ?? 0,
    tf?.quaternion[1] ?? 0,
    tf?.quaternion[2] ?? 0,
    tf?.quaternion[3] ?? 1
  );
  const curEuler = new THREE.Euler().setFromQuaternion(curQuat, 'XYZ');
  const curRotDeg = [
    THREE.MathUtils.radToDeg(curEuler.x),
    THREE.MathUtils.radToDeg(curEuler.y),
    THREE.MathUtils.radToDeg(curEuler.z),
  ];

  // 编辑中的草稿值优先显示
  const posDisplay = posDraft ?? { x: String(curPos[0]), y: String(curPos[1]), z: String(curPos[2]) };
  const rotDisplay = rotDraft ?? { x: String(curRotDeg[0]), y: String(curRotDeg[1]), z: String(curRotDeg[2]) };

  // 提交位置(回车或失焦时)
  const commitPosition = () => {
    if (!posDraft) return;
    const x = parseFloat(posDraft.x);
    const y = parseFloat(posDraft.y);
    const z = parseFloat(posDraft.z);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      onSetPieceTransform(piece.id, {
        position: [x, y, z],
        quaternion: [curQuat.x, curQuat.y, curQuat.z, curQuat.w],
      });
    }
    setPosDraft(null);
  };

  // 提交旋转(回车或失焦时)
  const commitRotation = () => {
    if (!rotDraft) return;
    const x = parseFloat(rotDraft.x);
    const y = parseFloat(rotDraft.y);
    const z = parseFloat(rotDraft.z);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          THREE.MathUtils.degToRad(x),
          THREE.MathUtils.degToRad(y),
          THREE.MathUtils.degToRad(z),
          'XYZ'
        )
      );
      onSetPieceTransform(piece.id, {
        position: [curPos[0], curPos[1], curPos[2]],
        quaternion: [q.x, q.y, q.z, q.w],
      });
    }
    setRotDraft(null);
  };

  // 旋转快捷:绕指定轴旋转指定角度
  const rotateBy = (axis: 'x' | 'y' | 'z', deg: number) => {
    const axisVec = axis === 'x' ? new THREE.Vector3(1, 0, 0)
      : axis === 'y' ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1);
    const q = curQuat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axisVec, THREE.MathUtils.degToRad(deg)));
    onSetPieceTransform(piece.id, {
      position: [curPos[0], curPos[1], curPos[2]],
      quaternion: [q.x, q.y, q.z, q.w],
    });
  };

  // 重置旋转
  const resetRotation = () => {
    onSetPieceTransform(piece.id, {
      position: [curPos[0], curPos[1], curPos[2]],
      quaternion: [0, 0, 0, 1],
    });
  };

  return (
    <div className="p-3 space-y-3">
      <div>
        <div className="text-xs text-gray-500">ID</div>
        <div className="text-xs font-mono text-gray-700 break-all">{piece.id}</div>
      </div>
      <div>
        <div className="text-xs text-gray-500">形状</div>
        <div className="text-xs text-gray-700">{shape}</div>
      </div>
      <div>
        <span id="piece-color-label" className="text-xs text-gray-500">颜色</span>
        <div className="grid grid-cols-6 gap-1 mt-1" role="group" aria-labelledby="piece-color-label">
          {ALL_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onSetPieceColor(piece.id, c)}
              aria-pressed={part.color === c}
              aria-label={colorLabels[c]}
              className={`w-7 h-7 rounded border-2 ${part.color === c ? 'border-blue-500' : 'border-gray-200'}`}
              style={{ background: colorSwatch(c) }}
              title={colorLabels[c]}
            />
          ))}
        </div>
      </div>
      {/* 位置 */}
      <fieldset>
        <legend className="text-xs text-gray-500 mb-1">位置 (X / Y / Z)</legend>
        <div className="grid grid-cols-3 gap-1">
          {(['x', 'y', 'z'] as const).map((axis) => {
            const fid = `pos-${piece.id}-${axis}`;
            return (
              <div key={axis} className="block">
                <label htmlFor={fid} className="text-[10px] text-gray-400">{axis.toUpperCase()}</label>
                <input
                  id={fid}
                  aria-label={`3D 位置 ${axis.toUpperCase()}`}
                  type="number"
                  step={0.1}
                  value={posDisplay[axis]}
                  onChange={(e) => setPosDraft({ ...posDisplay, [axis]: e.target.value })}
                  onBlur={commitPosition}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitPosition(); }}
                  className="w-full px-1 py-0.5 text-xs border rounded font-mono"
                />
              </div>
            );
          })}
        </div>
      </fieldset>
      {/* 旋转(欧拉角 XYZ 度数) */}
      <fieldset>
        <div className="flex items-center justify-between mb-1">
          <legend className="text-xs text-gray-500">旋转 (度, XYZ)</legend>
          <button onClick={resetRotation} className="text-[10px] text-blue-500 hover:underline">重置</button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {(['x', 'y', 'z'] as const).map((axis) => {
            const fid = `rot-${piece.id}-${axis}`;
            return (
              <div key={axis} className="block">
                <label htmlFor={fid} className="text-[10px] text-gray-400">{axis.toUpperCase()}</label>
                <input
                  id={fid}
                  aria-label={`3D 旋转 ${axis.toUpperCase()}`}
                  type="number"
                  step={15}
                  value={rotDisplay[axis]}
                  onChange={(e) => setRotDraft({ ...rotDisplay, [axis]: e.target.value })}
                  onBlur={commitRotation}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRotation(); }}
                  className="w-full px-1 py-0.5 text-xs border rounded font-mono"
                />
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1 mt-1" role="group" aria-label="旋转快捷按钮">
          <button onClick={() => rotateBy('y', 15)} className="text-[10px] px-1.5 py-0.5 border rounded hover:bg-gray-50" title="R">Y +15°</button>
          <button onClick={() => rotateBy('y', -15)} className="text-[10px] px-1.5 py-0.5 border rounded hover:bg-gray-50" title="T">Y -15°</button>
          <button onClick={() => rotateBy('x', 15)} className="text-[10px] px-1.5 py-0.5 border rounded hover:bg-gray-50" title="F">X +15°</button>
          <button onClick={() => rotateBy('x', -15)} className="text-[10px] px-1.5 py-0.5 border rounded hover:bg-gray-50" title="G">X -15°</button>
          <button onClick={() => rotateBy('z', 15)} className="text-[10px] px-1.5 py-0.5 border rounded hover:bg-gray-50" title="V">Z +15°</button>
          <button onClick={() => rotateBy('z', -15)} className="text-[10px] px-1.5 py-0.5 border rounded hover:bg-gray-50" title="B">Z -15°</button>
        </div>
      </fieldset>
      <div className="flex gap-2 pt-2 border-t">
        <button onClick={onDuplicatePiece} className="text-xs px-2 py-1 border rounded hover:bg-gray-50">复制</button>
        <button onClick={onDeleteSelected} className="text-xs px-2 py-1 border border-red-300 text-red-600 rounded hover:bg-red-50">删除</button>
      </div>


    </div>
  );
}

function ConnectionProps(props: Props) {
  const { project, selection, onUpdateConnection, onRemoveConnection } = props;
  const idx = (selection as any).index as number;
  const conn = project.connections[idx];
  const dihedralId = useMemo(() => nextFieldId(), []);
  const flipId = useMemo(() => nextFieldId(), []);

  // 本地输入值；明确应用后只更新约束，Pose 由独立的显式求解操作修改。
  const [localDihedral, setLocalDihedral] = useState(conn?.dihedralDeg ?? 0);
  // 外部变化（undo/redo/预设按钮）时同步 local state
  useEffect(() => {
    if (conn) setLocalDihedral(conn.dihedralDeg);
  }, [conn?.dihedralDeg]);

  if (!conn) return <p className="text-xs text-gray-400 p-4">连接不存在</p>;

  return (
    <div className="p-3 space-y-3">
      <div className="text-xs text-gray-500">连接 #{idx}</div>
      <div className="text-[10px] font-mono text-gray-600 break-all">
        {conn.pieceA}:{conn.portA} → {conn.pieceB}:{conn.portB}
      </div>
      <div>
        <label htmlFor={dihedralId} className="text-xs text-gray-500">二面角(deg): {localDihedral}</label>
        <input
          id={dihedralId}
          type="number"
          min={-180}
          max={180}
          step={1}
          value={localDihedral}
          onChange={(e) => {
            const v = Number(e.target.value);
            setLocalDihedral(v);

          }}

          className="w-full"
          aria-valuetext={`${localDihedral} 度`}
        />
        <button onClick={() => onUpdateConnection(idx, { dihedralDeg: localDihedral })}>应用约束角度</button>
        <div className="flex gap-1 mt-1" role="group" aria-label="二面角预设">
          {[0, 45, 90, -90, 135, 180].map((d) => (
            <button
              key={d}
              onClick={() => {
                setLocalDihedral(d);
                onUpdateConnection(idx, { dihedralDeg: d });
              }}
              aria-pressed={conn.dihedralDeg === d}
              className="text-[10px] px-1 border rounded hover:bg-gray-50"
            >{d}°</button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor={flipId} className="text-xs text-gray-500">flip(翻转方向)</label>
        <button
          id={flipId}
          onClick={() => onUpdateConnection(idx, { flip: !conn.flip })}
          aria-pressed={conn.flip}
          className={`ml-2 text-xs px-2 py-0.5 rounded ${conn.flip ? 'bg-blue-500 text-white' : 'bg-gray-100'}`}
        >
          {conn.flip ? 'ON' : 'OFF'}
        </button>
      </div>
      <div className="pt-2 border-t">
        <button
          onClick={() => onRemoveConnection(idx)}
          className="text-xs px-2 py-1 border border-red-300 text-red-600 rounded hover:bg-red-50"
        >
          断开连接
        </button>
      </div>
    </div>
  );
}

