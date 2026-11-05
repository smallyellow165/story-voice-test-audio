import {Matrix4,Quaternion,Vector3} from 'three'
import {createViewerModel} from '../viewer-model.ts'
import {pieceWorldVertices} from '../vendor/components/magnet3d/cameraUtils.ts'
import {leastSquares,linearSolve} from './least-squares.ts'
import type {Point3,Point2,RegistrationInput,RegistrationSolution,RegistrationCamera} from './contracts.ts'

const v=(p:number[])=>new Vector3(p[0],p[1],p[2])
const rot=(p:number[])=>{const a=v(p),length=a.length();return length?new Quaternion().setFromAxisAngle(a.divideScalar(length),length):new Quaternion()}
const vec=(q:Quaternion)=>{const a=2*Math.acos(Math.max(-1,Math.min(1,q.w))),s=Math.sin(a/2);return Math.abs(s)<1e-8?[0,0,0]:[q.x,q.y,q.z].map(x=>x*a/s)}
export function projectRegistrationPoint(local:Point3,delta:{position:Point3;quaternion:[number,number,number,number]},camera:RegistrationCamera):Point2{
 const p=v(local).applyQuaternion(new Quaternion(...delta.quaternion)).add(v(delta.position)).applyQuaternion(new Quaternion(...camera.worldToCamera.quaternion)).add(v(camera.worldToCamera.position))
 if(p.z<=0)throw Error('配准相机后方存在几何，不能采用')
 return [camera.focalPx*p.x/p.z+camera.principalPoint[0],camera.focalPx*p.y/p.z+camera.principalPoint[1]]
}
function bounds(points:number[][]){return [0,1].map(j=>Math.min(...points.map(p=>p[j]))).concat([0,1].map(j=>Math.max(...points.map(p=>p[j]))))}
function iou(a:number[],b:number[]){const area=(r:number[])=>Math.max(0,r[2]-r[0])*Math.max(0,r[3]-r[1]),inter=area([Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])]);return inter/(area(a)+area(b)-inter)}
const median=(a:number[])=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)]
/** The offline pinhole / yaw / shared floor model, with no target coordinates.
 * Fixed seed starts and robust loss make runs reproducible. No engine solver. */
export function fitSceneRegistration(input:RegistrationInput):RegistrationSolution{
 if(input.constraints?.length)throw Error('当前 V1 尚不求解跨成员 Connection 或已审核空间约束；已保留约束，未输出独立刚体布局')
 const members=[...input.members].sort((a,b)=>b.assembly.pieces.length-a.assembly.pieces.length||a.ref.id.localeCompare(b.ref.id)),n=members.length
 if(n<2||n>8)throw Error('V1 需要 2–8 个刚性成员')
 const anchors=members.map(m=>{const models=createViewerModel(m.assembly),points=models.flatMap(p=>p.shape.vertices.map(x=>new Vector3(x.x,x.y,0).applyQuaternion(p.transform.quaternion).add(p.transform.position))),solid=models.flatMap(p=>pieceWorldVertices(p.shape,p.transform.position,p.transform.quaternion));return new Vector3((Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.x)))/2,Math.min(...solid.map(p=>p.y)),(Math.min(...points.map(p=>p.z))+Math.max(...points.map(p=>p.z)))/2)})
 const index=new Map(members.map((m,i)=>[m.ref.id,i])),center:[number,number]=[input.image.width/2,input.image.height/2]
 const points=input.points.filter((p,i,a)=>a.findIndex(q=>q.memberId===p.memberId&&JSON.stringify(q.local)===JSON.stringify(p.local)&&JSON.stringify(q.pixel)===JSON.stringify(p.pixel))===i)
 if(points.length<10||members.some(m=>points.filter(p=>p.memberId===m.ref.id).length<4||input.boxes.filter(b=>b.memberId===m.ref.id).length<3))throw Error('可用二维—三维边段不足；V1 需要每个成员至少 4 个端点、3 个 Tile BBox')
 const xyz=points.map(p=>v(p.local).sub(anchors[index.get(p.memberId)!]).toArray()),uv=points.map(p=>p.pixel)
 const rows=points.flatMap((p,i)=>index.get(p.memberId)===0?[[...xyz[i],1]]:[]),target=points.flatMap((p,i)=>index.get(p.memberId)===0?[uv[i]]:[])
 const normal=Array.from({length:4},(_,j)=>Array.from({length:4},(_,k)=>rows.reduce((s,r)=>s+r[j]*r[k],0)))
 const coef=[0,1].map(j=>linearSolve(normal,Array.from({length:4},(_,k)=>rows.reduce((s,r,i)=>s+r[k]*target[i][j],0))))
 const row0=v(coef[0]).normalize(),row1=v(coef[1]).addScaledVector(row0,-v(coef[1]).dot(row0)).normalize(),row2=row0.clone().cross(row1),matrix=new Matrix4().set(row0.x,row0.y,row0.z,0,row1.x,row1.y,row1.z,0,row2.x,row2.y,row2.z,0,0,0,0,1),q0=new Quaternion().setFromRotationMatrix(matrix),scale=(v(coef[0]).length()+v(coef[1]).length())/2
 function transform(i:number,p:number[]){return {q:i?new Quaternion().setFromAxisAngle(new Vector3(0,1,0),p[6+i]):new Quaternion(),t:i?new Vector3(p[7+n-1+2*(i-1)],0,p[8+n-1+2*(i-1)]):new Vector3()}}
 function project(local:number[],i:number,p:number[]){const {q,t}=transform(i,p),cam=v(local).applyQuaternion(q).add(t).applyQuaternion(rot(p)).add(v(p.slice(3,6))),z=Math.max(.1,cam.z),f=Math.exp(p[6]);return [f*cam.x/z+center[0],f*cam.y/z+center[1]]}
 const edgeResidual=(p:number[])=>points.flatMap((pt,j)=>project(xyz[j],index.get(pt.memberId)!,p).map((x,k)=>x-uv[j][k]))
 const boxResidual=(p:number[])=>input.boxes.flatMap(b=>{const i=index.get(b.memberId)!,bb=bounds(b.local.map(x=>project(v(x).sub(anchors[i]).toArray(),i,p)));return bb.map((x,j)=>x-b.pixel[j])})
 const valid=(p:number[])=>p.every(Number.isFinite)&&p[5]>2&&p[5]<1000&&p[6]>Math.log(150)&&p[6]<Math.log(20000)&&p.slice(7,7+n-1).every(x=>Math.abs(x)<Math.PI)&&p.slice(7+n-1).every(x=>Math.abs(x)<100)
 function initial(f:number,seed:number){
  const p=[...vec(q0),(coef[0][3]-center[0])/scale,(coef[1][3]-center[1])/scale,f/scale,...[Math.log(f)],...Array(n-1).fill(0),...Array(2*(n-1)).fill(0)]
  for(let i=1;i<n;i++){
   const ids=points.map((pt,j)=>index.get(pt.memberId)===i?j:-1).filter(j=>j>=0),inter=[0,1].map(k=>ids.reduce((s,j)=>s+uv[j][k]-xyz[j].reduce((s,x,a)=>s+x*coef[k][a],0),0)/ids.length-coef[k][3]),j=[[coef[0][0],coef[0][2]],[coef[1][0],coef[1][2]]],xz=linearSolve(j,inter)
   p[6+i]=seed?Math.sin(seed*13+i)*.25:0;p[7+n-1+2*(i-1)]=xz[0]+(seed?Math.sin(seed+i)*.3:0);p[8+n-1+2*(i-1)]=xz[1]+(seed?Math.cos(seed+i)*.3:0)
  }
  return p
 }
 const starts=Array.from({length:6},(_,i)=>leastSquares(edgeResidual,initial([700,1400,5000][i%3],i),valid)).sort((a,b)=>a.cost-b.cost),p=starts[0].p
 const cross=leastSquares(boxResidual,p,valid),res=edgeResidual(p),crossRes=edgeResidual(cross.p),rmse=Math.sqrt(res.reduce((s,x)=>s+x*x,0)/points.length),crossRmse=Math.sqrt(crossRes.reduce((s,x)=>s+x*x,0)/points.length)
 for(const alternative of starts.slice(1))if(alternative.cost<=starts[0].cost+Math.max(3,points.length*.25)){
  for(let i=1;i<n;i++){const a=transform(i,p),b=transform(i,alternative.p);if(a.q.angleTo(b.q)>Math.PI/12||a.t.distanceTo(b.t)>1)throw Error('存在误差相近但空间布局不同的解；V1 无法可靠采用，请补充对应证据')}
 }
 const overlap=median(input.boxes.map(b=>{const i=index.get(b.memberId)!;return iou(bounds(b.local.map(x=>project(v(x).sub(anchors[i]).toArray(),i,p))),b.pixel)})),limit=Math.max(4,Math.hypot(input.image.width,input.image.height)*.007)
 if(rmse>limit||crossRmse>limit*1.5||overlap<.65)throw Error(`配准证据不一致：边段 RMSE ${rmse.toFixed(2)} px，BBox 交叉验证 ${crossRmse.toFixed(2)} px，IoU ${overlap.toFixed(2)}；未生成可采用布局`)
 const groups=members.map((m,i)=>{const ids=points.flatMap((pt,j)=>pt.memberId===m.ref.id?[j]:[]),pointRmsePx=Math.sqrt(ids.reduce((s,j)=>s+res[j*2]**2+res[j*2+1]**2,0)/ids.length);if(pointRmsePx>limit*1.5)throw Error('某个 Group 的照片匹配误差过大');const a=transform(i,p),b=transform(i,cross.p);if(a.q.angleTo(b.q)>Math.PI/12||a.t.distanceTo(b.t)>Math.max(1,anchors[i].length()*.3))throw Error('边段与 BBox 拟合存在不同布局，不能可靠采用');return {memberId:m.ref.id,pointRmsePx,relativeYawDeg:i?p[6+i]*180/Math.PI:0}})
 // Anchors use actual solid bottoms, including versioned Profile thickness.
 const shift=new Vector3(),cameraQ=rot(p),cameraT=v(p.slice(3,6))
 const solution:RegistrationSolution={solver:'upright-common-ground-v1',camera:{kind:'pinhole',focalPx:Math.exp(p[6]),principalPoint:center,worldToCamera:{position:cameraT.toArray(),quaternion:cameraQ.toArray()}},transforms:members.map((m,i)=>{const {q,t}=transform(i,p);return {memberId:m.ref.id,delta:{position:t.sub(anchors[i].clone().applyQuaternion(q)).add(shift).toArray(),quaternion:q.toArray()}}}),quality:{pointRmsePx:rmse,bboxCrosscheckPointRmsePx:crossRmse,medianTileBBoxIoU:overlap,groups},assumptions:['V1 假设成员竖直、共用地面；仅优化绕竖直轴旋转与地面平移。','针孔相机、图片中心主点、无畸变；尺寸单位来自固定 Profile。','边段对应采用当前准确 Plan 的方向证据；对称补全片没有新增照片观测。'],warnings:['近似照片匹配，不是唯一三维测量；真实深度、相机标定及对称身份仍有不确定性。']}
 for(const m of members){const delta=solution.transforms.find(t=>t.memberId===m.ref.id)!.delta;for(const p of createViewerModel(m.assembly))for(const x of p.shape.vertices)projectRegistrationPoint(new Vector3(x.x,x.y,0).applyQuaternion(p.transform.quaternion).add(p.transform.position).toArray(),delta,solution.camera)}
 return solution
}
