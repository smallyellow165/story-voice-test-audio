import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {executeVisible3D} from '../../src/magnetic-tiles/three-d/reconstruction/execute.ts';
import {defaultExecutionPreview,executionPreviews} from '../../src/magnetic-tiles/three-d/reconstruction/execution-preview.ts';
import {validateAssembly3D,assemblyValidationLayers,inspectAssemblyCollisions} from '../../src/magnetic-tiles/three-d/engine-adapter.ts';
import {solveConnections,computeAllConnectionResiduals} from '../../src/magnetic-tiles/three-d/vendor/engine/solver.ts';
import {createShapeCatalog,profileKey3D} from '../../src/magnetic-tiles/three-d/profile-adapter.ts';
import {toEnginePose} from '../../src/magnetic-tiles/three-d/assembly.ts';
import type {VisibleInput3D,SpatialHypothesis3D} from '../../src/magnetic-tiles/three-d/reconstruction/contracts.ts';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/orange-reviewed-geometry.json',import.meta.url),'utf8')) as {input:VisibleInput3D;plan:SpatialHypothesis3D};
describe('V3 strict solids, visible diagnostics and bounded local induced subgraphs',()=>{
 it('retains the exact six-piece seven-connection closure separately from collision-invalid diagnostics',()=>{
  const {input,plan}=fixture(),before=JSON.stringify({input,plan}),r=executeVisible3D(plan,input),d=r.diagnosticCandidates![0];
  expect(r.version).toBe(3);expect(r.completeSearch).toBe(true);expect(r.search.assignments).toBe(16);
  expect(d.kind).toBe('diagnostic');expect(d.assembly.pieces.length).toBe(6);expect(d.assembly.connections.length).toBe(7);
  expect(d.geometry.valid).toBe(false);expect(d.validation?.idealGeometry.valid).toBe(true);expect(d.validation?.solidCollision.valid).toBe(false);
  expect(validateAssembly3D(d.assembly).valid).toBe(false);expect(r.candidates.every(c=>c.kind==='candidate'&&c.geometry.valid)).toBe(true);
  const catalog=createShapeCatalog(d.assembly.profiles),getShapeForPiece=(id:string)=>{const p=d.assembly.pieces.find(p=>p.id===id)!;return catalog.get(profileKey3D({id:p.profileId,version:p.profileVersion}))!.shape};
  const solved=solveConnections({pieces:d.assembly.pieces.map(p=>({id:p.id,partId:p.profileId})),connections:d.assembly.connections,getShapeForPiece,rootPieceId:d.assembly.pieces[0].id,rootTransform:toEnginePose(d.assembly.pieces[0].pose),groundLock:false});
  const residuals=computeAllConnectionResiduals(d.assembly.connections,solved.transforms,getShapeForPiece);
  expect(residuals.length).toBe(7);for(const residual of residuals){expect(residual.positionError).toBeLessThan(1e-12);expect(residual.dihedralError).toBeLessThan(1e-10)}
  expect(executionPreviews(r).length).toBe(r.candidates.length+r.diagnosticCandidates!.length);expect(defaultExecutionPreview(r)).toBe('diagnostic-1');
  expect(JSON.stringify({input,plan})).toBe(before);expect(executeVisible3D(plan,input)).toEqual(r);
 });
 it('locates four strict vertex junction collisions without waiving them',()=>{
  const {input,plan}=fixture(),d=executeVisible3D(plan,input).diagnosticCandidates![0],evidence=d.collisions!;
  expect(evidence.length).toBe(4);expect(evidence.map(c=>c.pieceIds.join('/')).sort()).toEqual(['tile1/tile2','tile1/tile4','tile3/tile5','tile3/tile6']);
  for(const c of evidence){expect(c.penetrationDepth).toBeCloseTo(.015,10);expect(c.locality).toBe('near-shared-vertex');expect(c.sharedVertices.length).toBeGreaterThan(0);expect(c.declaredConnection).toBe(false);expect(c.region).not.toBeNull();expect(c.intersectionVertices.length).toBeGreaterThan(0);expect(c.region!.min.every(Number.isFinite)).toBe(true)}
  expect(inspectAssemblyCollisions(d.assembly)).toEqual(evidence);expect(validateAssembly3D(d.assembly).valid).toBe(false);
 });
 it('finds larger legal partials, preserving parent poses and ALL internal selected constraints',()=>{
  const {input,plan}=fixture(),r=executeVisible3D(plan,input),triples=r.candidates.filter(c=>c.assembly.pieces.length===3);
  expect(triples.map(c=>c.coverage.reconstructed.join('/'))).toContain('tile1/tile5/tile6');expect(triples.map(c=>c.coverage.reconstructed.join('/'))).toContain('tile2/tile3/tile4');
  expect(r.candidates[0].coverage.reconstructed.length).toBe(3);
  for(const c of triples){const parent=r.diagnosticCandidates!.find(d=>d.construction?.combinationIndex===c.construction?.combinationIndex&&d.construction?.variantIndex===c.construction?.variantIndex)!;
   expect(parent).toBeDefined();for(const p of c.assembly.pieces)expect(p).toEqual(parent.assembly.pieces.find(q=>q.id===p.id));
   const ids=new Set(c.coverage.reconstructed);expect(c.assembly.connections).toEqual(c.construction!.parentConnections.filter(x=>ids.has(x.pieceA)&&ids.has(x.pieceB)));
   expect(c.construction?.omittedHypotheses.length).toBe(5);expect(c.coverage.unresolved.length).toBe(3);expect(c.coverage.totalConfirmed).toBe(6);expect(c.validation?.idealGeometry.valid).toBe(true);expect(c.validation?.solidCollision.valid).toBe(true);expect(c.photoMatch).toEqual({status:'unverified',score:null});
  }
  expect(r.search.localSearch!.considered).toBeLessThanOrEqual(1024);expect(r.search.geometryChecks).toBeLessThanOrEqual(256);expect(r.search.localSearch!.deduplicated).toBeGreaterThan(0);
 });
 it('honors local subsets, parent and shared validation budgets; exhaustion never permits normal adoption',()=>{
  const {input,plan}=fixture();
  for(const options of [{maxLocalSubsets:1},{maxGeometryChecks:21},{maxLocalParents:1}]){
   const r=executeVisible3D(plan,input,options);expect(r.completeSearch).toBe(false);expect(r.status).toBe('budget_exhausted');expect(r.candidates).toEqual([]);expect(r.diagnosticCandidates!.length).toBeGreaterThan(0);expect(r.search.geometryChecks).toBeLessThanOrEqual(options.maxGeometryChecks??256);expect(r.search.localSearch!.considered).toBeLessThanOrEqual(options.maxLocalSubsets??1024);
  }
  const noLocal=executeVisible3D(plan,input,{maxLocalSubsets:0});expect(noLocal.candidates[0].coverage.reconstructed).toEqual(['tile6']);expect(noLocal.search.localSearch!.geometryChecks).toBe(0);
  expect(()=>executeVisible3D(plan,input,{maxLocalSubsets:9000})).toThrow(/预算/);
 });
 it('large coincident solid interiors still fail; independent status does not imply photo match',()=>{
  const {input,plan}=fixture(),a=executeVisible3D(plan,input).diagnosticCandidates![0].assembly;
  const overlap={...structuredClone(a),connections:[],pieces:[structuredClone(a.pieces[0]),{...structuredClone(a.pieces[0]),id:'overlap'}]};
  const report=validateAssembly3D(overlap);expect(report.valid).toBe(false);expect(assemblyValidationLayers(report).idealGeometry.valid).toBe(true);expect(assemblyValidationLayers(report).solidCollision.valid).toBe(false);
  const collisions=inspectAssemblyCollisions(overlap,report);expect(collisions[0].locality).toBe('non-contact-penetration');expect(collisions[0].penetrationDepth).toBeCloseTo(.06,10);
 });
 it('V2 replay retains old ranking and excludes V3-only metadata',()=>{
  const {input,plan}=fixture(),r=executeVisible3D(plan,input,{algorithmVersion:2});
  expect(r.version).toBe(2);expect(r.search.geometryChecks).toBe(20);expect(r.search.assignments).toBe(16);expect(r.candidates.length).toBe(1);expect(r.candidates[0].coverage.reconstructed).toEqual(['tile6']);expect(r.candidates[0].kind).toBeUndefined();expect(r.diagnosticCandidates).toBeUndefined();expect(r.diagnostics.join()).not.toContain('relatedPieceIds');
 });
});
