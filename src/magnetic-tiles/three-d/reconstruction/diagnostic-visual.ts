import {Vector3} from 'three'
import type {Assembly3D} from '../assembly.ts'
import type {ValidationIssue,Connection} from '../vendor/engine/types.ts'
import {createViewerModel} from '../viewer-model.ts'
import {pieceWorldVertices} from '../vendor/components/magnet3d/cameraUtils.ts'
import {collisionPairKey,collisionVisual} from '../collision-visual.ts'
import type {CollisionEvidence,CollisionVisual} from '../collision-visual.ts'
type Point=[number,number,number]
export type GeometryIssueVisual={pieceIds:string[];connectionIndices:number[];connections:Connection[];segments:{id:string;points:[Point,Point]}[];focusVertices:Point[];note:string;collision?:CollisionVisual}

/** Resolve ONLY structured report references and the saved connection graph.
 * No message parsing, solving, validation or new error taxonomy. */
export function geometryIssueReferences(assembly:Assembly3D,issue:ValidationIssue){
    const ids=new Set([issue.pieceId,...issue.relatedPieceIds??[]].filter((id):id is string=>!!id&&assembly.pieces.some(p=>p.id===id)))
    const indices=new Set<number>()
    if(Number.isInteger(issue.connectionIndex)&&assembly.connections[issue.connectionIndex!])indices.add(issue.connectionIndex!)
    if(issue.pieceId&&issue.portId)assembly.connections.forEach((c,i)=>{if(c.pieceA===issue.pieceId&&c.portA===issue.portId||c.pieceB===issue.pieceId&&c.portB===issue.portId)indices.add(i)})
    if(issue.code==='unconnected'&&!ids.size&&assembly.pieces.length){
        const connected=new Set([assembly.pieces[0].id]),queue=[assembly.pieces[0].id]
        while(queue.length){const id=queue.shift()!;for(const c of assembly.connections){const next=c.pieceA===id?c.pieceB:c.pieceB===id?c.pieceA:null;if(next&&!connected.has(next)){connected.add(next);queue.push(next)}}}
        // Same anchor as the Validator; highlight all non-anchor components.
        assembly.pieces.filter(p=>!connected.has(p.id)).forEach(p=>ids.add(p.id))
    }
    for(const i of indices){const c=assembly.connections[i];for(const id of [c.pieceA,c.pieceB])if(assembly.pieces.some(p=>p.id===id))ids.add(id)}
    return {pieceIds:[...ids],connectionIndices:[...indices]}
}
export function geometryIssueVisual(assembly:Assembly3D,issue:ValidationIssue,collisions:readonly CollisionEvidence[],sourceKey:string):GeometryIssueVisual{
    const refs=geometryIssueReferences(assembly,issue),result:GeometryIssueVisual={...refs,connections:refs.connectionIndices.map(i=>assembly.connections[i]),segments:[],focusVertices:[],note:refs.pieceIds.length?'仅定位存档能确定的零件／端口，不代表精确错误体积。':'存档没有足够的结构化位置数据；仅展示错误说明。'}
    try{
        const pieces=createViewerModel(assembly),seen=new Set<string>()
        function port(pieceId:string,portId?:string,edgeId?:string){
            const p=pieces.find(p=>p.id===pieceId);if(!p)return
            const connector=p.shape.ports.find(port=>port.portId===portId),edge=connector?null:p.shape.edges.find(edge=>edge.edgeId===edgeId)
            if(!connector&&!edge)return
            const id=JSON.stringify([pieceId,connector?.portId??edge?.edgeId]);if(seen.has(id))return;seen.add(id)
            const world=(v:{x:number;y:number}):Point=>new Vector3(v.x,v.y,0).applyQuaternion(p.transform.quaternion).add(p.transform.position).toArray()
            result.segments.push({id,points:[world(connector?.p0??edge!.v0),world(connector?.p1??edge!.v1)]})
        }
        if(issue.pieceId)port(issue.pieceId,issue.portId,issue.edgeId)
        for(const i of refs.connectionIndices){const c:Connection=assembly.connections[i];port(c.pieceA,c.portA);port(c.pieceB,c.portB)}
        result.focusVertices=pieces.filter(p=>refs.pieceIds.includes(p.id)).flatMap(p=>pieceWorldVertices(p.shape,p.transform.position,p.transform.quaternion).map(v=>v.toArray()))
    }catch{/* Malformed/absent Profile/Pose cannot be given an invented location. */}
    if(issue.code==='intersection'&&issue.relatedPieceIds){
        const evidence=collisions.find(e=>collisionPairKey(e.pieceIds)===collisionPairKey(issue.relatedPieceIds!))
        if(evidence){const visual=collisionVisual(evidence,sourceKey);if(visual.kind!=='unavailable')result.collision=visual;result.note=visual.reason}
        else result.note='存档未保留该碰撞的交集坐标；仅定位相关零件，不补造碰撞区域。'
    }
    return result
}
