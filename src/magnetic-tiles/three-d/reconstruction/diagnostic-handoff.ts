import type {VisibleCandidate3D} from './execute.ts'
import {validateAssembly3D,assemblyValidationLayers} from '../engine-adapter.ts'

/** Diagnostics describe the exact draft; opening it does not change its validity. */
export function diagnosticHandoffCheck(candidate:VisibleCandidate3D){
 const geometry=validateAssembly3D(candidate.assembly),validation=assemblyValidationLayers(geometry)
 return {allowed:candidate.kind==='diagnostic',geometry,validation}
}
