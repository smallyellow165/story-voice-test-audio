import * as actions from '../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import {canonicalProfileSnapshot} from '../src/magnetic-tiles/three-d/canonical-geometry.ts'
import {previewEdgeSnap,confirmEdgeSnap} from '../src/magnetic-tiles/three-d/editor-snap.ts'
import {previewConnectionRotation,confirmConnectionRotation} from '../src/magnetic-tiles/three-d/connection-rotate.ts'
import {snapObject} from '../src/magnetic-tiles/three-d/snap-session.ts'

export async function connectedRamp(f){
 const added=actions.addPieceAction(actions.createInitialHistory(f.combined.snapshot.assembly),canonicalProfileSnapshot(f.large),'#fc0303',[5,5,5]),id=added.pieceId
 const c={pieceA:f.roofId,portA:'e0-p0',pieceB:id,portB:'e2-p1',dihedralDeg:0,flip:true}
 let h=confirmEdgeSnap(added.history,previewEdgeSnap(added.history.current,c,'less-strict'),'less-strict')
 h=confirmConnectionRotation(h,previewConnectionRotation(h.current,id,96,30,'less-strict'),'less-strict')
 const yellow=h.current.modules.find(m=>m.name==='yellow-pole'),tile=yellow.pieces.find(p=>p.sourceId==='y07').id
 return {history:h,id,request:{moving:snapObject(h.current,'group',tile,'e2-p0'),fixed:snapObject(h.current,'tile',id,'e0-p0'),dihedralDeg:-30,flip:true,mode:'less-strict'}}
}
