// UI acceptance policy only; all geometry and step checks stay in the existing Validator.
import type { Assembly3D } from './assembly.ts'
import type { BuildOrderResult } from './build-order.ts'
import type { Tutorial3D, TutorialDiagnostics } from './tutorial.ts'
import { tutorialMatchesAssembly, validateTutorial3D } from './tutorial.ts'
export function tutorialReadyToSave(t:Tutorial3D,report:TutorialDiagnostics,assembly:Assembly3D|null){
  return tutorialMatchesAssembly(t,assembly)&&(report.finalValid||!!report.humanApproved)&&t.steps.length>0&&!report.issues.some(i=>i.severity==='error'&&!i.humanAccepted)&&report.steps.every(s=>(s.geometryValid||!!s.humanApproved)&&s.connected)&&t.steps.every(s=>s.addedPieceIds.length>0)
}
export function generatedPreview(result:BuildOrderResult,assembly:Assembly3D|null,grant?:import('./human-collision-policy.ts').HumanCollisionGrant):Tutorial3D|null{
  const t=result.tutorial
  return result.status==='complete'&&(result.finalGeometryValid||result.humanApproved)&&result.connectedConstruction&&t&&tutorialReadyToSave(t,validateTutorial3D(t,grant),assembly)?t:null
}
