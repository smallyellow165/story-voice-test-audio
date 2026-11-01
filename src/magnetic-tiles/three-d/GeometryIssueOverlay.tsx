import {useEffect,useRef} from 'react'
import {useThree} from '@react-three/fiber'
import {Line} from '@react-three/drei'
import {AssemblyConnectionHighlight} from './AssemblyAnnotations.tsx'
import type {AnnotationPiece} from './AssemblyAnnotations.tsx'
import {OrthographicCamera,Vector3} from 'three'
import type {OrbitControls} from 'three-stdlib'
import {computeFitCamera,applyFitResult} from './vendor/components/magnet3d/cameraUtils.ts'
import type {GeometryIssueVisual} from './reconstruction/diagnostic-visual.ts'
export type GeometryIssueDisplayProps={geometryIssue?:GeometryIssueVisual;issueFocus?:number}
/** The same Assembly focus/fit utility, applied to the saved affected pieces.
 * Port lines have no picking surface and never alter the document. */
export function GeometryIssueOverlay({geometryIssue,issueFocus,pieces}:GeometryIssueDisplayProps&{pieces:AnnotationPiece[]}){
    const {camera,size,controls}=useThree(),last=useRef<{target:GeometryIssueVisual;sequence:number}|null>(null)
    useEffect(()=>{
        if(!geometryIssue||geometryIssue.collision?.center||issueFocus===undefined||!geometryIssue.focusVertices.length||!(camera instanceof OrthographicCamera)||!controls)return
        if(last.current?.target===geometryIssue&&last.current.sequence===issueFocus)return
        const result=computeFitCamera({camera,size,preferredView:'current',fillRatio:.6,worldVertices:geometryIssue.focusVertices.map(p=>new Vector3(...p))})
        if(result){applyFitResult(camera,result,controls as OrbitControls);last.current={target:geometryIssue,sequence:issueFocus}}
    },[geometryIssue,issueFocus,camera,size,controls])
    return <group name="geometry-issue-port-overlay">{geometryIssue?.connections.map((c,i)=><AssemblyConnectionHighlight key={i} pieces={pieces} connection={c}/>)}{!geometryIssue?.connections.length&&geometryIssue?.segments.map(s=><Line key={s.id} name="geometry-issue-port" points={s.points} color="#153f39" lineWidth={7} depthTest={false} renderOrder={102} raycast={()=>{}}/>)}</group>
}
