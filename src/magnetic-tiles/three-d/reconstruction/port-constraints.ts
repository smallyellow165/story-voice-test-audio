import {Quaternion,Vector3} from 'three';
import {createShapeCatalog,profileKey3D} from '../profile-adapter.ts';
import {inspectPortCompatibility} from '../vendor/engine/port-compatibility.ts';
import {computeTransformFromConnection} from '../vendor/engine/solver.ts';
import type {Connection,PieceTransform} from '../vendor/engine/types.ts';
import type {ConnectionHypothesis3D,VisibleInput3D} from './contracts.ts';

/** Low-cost proof only: a shared port with unknown pose is NOT a conflict.
 * Exhaust finite angle/flip alternatives in a local hinge frame. Nonzero angle
 * intervals are deferred, not sampled and then mislabeled impossible. */
export function hypothesisPortConflicts(cs:ConnectionHypothesis3D[],input:VisibleInput3D){
  const catalog=createShapeCatalog(input.profiles),shape=(id:string)=>{
    const p=input.review.pieces.find(p=>p.id===id);
    return p?.profileId?catalog.get(profileKey3D({id:p.profileId,version:p.profileVersion!}))?.shape:undefined;
  };
  const groups=new Map<string,{pieceId:string;portId:string;indices:number[]}>();
  cs.forEach((c,i)=>{if(c.intent==='separate'||!c.portA||!c.portB||!c.angles.length&&!c.angleRange)return;
    for(const [pieceId,portId]of [[c.pieceA,c.portA],[c.pieceB,c.portB]]){const key=JSON.stringify([pieceId,portId]),g=groups.get(key)??{pieceId,portId,indices:[]};g.indices.push(i);groups.set(key,g);}
  });
  const domain=(c:ConnectionHypothesis3D):Connection[]|null=>c.angleRange&&c.angleRange.min!==c.angleRange.max?null:
    [...new Set([...c.angles,...(c.angleRange?[c.angleRange.min]:[])])].flatMap(dihedralDeg=>(c.flip===null?[false,true]:[c.flip]).map(flip=>({pieceA:c.pieceA,pieceB:c.pieceB,portA:c.portA!,portB:c.portB!,dihedralDeg,flip})));
  const conflicts:{port:string;pairs:string[]}[]=[],unverifiedPorts=new Set<string>();
  const pair=(c:ConnectionHypothesis3D)=>[c.pieceA,c.pieceB].sort().join('|');
  for(const g of groups.values())for(let i=0;i<g.indices.length;i++)for(let j=i+1;j<g.indices.length;j++){
    const x=cs[g.indices[i]],y=cs[g.indices[j]],dx=domain(x),dy=domain(y),port=`${g.pieceId}:${g.portId}`;
    if(!dx?.length||!dy?.length||dx.length*dy.length>324){unverifiedPorts.add(port);continue;}
    let allConflict=true;
    for(const a of dx)for(const b of dy){
      const anchor={position:new Vector3(),quaternion:new Quaternion()},transforms:Record<string,PieceTransform>={[g.pieceId]:anchor};
      for(const c of [a,b]){
        const isA=c.pieceA===g.pieceId,id=isA?c.pieceB:c.pieceA,base=shape(g.pieceId),attached=shape(id);
        const tf=base&&attached&&computeTransformFromConnection(anchor,base,isA?c.portA:c.portB,attached,isA?c.portB:c.portA,isA||c.flip?c.dihedralDeg:-c.dihedralDeg,c.flip??false);
        if(tf)transforms[id]=tf;
      }
      if(inspectPortCompatibility([a,b],shape,transforms).status!=='conflict')allConflict=false;
    }
    if(allConflict)conflicts.push({port,pairs:[pair(x),pair(y)].sort()});
    else unverifiedPorts.add(port); // no global pose/closure verification yet
  }
  return {conflicts,unverifiedPorts:[...unverifiedPorts].sort()};
}
