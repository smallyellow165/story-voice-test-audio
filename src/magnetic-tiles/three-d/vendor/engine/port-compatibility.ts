// Local extension of the MIT 3D_Magnetic_Pieces engine. See third_party/3D_Magnetic_Pieces/PATCHES.md.
import {Vector3} from 'three';
import {getPort} from './shapes.ts';
import type {Connection,PieceTransform,ShapeDef} from './types.ts';

export type PortConflict = {
  pieceId:string;portId:string;edgeId?:string;connectionIndices:number[];
  relatedPieceIds:[string,string];reason:'duplicate-connection'|'same-direction';
};
/** A pair of actual ports, independent of declaration direction, angle or flip.
 * Declaring that same joint twice is not an additional spatial attachment. */
export function portPairKey(c:Pick<Connection,'pieceA'|'pieceB'|'portA'|'portB'>):string {
  return JSON.stringify([[c.pieceA,c.portA],[c.pieceB,c.portB]].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

/** Only tests shared-port occupancy. This never replaces endpoint, length,
 * signed-angle, loop or solid collision validation. No thickness compensation.
 * CCW profiles occupy the left half-plane of each directed boundary edge.
 * Their world inward rays distinguish opposite coplanar panels from overlays.
 * Missing/misaligned frames remain unverified, never proof of compatibility. */
export function inspectPortCompatibility(
  connections:readonly Connection[],getShape:(id:string)=>ShapeDef|undefined,
  transforms:Readonly<Record<string,PieceTransform>>,
):{status:'compatible'|'conflict'|'unverified';conflicts:PortConflict[];unverifiedPorts:string[]} {
  const groups=new Map<string,{pieceId:string;portId:string;indices:number[]}>();
  connections.forEach((c,index)=>{
    for(const [pieceId,portId]of [[c.pieceA,c.portA],[c.pieceB,c.portB]]){
      const key=JSON.stringify([pieceId,portId]),group=groups.get(key)??{pieceId,portId,indices:[]};
      group.indices.push(index);groups.set(key,group);
    }
  });
  function frame(id:string,portId:string){
    const shape=getShape(id),port=shape&&getPort(shape,portId),tf=transforms[id];
    if(!port||!tf)return null;
    const p0=new Vector3(port.p0.x,port.p0.y,0).applyQuaternion(tf.quaternion).add(tf.position);
    const p1=new Vector3(port.p1.x,port.p1.y,0).applyQuaternion(tf.quaternion).add(tf.position);
    const local=new Vector3(port.p1.x-port.p0.x,port.p1.y-port.p0.y,0);
    const inward=new Vector3(-local.y,local.x,0).normalize().applyQuaternion(tf.quaternion);
    if(![...p0.toArray(),...p1.toArray(),...inward.toArray()].every(Number.isFinite)||local.lengthSq()<1e-20)return null;
    return {p0,p1,inward,edgeId:port.edgeId};
  }
  const conflicts:PortConflict[]=[],unverifiedPorts:string[]=[];
  for(const {pieceId,portId,indices}of groups.values()){
    if(indices.length<2)continue;
    const own=frame(pieceId,portId),label=`${pieceId}:${portId}`;
    const occupants:{id:string;index:number;ray:Vector3}[]=own?[{id:pieceId,index:-1,ray:own.inward}]:[];
    let pending=!own;
    const report=(reason:PortConflict['reason'],ids:[string,string],is:number[])=>conflicts.push({pieceId,portId,edgeId:own?.edgeId,reason,relatedPieceIds:ids,connectionIndices:[...new Set(is)].filter(i=>i>=0)});
    for(let i=0;i<indices.length;i++){
      const index=indices[i],c=connections[index];
      for(const previous of indices.slice(0,i))if(portPairKey(c)===portPairKey(connections[previous]))report('duplicate-connection',[c.pieceA,c.pieceB],[previous,index]);
      const isA=c.pieceA===pieceId,otherId=isA?c.pieceB:c.pieceA,other=frame(otherId,isA?c.portB:c.portA);
      if(!own||!other){pending=true;continue;}
      const a=c.flip?other.p1:other.p0,b=c.flip?other.p0:other.p1;
      // Use the existing validator's endpoint/direction tolerances solely to
      // establish the shared axis. Residual validation still checks the joint.
      const axis=own.p1.clone().sub(own.p0).normalize(),otherAxis=b.clone().sub(a).normalize();
      if((own.p0.distanceTo(a)+own.p1.distanceTo(b))/2>.01||axis.dot(otherAxis)<.999){pending=true;continue;}
      const ray=other.inward.clone().addScaledVector(axis,-other.inward.dot(axis)).normalize();
      for(const previous of occupants){
        if(previous.id===otherId)continue; // duplicate declarations handled above
        if(previous.ray.dot(ray)>0&&new Vector3().crossVectors(previous.ray,ray).length()<1e-6){
          report('same-direction',[previous.id,otherId],[previous.index,index]);
        }
      }
      occupants.push({id:otherId,index,ray});
    }
    if(pending)unverifiedPorts.push(label);
  }
  return {status:conflicts.length?'conflict':unverifiedPorts.length?'unverified':'compatible',conflicts,unverifiedPorts};
}
