export type HiddenPart = {id:string;source:'manual';visibility:'hidden'}
export type ManualSymmetry = {from:string;to:string;relation:'symmetric';source:'manual';note:string}
export function validateReviewParts(observations:{id:string}[],hiddenParts?:HiddenPart[],manualRelations?:ManualSymmetry[]):{hiddenParts:HiddenPart[];manualRelations:ManualSymmetry[]}
export function reviewObservations<T>(observations:T[],hiddenParts?:HiddenPart[]):(T | (HiddenPart & {bbox:null;confidence:null;quantity:number;visible_studs:null;evidence:string;occlusion:string}))[]
