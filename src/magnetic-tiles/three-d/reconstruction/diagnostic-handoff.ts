import type {VisibleCandidate3D} from './execute.ts';
import {diagnosticAcceptanceEligibility} from '../diagnostic-acceptance.ts';
import {validateAssembly3D,assemblyValidationLayers} from '../engine-adapter.ts';

/** Entry policy only. Recompute with the original strict Validator. */
export function diagnosticHandoffCheck(candidate:VisibleCandidate3D){
 const geometry=validateAssembly3D(candidate.assembly),validation=assemblyValidationLayers(geometry);
 const allowed=candidate.kind==='diagnostic'&&validation.idealGeometry.valid&&!validation.solidCollision.valid;
 return {allowed,geometry,validation};
}

/** Explicit workflow acceptance, separate from the legacy editor-only override. */
export function humanDiagnosticHandoffCheck(candidate:VisibleCandidate3D){
 const geometry=validateAssembly3D(candidate.assembly),policy=diagnosticAcceptanceEligibility(candidate.assembly,geometry)
 return {allowed:candidate.kind==='diagnostic'&&policy.eligible,geometry,policy}
}
