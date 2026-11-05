import type {Assembly3D,AssemblyParent3D,Pose3D} from '../assembly.ts'
import type {ConnectionHypothesis3D} from '../reconstruction/contracts.ts'
import type {ReviewedSpatialCheck3D} from '../reconstruction/spatial-consistency.ts'

export type Point3=[number,number,number]
export type Point2=[number,number]
export type RegistrationImage={id:string;hash:string;viewHash:string;name:string;width:number;height:number}
export type RegistrationMember={ref:AssemblyParent3D;name:string;assembly:Assembly3D;origin:{id:string;hash:string};plan:{id:string;hash:string};execution:{id:string;hash:string}}
/** Scene-level boundary. Members need not be disconnected; a future solver can
 * consume shared constraints without changing Analysis/Review or this geometry.
 * V1's upright/common-ground hypothesis is an explicit solver profile only. */
export type RegistrationConstraint={members:[string,string]}&({kind:'connection';hypothesis:ConnectionHypothesis3D}|{kind:'reviewed-spatial-check';check:ReviewedSpatialCheck3D})
export type RegistrationInput={version:1;projectId:string;source:{id:string;hash:string};analysis:{id:string;hash:string};review:{id:string;hash:string};image:RegistrationImage;members:RegistrationMember[];points:RegistrationPoint[];boxes:RegistrationBox[];constraints?:RegistrationConstraint[]}
/** local is in the fixed member Assembly frame, AFTER the saved Tile Pose and
 * Profile scale, not canonical Tile-local XY. memberId is the parent Assembly ID. */
export type RegistrationPoint={memberId:string;pieceId:string;local:Point3;pixel:Point2;evidenceRef:string;basis:string}
export type RegistrationBox={memberId:string;pieceId:string;local:Point3[];pixel:[number,number,number,number];evidenceRef:string}
export type RegistrationCamera={kind:'pinhole';focalPx:number;principalPoint:Point2;worldToCamera:Pose3D}
export type RegistrationSolution={solver:'upright-common-ground-v1';camera:RegistrationCamera;transforms:{memberId:string;delta:Pose3D}[];quality:{pointRmsePx:number;bboxCrosscheckPointRmsePx:number;medianTileBBoxIoU:number;groups:{memberId:string;pointRmsePx:number;relativeYawDeg:number}[]};assumptions:string[];warnings:string[]}
export type RegistrationResult={id:string;hash:string;computedAt:string;input:RegistrationInput;solution:RegistrationSolution;preview:Assembly3D;geometryValid:boolean}
export type RegistrationOptions={projectId:string;source:{id:string;hash:string};review:{id:string;hash:string};images:RegistrationImage[];results:{id:string;hash:string;createdAt:string;imageId:string;rmse:number}[]}
