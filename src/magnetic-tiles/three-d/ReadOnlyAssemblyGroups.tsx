import {useEffect} from 'react'
import {MagnetPieceMesh,disposeShapeResources} from './vendor/components/magnet3d/primitives.tsx'
import {displayPieceKey,EMPTY_ASSEMBLY_DISPLAYS} from './multi-assembly-display.ts'
import type {MultiAssemblyDisplayProps} from './multi-assembly-display.ts'

/** Same meshes and Canvas as the editor, without ports, graph or edit callbacks. */
export function ReadOnlyAssemblyGroups({readOnlyAssemblies=EMPTY_ASSEMBLY_DISPLAYS,onInspectAssemblyPiece,readOnlySelection}:MultiAssemblyDisplayProps){
 useEffect(()=>()=>disposeShapeResources([...new Set(readOnlyAssemblies.flatMap(a=>a.pieces.map(p=>p.shape)))]),[readOnlyAssemblies])
 return <>{readOnlyAssemblies.map(a=><group key={a.id} name={`assembly-display-${a.id}`} position={a.offset} userData={{assemblyId:a.id,readOnly:true}}>
  {a.pieces.map(p=><group key={p.id} userData={{assemblyId:a.id,pieceId:p.id,tileId:displayPieceKey(a.id,p.id)}}>
   <MagnetPieceMesh shape={p.shape} transform={p.transform} color={p.color} opacity={.65} selected={readOnlySelection?.assemblyId===a.id&&readOnlySelection.pieceId===p.id}
    onClick={e=>{e.stopPropagation();if(e.delta<=3)onInspectAssemblyPiece?.(a.id,p.id)}}/>
  </group>)}
 </group>)}</>
}
