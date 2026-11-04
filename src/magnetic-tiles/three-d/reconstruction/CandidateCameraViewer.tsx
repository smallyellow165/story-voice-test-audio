import {studioStorage} from '../../workspace-context.ts'
import type {CollisionDisplayProps} from '../CollisionOverlay.tsx'
import type {GeometryIssueDisplayProps} from '../GeometryIssueOverlay.tsx'
import {useState} from 'react'
import type {Assembly3D} from '../assembly.ts'
import {MagnetScene3D} from '../vendor/components/MagnetScene3D.tsx'
import {loadCandidateCamera,saveCandidateCamera} from './camera-view-storage.ts'
import type {CandidateViewReference} from './camera-view-storage.ts'
/** Mounted per stable candidate identity; unsaved orbit state never reaches storage. */
export function CandidateCameraViewer({reference,assembly,selected,onSelect,collision,collisionFocus,geometryIssue,issueFocus}:CollisionDisplayProps&GeometryIssueDisplayProps&{reference:CandidateViewReference;assembly:Assembly3D;selected:string|null;onSelect:(id:string|null)=>void}){
 const [boot]=useState(()=>{try{return {view:loadCandidateCamera(studioStorage(),reference),warning:''}}catch(e){return {view:null,warning:`保存视角无法恢复，使用默认相机：${String(e)}`}}})
 const [notice,setNotice]=useState(boot.warning)
 return <><MagnetScene3D collision={collision} collisionFocus={collisionFocus} geometryIssue={geometryIssue} issueFocus={issueFocus} assembly={assembly} selected={selected} onSelect={onSelect} inspectionTools initialCameraView={boot.view??undefined} onSaveCameraView={camera=>{
  try{saveCandidateCamera(studioStorage(),reference,camera);setNotice('当前视角已保存；再次选择此 Candidate 或刷新时恢复。')}catch(e){setNotice('视角保存失败，原视角记录未替换：'+String(e))}
 }}/>{notice&&<p role="status" className="candidate-camera-notice">{notice}</p>}</>
}
