// Saving checks source identity and step coverage/order. Geometry remains diagnostic.
import type { Assembly3D } from './assembly.ts'
import type { BuildOrderResult } from './build-order.ts'
import type { Tutorial3D, TutorialDiagnostics } from './tutorial.ts'
import { tutorialMatchesAssembly, validateTutorial3D } from './tutorial.ts'
export function tutorialReadyToSave(t:Tutorial3D,report:TutorialDiagnostics,assembly:Assembly3D|null){
  return tutorialMatchesAssembly(t,assembly)&&t.steps.length>0&&
    !report.issues.some(i=>i.severity==='error'&&!['FINAL_GEOMETRY','STEP_GEOMETRY'].includes(i.code))&&
    report.steps.every(s=>s.connected)&&t.steps.every(s=>s.addedPieceIds.length>0)
}
export function generatedPreview(result:BuildOrderResult,assembly:Assembly3D|null):Tutorial3D|null{
  const t=result.tutorial
  return result.status==='complete'&&result.connectedConstruction&&t&&tutorialReadyToSave(t,validateTutorial3D(t),assembly)?t:null
}
