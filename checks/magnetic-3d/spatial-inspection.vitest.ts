import {afterEach,describe,expect,it} from 'vitest'
import {Box3,Euler,Matrix4,Quaternion,Vector3} from 'three'
import {parseAssembly3D,serializeAssembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
import {combineAssemblySnapshots,moduleBounds,moduleCenter,moduleStep,moduleBoundsAlignment,previewModuleBoundsAlign,confirmModulePreview,previewModuleSnap} from '../../src/magnetic-tiles/three-d/module-transform.ts'
import {createViewerModel} from '../../src/magnetic-tiles/three-d/viewer-model.ts'
import {createFrameGeometry,disposeMagnet3DCaches} from '../../src/magnetic-tiles/three-d/vendor/components/magnet3d/primitives.tsx'
import {arrangeAssemblyDisplays,displayAnnotationPieces} from '../../src/magnetic-tiles/three-d/multi-assembly-display.ts'
import * as history from '../../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import pair from '../../src/magnetic-tiles/three-d/examples/right-angle.json' with {type:'json'}
import mixed from '../../src/magnetic-tiles/three-d/examples/mixed-profiles.json' with {type:'json'}

const parent=(id:string)=>({id,version:1,hash:'a'.repeat(64),snapshotHash:'b'.repeat(64),revision:0})
function combined(){return combineAssemblySnapshots('bounds-test',['A','B','C'].map(name=>({name,parent:parent(name),assembly:parseAssembly3D(JSON.stringify(pair))})))}
function ids(a:ReturnType<typeof combined>,id:string){return new Set(a.modules!.find(m=>m.id===id)!.pieces.map(p=>p.id))}
function coordinate(box:Box3,mode:'min'|'center'|'max',axis:'x'|'y'|'z'){return (mode==='center'?box.getCenter(new Vector3()):box[mode])[axis]}
afterEach(()=>disposeMagnet3DCaches())

describe('one solid world bounds definition for inspection, pivot and alignment',()=>{
 it('includes scaled Profile extents and thickness under arbitrary rotation, rather than just Tile centers',()=>{
  const single=parseAssembly3D(JSON.stringify(pair));single.pieces=single.pieces.slice(0,1);single.connections=[]
  single.profiles[0].profile.vertices=[[0,0],[2,0],[2,.5],[0,.5]];single.profiles[0].scale=1.7;single.profiles[0].thickness=.16
  const q=new Quaternion().setFromEuler(new Euler(.43,-.81,.35)),position=new Vector3(10,-3,5)
  single.pieces[0].pose={position:position.toArray(),quaternion:q.toArray()}
  const a=combineAssemblySnapshots('rect',[{name:'A',parent:parent('a'),assembly:single},{name:'B',parent:parent('b'),assembly:single}]),raw=serializeAssembly3D(a),b=moduleBounds(a,'module-1')
  const r=new Matrix4().makeRotationFromQuaternion(q).elements,half=[1.7,.425,.136]
  for(const [i,axis] of (['x','y','z'] as const).entries()){
   const extent=Math.abs(r[i])*half[0]+Math.abs(r[i+4])*half[1]+Math.abs(r[i+8])*half[2]
   expect(b.min[axis]).toBeCloseTo(position[axis]-extent,12);expect(b.max[axis]).toBeCloseTo(position[axis]+extent,12)
  }
  expect(moduleCenter(a,'module-1').distanceTo(position)).toBeLessThan(1e-12)
  expect(serializeAssembly3D(a)).toBe(raw)
 })
 it('matches rendered outer solid vertices for rotated mixed profiles and never changes to Local coordinates',()=>{
  const source=parseAssembly3D(JSON.stringify(mixed));source.connections=[]
  source.profiles.forEach((p,i)=>{p.scale=1.25+i*.17})
  let a=combineAssemblySnapshots('mixed-bounds',[{name:'A',parent:parent('a'),assembly:source},{name:'B',parent:parent('b'),assembly:source}])
  a=moduleStep(moduleStep(moduleStep(a,'module-1','rotate','y',36,'global'),'module-1','rotate','x',17,'local'),'module-1','translate','z',2.4,'face',a.modules![1].pieces[0].id)
  const box=new Box3(),members=ids(a,'module-1')
  for(const p of createViewerModel(a).filter(p=>members.has(p.id))){
   const mesh=createFrameGeometry(p.shape).clone().applyMatrix4(new Matrix4().compose(p.transform.position,p.transform.quaternion,new Vector3(1,1,1)))
   mesh.computeBoundingBox();box.union(mesh.boundingBox!);mesh.dispose()
  }
  const actual=moduleBounds(a,'module-1')
  for(const axis of ['x','y','z'] as const){expect(actual.min[axis]).toBeCloseTo(box.min[axis],6);expect(actual.max[axis]).toBeCloseTo(box.max[axis],6)}
  expect(moduleCenter(a,'module-1').toArray()).toEqual(actual.getCenter(new Vector3()).toArray())
 })
 it('does not read transient read-only display offsets or offset meshes',()=>{
  const a=combined(),raw=serializeAssembly3D(a),before=moduleBounds(a,'module-1'),display=arrangeAssemblyDisplays(a,[{id:'other',name:'Other',snapshotHash:'a',assembly:a}])
  expect(display[0].offset.some(v=>v!==0)).toBe(true)
  const shown=displayAnnotationPieces(display);shown.forEach(p=>p.transform.position.addScalar(1000))
  expect(moduleBounds(a,'module-1')).toEqual(before);expect(serializeAssembly3D(a)).toBe(raw)
 })
})

describe('one-shot Bounds Align',()=>{
 for(const axis of ['x','y','z'] as const)for(const mode of ['min','center','max'] as const)it(`${axis.toUpperCase()} ${mode}: preview, exact one-axis translation, history and zero-delta no-op`,()=>{
  let a=moduleStep(combined(),'module-1','rotate','z',31,'global')
  for(const other of ['x','y','z'] as const)a=moduleStep(a,'module-1','translate',other,3.27,'global')
  const raw=serializeAssembly3D(a),moving=ids(a,'module-1'),alignment=moduleBoundsAlignment(a,'module-1','module-0',axis,mode),preview=previewModuleBoundsAlign(a,'module-1','module-0',axis,mode)
  expect(alignment.delta).not.toBe(0);expect(preview.boundsAlignment).toEqual(alignment);expect(preview.connection).toBeUndefined();expect(serializeAssembly3D(a)).toBe(raw)
  const h=history.commit(history.createInitialHistory(a),()=>confirmModulePreview(a,preview)),next=h.current
  expect(coordinate(moduleBounds(next,'module-1'),mode,axis)).toBeCloseTo(coordinate(moduleBounds(a,'module-0'),mode,axis),11)
  expect(next.connections).toEqual(a.connections)
  next.pieces.forEach((p,i)=>{
   const old=a.pieces[i];expect(p.pose.quaternion).toEqual(old.pose.quaternion)
   if(!moving.has(p.id)){expect(p).toEqual(old);return}
   for(const d of ['x','y','z'] as const){const index={x:0,y:1,z:2}[d];expect(p.pose.position[index]).toBeCloseTo(old.pose.position[index]+(d===axis?alignment.delta:0),12)}
  })
  for(const id of ['module-0','module-2'])expect(next.modules!.find(m=>m.id===id)).toEqual(a.modules!.find(m=>m.id===id))
  expect(next.modules!.map(({frame,...m})=>m)).toEqual(a.modules!.map(({frame,...m})=>m))
  expect(history.undo(h).current).toEqual(a);expect(history.redo(history.undo(h)).current).toEqual(next)
  const zero=previewModuleBoundsAlign(next,'module-1','module-0',axis,mode)
  expect(zero.boundsAlignment!.delta).toBe(0);expect(zero.assembly).toEqual(next)
  expect(history.commit(h,()=>confirmModulePreview(next,zero))).toBe(h)
  expect(()=>confirmModulePreview(next,preview)).toThrow(/过期/)
 })
 it('rejects self-alignment and cannot silently break an existing cross-Group Connection',()=>{
  const single=parseAssembly3D(JSON.stringify(pair));single.connections=[];single.pieces=single.pieces.slice(0,1)
  const a=combineAssemblySnapshots('joined',[{name:'A',parent:parent('a'),assembly:single},{name:'B',parent:parent('b'),assembly:single}])
  expect(()=>moduleBoundsAlignment(a,'module-1','module-1','y','min')).toThrow(/不同/)
  expect(()=>moduleBounds(a,'unknown')).toThrow(/请选择/)
  const snap=previewModuleSnap(a,'module-1','module-0',{pieceA:a.modules![0].pieces[0].id,pieceB:a.modules![1].pieces[0].id,portA:'e1-p0',portB:'e3-p0',dihedralDeg:0,flip:true})
  const joined=confirmModulePreview(a,snap),raw=serializeAssembly3D(joined),preview=previewModuleBoundsAlign(joined,'module-1','module-0','x','center')
  expect(()=>confirmModulePreview(joined,preview)).toThrow(/连接验证失败/);expect(serializeAssembly3D(joined)).toBe(raw)
 })
})
