export type GeometryIssue = {key:string;ids:string[];type:string;scope:'layout'|'domain';details:any[]}
export function geometryIssuesForDisplay(report:unknown,refinement:unknown):GeometryIssue[]
export function expectedConnections(plan:unknown,ids:string[]):any[]
