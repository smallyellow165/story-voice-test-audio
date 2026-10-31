import {useMemo,useEffect} from 'react'
import {DoubleSide,EdgesGeometry,ExtrudeGeometry,Shape,MeshBasicMaterial,LineBasicMaterial} from 'three'
import {shapeOutline} from './vendor/engine/outline.ts'
import type {ViewerPiece} from './viewer-model.ts'

/** Presentation only: exact profile/pose/thickness, neutral translucent solids.
 * No picking surface, authoring state, alternative solver or geometry adjustment.
 */
function PreviewPiece({piece}:{piece:ViewerPiece}){
 const geometry=useMemo(()=>{
  const outline=shapeOutline(piece.shape),shape=new Shape();outline.forEach((v,i)=>i?shape.lineTo(v.x,v.y):shape.moveTo(v.x,v.y));shape.closePath()
  return new ExtrudeGeometry(shape,{depth:piece.shape.thickness,bevelEnabled:false,steps:1}).translate(0,0,-piece.shape.thickness/2)
 },[piece.shape])
 const edges=useMemo(()=>new EdgesGeometry(geometry),[geometry])
 const materials=useMemo(()=>({surface:new MeshBasicMaterial({color:'#879994',side:DoubleSide,transparent:true,opacity:.25,depthWrite:false}),line:new LineBasicMaterial({color:'#566e66',transparent:true,opacity:.85})}),[])
 useEffect(()=>()=>{materials.surface.dispose();materials.line.dispose()},[materials])
 useEffect(()=>()=>{edges.dispose();geometry.dispose()},[geometry,edges])
 return <group position={piece.transform.position} quaternion={piece.transform.quaternion} dispose={null} name={`symmetry-preview-${piece.id}`}>
  <mesh geometry={geometry} material={materials.surface} raycast={()=>{}}/>
  <lineSegments geometry={edges} material={materials.line} raycast={()=>{}}/>
 </group>
}
export function AssemblyPreviewOverlay({pieces}:{pieces:ViewerPiece[]}){return <group name="assembly-symmetry-preview">{pieces.map(p=><PreviewPiece key={p.id} piece={p}/>)}</group>}
