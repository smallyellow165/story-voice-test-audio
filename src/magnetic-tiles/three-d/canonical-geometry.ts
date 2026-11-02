import {canonical} from '../build-plan.ts'
import type {Profile} from '../geometry.ts'
import {adaptProfile} from './profile-adapter.ts'
import type {ProfileSnapshot3D} from './profile-adapter.ts'

export const canonicalGeometryContract='magnetic-canonical-profile-ports-v1'
export const canonicalFrame=Object.freeze({origin:'polygon-area-centroid',plane:'XY',winding:'CCW',frontNormal:Object.freeze([0,0,1] as const),edge:'e{i}: v{i} -> v{(i+1)%n}',port:'e{i}-p{j}: increasing directed-edge t intervals',pose:'world = quaternion * local + position',worldFrame:'component-local-unregistered; not calibrated gravity or photo camera'})
/** Registry Profile + one deterministic 3D policy. No document-local overrides.
 * Omitted solid3d means the contract's standard thickness 0.06 / full-edge layout,
 * for every Profile, not a legacy-format reader. Custom solids belong to a NEW
 * Registry Profile version, alongside the polygon definition. */
export function canonicalProfileSnapshot(profile:Profile):ProfileSnapshot3D{
 const solid=profile.solid3d
 const result:ProfileSnapshot3D={profile:structuredClone(profile),thickness:solid?.thickness??.06,...(solid?.ports?{ports:structuredClone(solid.ports)}:{})}
 adaptProfile(result);return result
}
export function canonicalProfileGeometry(snapshot:ProfileSnapshot3D){
 const {shape,origin}=adaptProfile(snapshot)
 return JSON.parse(JSON.stringify({profileId:snapshot.profile.id,profileVersion:snapshot.profile.version,sourceOrigin:origin,localVertices:shape.vertices,frontNormal:[0,0,1],thickness:shape.thickness,edges:shape.edges,ports:shape.ports})) as {profileId:string;profileVersion:number;sourceOrigin:typeof origin;localVertices:typeof shape.vertices;frontNormal:number[];thickness:number;edges:typeof shape.edges;ports:typeof shape.ports}
}
/** Authoritative Registry lookup is mandatory at formal/UI boundaries. A valid
 * polygon or same ID string alone is NOT proof of the registered definition. */
export function assertCanonicalProfiles(snapshots:readonly ProfileSnapshot3D[],registry:readonly Profile[]){
 for(const snapshot of snapshots){
  const profile=registry.find(p=>p.id===snapshot.profile.id&&p.version===snapshot.profile.version)
  if(!profile)throw Error(`Canonical Profile ${snapshot.profile.id}@${snapshot.profile.version} 不在当前 Registry；请刷新 Catalog 或重新生成，不会重绑版本`)
  if(canonical(canonicalProfileGeometry(snapshot))!==canonical(canonicalProfileGeometry(canonicalProfileSnapshot(profile))))throw Error(`Canonical Profile ${profile.id}@${profile.version} 的局部几何、厚度、比例或 Port 不一致；必须创建新 Profile 版本，不能覆盖快照`)
 }
}
export function canonicalGeometryManifest(profiles:readonly ProfileSnapshot3D[]){return {contract:canonicalGeometryContract,frame:canonicalFrame,profiles:profiles.map(canonicalProfileGeometry)}}
