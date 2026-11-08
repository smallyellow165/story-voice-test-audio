import fs from 'node:fs'
import path from 'node:path'
import {describe,it,expect} from 'vitest'
import {Quaternion,Vector3} from 'three'
import {profiles} from '../../src/magnetic-tiles/profiles.ts'
import {standardCatalogProfiles,activeStandardProfiles,getStandardProfileSnapshot} from '../../src/magnetic-tiles/standard-catalog.ts'
import type {Profile} from '../../src/magnetic-tiles/geometry.ts'
import {profileIssues} from '../../src/magnetic-tiles/geometry.ts'
import {canonicalProfileSnapshot,canonicalProfileGeometry,canonicalGeometryManifest,assertCanonicalProfiles} from '../../src/magnetic-tiles/three-d/canonical-geometry.ts'
import {adaptProfile} from '../../src/magnetic-tiles/three-d/profile-adapter.ts'
import {createViewerModel} from '../../src/magnetic-tiles/three-d/viewer-model.ts'
import {editorProject} from '../../src/magnetic-tiles/three-d/editor-project.ts'
import {solveAssembly3D,validateAssembly3D} from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import {assertAssembly3D,type Assembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
const segmented:Profile={...structuredClone(profiles.find(p=>p.id==='square')!),id:'segmented',version:2,solid3d:{thickness:.08,ports:[{edgeId:'e0',ranges:[[0,.4],[.6,1]]}]}}
describe('one Canonical Registry geometry across the 3D workflow',()=>{
 for(const p of [...profiles,segmented])it(`${p.id}@${p.version}: catalog, planning, engine, editor and viewer retain ordered local geometry`,()=>{
  const snapshot=canonicalProfileSnapshot(p),registry=[p],shape=adaptProfile(snapshot).shape,manifest=canonicalGeometryManifest([snapshot]),before=JSON.stringify(snapshot)
  const a:Assembly3D={kind:'magnetic-assembly-3d',schemaVersion:1,id:'test',revision:0,profiles:[snapshot],pieces:[{id:'tile',profileId:p.id,profileVersion:p.version,pose:{position:[2,-3,4],quaternion:new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),1.1).toArray()}}],connections:[]}
  assertCanonicalProfiles(a.profiles,registry)
  expect(createViewerModel(a)[0].shape).toEqual(shape);expect(editorProject(a).shapes.get(`${p.id}@${p.version}`)).toEqual(shape)
  const solved=solveAssembly3D(a);expect(solved.pieces).toEqual(a.pieces);expect(validateAssembly3D(solved).valid).toBe(true)
  expect(manifest.profiles[0]).toEqual(canonicalProfileGeometry(snapshot));expect(manifest.profiles[0].frontNormal).toEqual([0,0,1])
  // A flipped instance is a proper rotation, never a reflected/reordered Profile.
  a.pieces[0].pose.quaternion=[1,0,0,0];expect(createViewerModel(a)[0].shape).toEqual(shape)
  expect(JSON.stringify(snapshot)).toBe(before);expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest)
  shape.ports.forEach(port=>{expect(port.portId).toMatch(new RegExp(`^${port.edgeId}-p[0-9]+$`));expect(port.t1).toBeGreaterThan(port.t0)})
 })
 it('defines area-centroid origin and directed segments once, including symmetric Profiles',()=>{
  const square=canonicalProfileSnapshot(profiles.find(p=>p.id==='square')!),g=canonicalProfileGeometry(square)
  expect(g.sourceOrigin).toEqual([.5,.5]);expect(g.localVertices[0]).toEqual({x:-.5,y:-.5});expect(g.ports[0].p0).toEqual({x:-.5,y:-.5});expect(g.ports[0].p1).toEqual({x:.5,y:-.5})
  const s=canonicalProfileGeometry(canonicalProfileSnapshot(segmented)),ps=s.ports.filter(p=>p.edgeId==='e0');expect(ps.map(p=>[p.portId,p.t0,p.t1])).toEqual([['e0-p0',0,.4],['e0-p1',.6,1]])
 })
 it('does not normalize rotated, reverse-normal, relabeled or scaled snapshots into the same Registry identity',()=>{
  const p=profiles.find(p=>p.id==='square')!,s=canonicalProfileSnapshot(p)
  for(const change of [(x:typeof s)=>{x.profile.vertices=x.profile.vertices.slice(1).concat([x.profile.vertices[0]])},(x:typeof s)=>{x.profile.vertices.reverse()},(x:typeof s)=>{x.scale=2},(x:typeof s)=>{x.thickness=.12},(x:typeof s)=>{x.ports=[{edgeId:'e0',ranges:[[0,.5],[.5,1]]}]},(x:typeof s)=>{x.profile.version=99}]){const x=structuredClone(s);change(x);expect(()=>assertCanonicalProfiles([x],[p])).toThrow()}
  expect(()=>assertCanonicalProfiles([canonicalProfileSnapshot(segmented)],[segmented])).not.toThrow()
 })
 it('rejects malformed versioned solid definitions',()=>{
  for(const solid3d of [{thickness:-1},{thickness:.06,ports:[{edgeId:'e9',ranges:[[0,1]]}]},{thickness:.06,ports:[{edgeId:'e0',ranges:[[.5,.9],[0,.4]]}]}])expect(profileIssues({...segmented,solid3d:solid3d as Profile['solid3d']})).not.toEqual([])
 })
 it('validates all 14 shared standard catalog profiles and active catalog versions across Studio 3D pipeline',()=>{
  expect(standardCatalogProfiles.length).toBe(14)
  expect(activeStandardProfiles.length).toBe(11)
  for(const p of standardCatalogProfiles){
   expect(profileIssues(p)).toEqual([])
   const snapshot=getStandardProfileSnapshot(p.id,p.version)!
   expect(snapshot).toBeDefined()
   assertCanonicalProfiles([snapshot],standardCatalogProfiles)
   const a:Assembly3D={kind:'magnetic-assembly-3d',schemaVersion:1,id:`catalog-${p.id}-${p.version}`,revision:0,profiles:[snapshot],pieces:[{id:'p1',profileId:p.id,profileVersion:p.version,pose:{position:[0,0,0],quaternion:[0,0,0,1]}}],connections:[]}
   expect(validateAssembly3D(a).valid).toBe(true)
  }
 })
 it('validates Explorer standardized reconstructions directly against Studio assertAssembly3D, assertCanonicalProfiles, viewerModel and editorProject',()=>{
  const explorerReconDir=path.resolve(process.cwd(),'../block-toy-explorer/public/reconstructions')
  for(const file of ['rednote-lighthouse-castle-v1.json','rednote-basketball-court-v1.json','rednote-rocket-v1.json','rednote-ball-drop-v1.json']){
   const raw=JSON.parse(fs.readFileSync(path.join(explorerReconDir,file),'utf8'))
   const studioAssembly:Assembly3D={
    kind:raw.kind,
    schemaVersion:raw.schemaVersion,
    id:raw.id,
    revision:raw.revision,
    profiles:raw.profiles,
    pieces:raw.pieces.map((p:Record<string,unknown>)=>({id:p.id as string,profileId:p.profileId as string,profileVersion:p.profileVersion as number,pose:p.pose as Assembly3D['pieces'][number]['pose'],color:p.color as string})),
    connections:raw.connections
   }
   assertAssembly3D(studioAssembly)
   assertCanonicalProfiles(studioAssembly.profiles,standardCatalogProfiles)
   const viewer=createViewerModel(studioAssembly)
   expect(viewer.length).toBe(studioAssembly.pieces.length)
   const proj=editorProject(studioAssembly)
   expect(proj.pieces.length).toBe(studioAssembly.pieces.length)
  }
 })
})
