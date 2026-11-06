import {objectCandidate,objectCollisions} from './move-object-snap.ts'
import type {MoveObjectSession} from './move-object-snap.ts'
import type {EdgeSnapMode} from './editor-snap.ts'
import {TileCollisionWarning} from './TileSnapPreview.tsx'
export function MoveObjectSnapPanel({session,mode,onMode,onSelect,onConfirm,onCancel}:{session:MoveObjectSession|null;mode:EdgeSnapMode;onMode:(m:EdgeSnapMode)=>void;onSelect:(key:string)=>void;onConfirm:()=>void;onCancel:()=>void}){
 const candidate=objectCandidate(session),preview=candidate?.preview,moving=session?.moving
 return <section aria-label="Move Object Snap" className="magnetic-move-object-snap">
  <label>对象吸附验证<select aria-label="Object Snap 验证模式" value={mode} disabled={!!session&&!session.released} onChange={e=>onMode(e.target.value as EdgeSnapMode)}><option value="strict">Strict</option><option value="less-strict">Less Strict</option></select></label>
  {!session?<small>拖动至兼容 Port 附近。保留当前朝向，仅校正小角度；复杂定向可使用独立 Snap。</small>:!session.search.total?<small>暂无附近兼容 Port；使用当前 Move / Grid Snap 位置。</small>:<>
   <label>附近候选<select aria-label="Object Snap 候选" value={session.selectedKey??''} disabled={!session.released} onChange={e=>onSelect(e.target.value)}><option value="">{session.search.total>1?'多个接近候选，请选择目标 Port':'选择候选'}</option>{session.search.candidates.map(c=><option key={c.key} value={c.key}>{c.request.moving.tileId}:{c.request.moving.portId} → {c.request.fixed.tileId}:{c.request.fixed.portId} · {c.error?'阻断':c.preview&&objectCollisions(c.preview).length?'碰撞 Warning':'有效'}</option>)}</select></label>
   <p className="hint">{session.search.total} 个附近候选{session.search.total>12?'（显示最接近的 12 个；可继续靠近目标）':''}。{session.selectedKey?'对象预览优先于网格；原 Draft 尚未修改。':'未自动选取；松手后选择候选并确认，或取消。'}</p>
   {candidate&&<p data-testid="move-object-anchor">{moving?.kind==='group'?`整组移动 ${session.raw.modules?.find(m=>m.id===moving.groupId)?.name??moving.groupId} · `:'单片移动 · '}{candidate.request.moving.tileId}:{candidate.request.moving.portId} → {candidate.request.fixed.tileId}:{candidate.request.fixed.portId} · {candidate.request.dihedralDeg}° · Flip {String(candidate.request.flip)}{preview&&<> · Geometry {preview.geometry.valid?'Valid':'Invalid'}</>}</p>}
   {candidate?.error&&<p role="alert" className="magnetic-3d-blocker">{candidate.error}</p>}
   {preview&&objectCollisions(preview).length>0&&(mode==='less-strict'?<TileCollisionWarning geometry={preview.geometry} label="Object Snap 碰撞 Warning"/>:<ul className="magnetic-3d-blocker">{objectCollisions(preview).map((i,n)=><li key={n}>{i.message}</li>)}</ul>)}
   {session.released&&<div className="button-row"><button disabled={!candidate?.preview||!!candidate.error} onClick={onConfirm}>确认对象吸附</button><button onClick={onCancel}>取消对象吸附</button></div>}
  </>}
 </section>
}
