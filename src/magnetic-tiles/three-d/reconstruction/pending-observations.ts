import {assertPose3D} from '../assembly.ts'
import type {Assembly3D,Pose3D} from '../assembly.ts'
import type {ProfileSnapshot3D} from '../profile-adapter.ts'
import {profileKey3D} from '../profile-adapter.ts'
import {commit} from '../vendor/editor/state.ts'
import type {EditorHistory} from '../vendor/editor/state.ts'
import type {ReviewedPiece3D,VisibleObservation3D} from './contracts.ts'
export type PendingObservation=ReviewedPiece3D&{profileSnapshot:ProfileSnapshot3D|null;observation?:VisibleObservation3D}
/** Explicit editor action, never an automatic placement or model hypothesis.
 * Reuse the observed ID/profile/color and the existing snapshot history. */
export function placePendingObservation(h:EditorHistory,p:PendingObservation,pose:Pose3D){
    assertPose3D(pose)
    if(!p.confirmed||p.excluded||!p.profileId||!p.profileSnapshot||p.profileSnapshot.profile.id!==p.profileId||p.profileSnapshot.profile.version!==p.profileVersion)throw Error('未放置实例缺少已确认的准确 ProfileSnapshot')
    return commit(h,a=>{
        if(a.pieces.some(x=>x.id===p.id))throw Error('Observation 已存在，不重复加入')
        const snapshot=a.profiles.find(s=>profileKey3D(s.profile)===profileKey3D(p.profileSnapshot!.profile))
        if(snapshot&&JSON.stringify(snapshot)!==JSON.stringify(p.profileSnapshot))throw Error('当前 ProfileSnapshot 已修改，不能自动覆盖来源规格')
        if(!snapshot)a.profiles.push(structuredClone(p.profileSnapshot!))
        a.pieces.push({id:p.id,profileId:p.profileId!,profileVersion:p.profileVersion!,color:p.color,pose:structuredClone(pose)})
        return a
    })
}
export function pendingForAssembly(a:Assembly3D,values:PendingObservation[]){return values.filter(p=>!a.pieces.some(x=>x.id===p.id))}
