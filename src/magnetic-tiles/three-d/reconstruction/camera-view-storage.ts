import {assertCameraView} from '../camera-view.ts'
import type {CameraView3D} from '../camera-view.ts'
export const CANDIDATE_CAMERA_PREFIX='magnetic-tiles.candidate-camera.v1:'
export type CandidateViewReference={executionId:string;executionHash:string;candidateId:string}
export function candidateCameraKey(ref:CandidateViewReference){return CANDIDATE_CAMERA_PREFIX+JSON.stringify([ref.executionId,ref.candidateId])}
export function loadCandidateCamera(storage:Pick<Storage,'getItem'>,ref:CandidateViewReference):CameraView3D|null{
 const raw=storage.getItem(candidateCameraKey(ref));if(raw===null)return null
 const r=JSON.parse(raw)
 if(r.schemaVersion!==1||r.executionId!==ref.executionId||r.executionHash!==ref.executionHash||r.candidateId!==ref.candidateId)throw Error('已保存视角的 Candidate 来源不匹配')
 assertCameraView(r.camera);return r.camera
}
export function saveCandidateCamera(storage:Pick<Storage,'setItem'>,ref:CandidateViewReference,camera:CameraView3D){
 assertCameraView(camera)
 storage.setItem(candidateCameraKey(ref),JSON.stringify({schemaVersion:1,...ref,camera,savedAt:new Date().toISOString()}))
}
