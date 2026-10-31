import type {VisibleExecution3D} from './execute.ts';

/** Diagnostics share the existing viewer and camera identity, never adoption. */
export const executionPreviews=(execution:VisibleExecution3D|null)=>execution?[...execution.candidates,...execution.diagnosticCandidates??[]]:[];
export function defaultExecutionPreview(execution:VisibleExecution3D){
 const complete=execution.candidates.find(c=>c.coverage.reconstructed.length===c.coverage.totalConfirmed);
 const diagnostic=execution.diagnosticCandidates?.find(c=>c.validation?.idealGeometry.valid&&c.coverage.reconstructed.length===c.coverage.totalConfirmed);
 return (complete??diagnostic??execution.candidates[0]??execution.diagnosticCandidates?.[0])?.id??'';
}
