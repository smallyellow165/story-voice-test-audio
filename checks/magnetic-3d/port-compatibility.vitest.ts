import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {Quaternion,Vector3} from 'three';
import {profiles} from '../../src/magnetic-tiles/profiles.ts';
import {createViewerModel} from '../../src/magnetic-tiles/three-d/viewer-model.ts';
import {fromEnginePose} from '../../src/magnetic-tiles/three-d/assembly.ts';
import type {Assembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts';
import {computeTransformFromConnection} from '../../src/magnetic-tiles/three-d/vendor/engine/solver.ts';
import {inspectPortCompatibility} from '../../src/magnetic-tiles/three-d/vendor/engine/port-compatibility.ts';
import {validateAssembly3D,assemblyValidationLayers} from '../../src/magnetic-tiles/three-d/engine-adapter.ts';
import {hypothesisPortConflicts} from '../../src/magnetic-tiles/three-d/reconstruction/port-constraints.ts';
import {refineConstraints} from '../../src/magnetic-tiles/three-d/reconstruction/constraint-refinement.ts';
import {executeVisible3D} from '../../src/magnetic-tiles/three-d/reconstruction/execute.ts';
import type {VisibleInput3D,SpatialHypothesis3D} from '../../src/magnetic-tiles/three-d/reconstruction/contracts.ts';
import {previewEdgeSnap,confirmEdgeSnap} from '../../src/magnetic-tiles/three-d/editor-snap.ts';
import {createInitialHistory,undo} from '../../src/magnetic-tiles/three-d/vendor/editor/state.ts';
import {editorProject} from '../../src/magnetic-tiles/three-d/editor-project.ts';
import {findBestSnapCandidate,findCompatibleTargets} from '../../src/magnetic-tiles/three-d/vendor/editor/snap.ts';

function joint(angles=[0,90],close=true,thickness=.06):Assembly3D{
  const profile=profiles.find(p=>p.id==='square')!;
  const a:Assembly3D={kind:'magnetic-assembly-3d',schemaVersion:1,id:'junction-test',revision:0,profiles:[{profile,thickness}],pieces:[{id:'anchor',profileId:profile.id,profileVersion:profile.version,pose:{position:[0,0,0],quaternion:[0,0,0,1]}}],connections:[]};
  const root=createViewerModel(a)[0];
  angles.forEach((dihedralDeg,i)=>{
    const pose=computeTransformFromConnection(root.transform,root.shape,'e1-p0',root.shape,'e3-p0',dihedralDeg,true)!;
    a.pieces.push({id:'panel'+i,profileId:profile.id,profileVersion:profile.version,pose:fromEnginePose(pose)});
    a.connections.push({pieceA:'anchor',portA:'e1-p0',pieceB:'panel'+i,portB:'e3-p0',dihedralDeg,flip:true});
  });
  if(close){
    const vs=createViewerModel(a);
    for(let i=1;i<vs.length;i++)for(let j=i+1;j<vs.length;j++){
      const x=vs[i],y=vs[j],port=x.shape.ports.find(p=>p.portId==='e3-p0')!,axis=new Vector3(port.dir.x,port.dir.y,0).applyQuaternion(x.transform.quaternion);
      const nx=new Vector3(0,0,1).applyQuaternion(x.transform.quaternion),ny=new Vector3(0,0,1).applyQuaternion(y.transform.quaternion);
      const dihedralDeg=Math.atan2(new Vector3().crossVectors(nx,ny).dot(axis),nx.dot(ny))*180/Math.PI;
      a.connections.push({pieceA:x.id,portA:'e3-p0',pieceB:y.id,portB:'e3-p0',dihedralDeg,flip:false});
    }
  }
  return a;
}
function inspect(a:Assembly3D){const vs=createViewerModel(a);return inspectPortCompatibility(a.connections,id=>vs.find(v=>v.id===id)?.shape,Object.fromEntries(vs.map(v=>[v.id,v.transform])));}
function planning(a:Assembly3D):{input:VisibleInput3D;plan:SpatialHypothesis3D}{
  const input:VisibleInput3D={profiles:structuredClone(a.profiles),review:{pieces:a.pieces.map(p=>({id:p.id,profileId:p.profileId,profileVersion:p.profileVersion,confirmed:true,excluded:false,color:'#123456'})),constraints:[]},evidence:{version:1,observations:a.pieces.map(p=>({id:p.id,color:'#123456',bbox:[0,0,1,1],features:[],occlusion:'',evidence:'deterministic test, not a real photo',uncertainty:'',profileCandidates:[]})),unknowns:[]}};
  const plan:SpatialHypothesis3D={version:1,parts:input.review.pieces.map(p=>({id:p.id,profileId:p.profileId,profileVersion:p.profileVersion,orientationEvidence:'test'})),connections:a.connections.map(c=>({...c,flip:c.flip??false,intent:'connect',angles:[c.dihedralDeg],angleRange:null,evidenceRefs:[c.pieceA,c.pieceB],evidence:'test',uncertainty:''})),alternatives:[],relations:[],unknowns:[]};
  // Engine-only field is not part of the planning contract.
  for(const c of plan.connections)delete (c as unknown as {dihedralDeg?:number}).dihedralDeg;
  return {input,plan};
}
describe('shared spatial Port Compatibility V1',()=>{
  it('accepts single, two and three attachments to the same port without a cardinality limit',()=>{
    for(const angles of [[0],[0,90],[0,90,-90]]){const a=joint(angles);expect(inspect(a).status).toBe('compatible');expect(validateAssembly3D(a).valid).toBe(true);}
  });
  it('is invariant under thickness, root translation/rotation and signed fold direction',()=>{
    for(const thickness of [.02,.06,.12])for(const angles of [[0,90],[0,-90],[0,60]]){
      const a=joint(angles,true,thickness),q=new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),1.17),offset=new Vector3(4,-2,7);
      for(const p of a.pieces){p.pose.position=new Vector3(...p.pose.position).applyQuaternion(q).add(offset).toArray();p.pose.quaternion=q.clone().multiply(new Quaternion(...p.pose.quaternion)).toArray();}
      expect(inspect(a).status).toBe('compatible');expect(validateAssembly3D(a).issues.some(i=>i.code==='port-reuse')).toBe(false);
    }
  });
  it('rejects exact/reversed duplicate port pairs and same-direction occupants',()=>{
    const a=joint(),c=a.connections[0];a.connections.push({...c});expect(inspect(a).conflicts.some(c=>c.reason==='duplicate-connection')).toBe(true);expect(validateAssembly3D(a).issues.some(i=>i.code==='port-reuse')).toBe(true);
    a.connections[a.connections.length-1]={pieceA:c.pieceB,portA:c.portB,pieceB:c.pieceA,portB:c.portA,dihedralDeg:0,flip:true};
    expect(inspect(a).conflicts.some(c=>c.reason==='duplicate-connection')).toBe(true);
    const overlap=joint([0,0],false);expect(inspect(overlap).conflicts.some(c=>c.reason==='same-direction')).toBe(true);expect(validateAssembly3D(overlap).valid).toBe(false);
  });
  it('never treats missing or misaligned port frames as verified; strict residual checks remain',()=>{
    const a=joint();a.pieces[2].pose.position[2]+=.2;expect(inspect(a).status).toBe('unverified');expect(validateAssembly3D(a).issues.some(i=>i.code==='loop-position-error')).toBe(true);
    expect(inspectPortCompatibility(a.connections,()=>undefined,{}).status).toBe('unverified');
    const angle=joint();angle.connections[0].dihedralDeg=25;expect(validateAssembly3D(angle).issues.some(i=>i.code==='loop-dihedral-error')).toBe(true);
  });
  it('preserves saved Front poses/connections and the four identical collision results, removing only six obsolete reuse errors',()=>{
    const f=JSON.parse(readFileSync(new URL('./fixtures/front-diagnostic-geometry.json',import.meta.url),'utf8')),raw=JSON.stringify(f),report=validateAssembly3D(f.assembly);
    expect(f.geometry.issues.filter((i:{code:string})=>i.code==='port-reuse')).toHaveLength(6);
    expect(report.valid).toBe(false);expect(assemblyValidationLayers(report).idealGeometry.valid).toBe(true);expect(assemblyValidationLayers(report).solidCollision.valid).toBe(false);expect(report.issues).toHaveLength(4);expect(report.issues.every(i=>i.code==='intersection')).toBe(true);
    expect(report.issues.map(i=>[i.relatedPieceIds,i.penetrationDepth])).toEqual(f.geometry.issues.filter((i:{code:string})=>i.code==='intersection').map((i:{relatedPieceIds:string[];penetrationDepth:number})=>[i.relatedPieceIds,i.penetrationDepth]));expect(JSON.stringify(f)).toBe(raw);
    const p=planning(f.assembly);expect(hypothesisPortConflicts(p.plan.connections,p.input).conflicts).toEqual([]);expect(refineConstraints(p.plan,p.input).candidates).toEqual([]);
  });
  it('refines only proved conflicts, preserves compatible hard joints, and defers continuous/Unknown choices',()=>{
    const good=planning(joint());good.input.review.constraints=structuredClone(good.plan.connections);expect(refineConstraints(good.plan,good.input).blockers).toEqual([]);
    const bad=planning(joint([0,0],false)),r=refineConstraints(bad.plan,bad.input);expect(r.candidates).toHaveLength(2);expect(r.candidates.every(c=>c.retained.length===1)).toBe(true);
    bad.input.review.constraints=structuredClone(bad.plan.connections);expect(refineConstraints(bad.plan,bad.input).blockers).toHaveLength(1);
    bad.input.review.constraints=[];bad.plan.connections[1].angleRange={min:-90,max:90};const pending=hypothesisPortConflicts(bad.plan.connections,bad.input);expect(pending.conflicts).toEqual([]);expect(pending.unverifiedPorts).not.toHaveLength(0);expect(refineConstraints(bad.plan,bad.input).candidates).toEqual([]);
  });
  it('V5 grows a valid common-edge junction after the nominal interpretation fails',()=>{
    const {plan,input}=planning(joint());plan.connections[1].angles=[0,90];
    const result=executeVisible3D(plan,input,{algorithmVersion:5,maxAssignments:16,maxGeometryChecks:64,maxLocalSubsets:256});
    expect(result.search.progressive!.checks.growth).toBeGreaterThan(0);expect(Math.max(...result.candidates.map(c=>c.assembly.pieces.length))).toBe(3);
    expect(result.candidates.every(c=>validateAssembly3D(c.assembly).valid)).toBe(true);
  });
  it('click and drag snap can close a shared-port junction; duplicate/same-direction preview failures keep the Draft intact',()=>{
    const a=joint(),connection=a.connections.splice(1,1)[0],h=createInitialHistory(a),raw=JSON.stringify(h.current),preview=previewEdgeSnap(h.current,connection);
    expect(preview.geometry.valid).toBe(true);expect(JSON.stringify(h.current)).toBe(raw);
    const next=confirmEdgeSnap(h,preview);expect(next.current.connections).toHaveLength(3);expect(undo(next).current).toEqual(h.current);
    expect(()=>previewEdgeSnap(next.current,connection)).toThrow(/重复连接/);
    expect(findCompatibleTargets({pieceId:connection.pieceB,portId:connection.portB},editorProject(a)).some(t=>t.pieceId===connection.pieceA&&t.portId===connection.portA)).toBe(true);
    const drag=findBestSnapCandidate(connection.pieceB,editorProject(a),[{dihedralDeg:90,flip:true}]);expect(drag).not.toBeNull();expect(previewEdgeSnap(a,drag!.connection).geometry.valid).toBe(true);
    const free=joint([0],false);free.pieces.push({...structuredClone(free.pieces[1]),id:'overlap',pose:{position:[5,5,5],quaternion:[0,0,0,1]}});
    const before=JSON.stringify(free);expect(()=>previewEdgeSnap(free,{...free.connections[0],pieceB:'overlap'})).toThrow(/严格验证拒绝/);expect(JSON.stringify(free)).toBe(before);
  });
});
