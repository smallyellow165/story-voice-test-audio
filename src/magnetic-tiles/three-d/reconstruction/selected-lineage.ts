import type {ReconstructionScope} from './reconstruction-scope.ts'
export type SelectedRef={id:string;hash:string}
export type SelectedScope={scope:ReconstructionScope;plan:SelectedRef;execution?:SelectedRef}
/** Existing Project head owns these pointers. Result parents never change.
 * Each Group has ONE selected chain. Image scope is its input, not another
 * parallel selection slot. */
export type SelectedHead={revision:number;selectedRevision:number;analysisId:string|null;analysisHash?:string;reviewId:string|null;reviewHash?:string|null;groups:Record<string,SelectedScope>}
export function selectedScopeKey(scope:Pick<ReconstructionScope,'groupId'|'imageId'>){return scope.groupId}
