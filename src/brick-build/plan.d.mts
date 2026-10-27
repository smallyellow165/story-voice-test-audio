import type {Brick} from '../brick-test/catalog'
export type BuildMotion={offsetLdu:{x:number;y:number;z:number};startYawDegrees:number}
export type BuildStep={stepId:string;movingNodeId:string;targetNodeId:string;resultNodeId:string;description:string;motion?:BuildMotion}
export type AssemblyNode={id:string;kind:'part';instanceId:string}|{id:string;kind:'assembly';children:[string,string]}
export type BuildPlan={schema_version:1;build_plan_id:string;source_selection_id:string;source_geometry_result_id:string;source_candidate_id:string;source_candidate_hash:string;title:string;status:'draft'|'reviewed';instanceIds:string[];assemblyNodes:AssemblyNode[];steps:BuildStep[];rootNodeId:string|null;created_at:string;updated_at:string}
export type BuildSource={id:string;geometryId:string;candidateId:string;candidateHash:string;analysisId:string;planId:string;assembly:{name:string;bricks:Brick[]};connections:{lowerId:string;upperId:string;points:{x:number;z:number}[]}[];identities:{id:string;partNumber:string;color:string}[];unverifiedConstraints:unknown[]}
export type BuildReport={valid:boolean;complete:boolean;errors:string[];members:Record<string,string[]>;availableBefore:string[][];available:string[]}
export function leafId(instanceId:string):string
export function nodesForSteps(instanceIds:string[],steps:BuildStep[]):AssemblyNode[]
export function createBuildPlan(source:BuildSource,buildPlanId:string,now:string):BuildPlan
export function withSteps(plan:BuildPlan,steps:BuildStep[]):BuildPlan
export function inspectBuildPlan(plan:unknown,expectedInstanceIds?:string[],connections?:{lowerId:string;upperId:string}[]):BuildReport
export function stepScene(plan:BuildPlan,bricks:Brick[],index:number):{step:BuildStep;moving:Brick[];target:Brick[];result:Brick[]}
