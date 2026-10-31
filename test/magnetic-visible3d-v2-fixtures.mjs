import {visibleFixture} from './magnetic-visible3d-fixtures.mjs'
// Synthetic contract fixture only. Does not represent real Vision accuracy.
export function upgradeVisibleFixture(f){
 const evidence=structuredClone(f.evidence),ids=new Set(evidence.observations.map(o=>o.id))
 evidence.version=2
 evidence.observations.forEach(o=>o.shapeAssessment={family:'square',alternativeFamilies:['rectangle'],evidence:'Synthetic foreshortened quadrilateral with coherent neighboring edges',perspectiveUncertainty:'Camera uncalibrated',exactProfileUncertainty:'Exact physical size not measured; Catalog choice requires review'})
 const understanding={camera:{viewpoint:'above',evidence:'Synthetic top and side panels',uncertainty:'No camera calibration'},faces:evidence.observations.map((o,i)=>({pieceId:o.id,orientation:i?'vertical':'horizontal',evidenceRefs:[o.id],reasoning:'Synthetic global face arrangement',uncertainty:'Qualitative only'})),connections:f.plan.connections.map(c=>({pieceA:c.pieceA,pieceB:c.pieceB,featureA:evidence.observations.find(o=>o.id===c.pieceA)?.features[0]?.id??null,featureB:evidence.observations.find(o=>o.id===c.pieceB)?.features[0]?.id??null,relationship:'shared_edge',foldAngleCandidatesDeg:[90],angleRange:null,evidenceRefs:[c.pieceA,c.pieceB],reasoning:'Synthetic shared perimeter, not internal decoration',uncertainty:'Visual sign not calibrated to port basis'})),overallShapeHypotheses:[{label:'A local folded corner',visiblePieceIds:[...ids],evidenceRefs:[...ids],reasoning:'Visible panels form a coherent local structure',uncertainty:'Whole structure is not established'}],hiddenStructureHypotheses:[{description:'Other faces might exist outside view',reasoning:'Possible enclosure interpretation only',uncertainty:'No invisible panels are confirmed or executable'}],alternatives:[{label:'Open shell',description:'The visible panels alone may be the entire structure',evidenceRefs:[...ids],uncertainty:'Hidden extent unknown'}],unknowns:['Absolute scale unknown']}
 evidence.spatialInterpretation=structuredClone(understanding)
 const plan={...structuredClone(f.plan),version:2,spatialInterpretation:structuredClone(understanding)},input={...structuredClone(f.input),evidence}
 return {...f,evidence,plan,input}
}
export async function visibleV2Fixture(){
 const f=await visibleFixture('closed-cube'),ids=new Set(['top','front','right'])
 f.assembly.pieces=f.assembly.pieces.filter(p=>ids.has(p.id));f.assembly.connections=f.assembly.connections.filter(c=>ids.has(c.pieceA)&&ids.has(c.pieceB))
 f.evidence.observations=f.evidence.observations.filter(p=>ids.has(p.id));f.review.pieces=f.review.pieces.filter(p=>ids.has(p.id));f.plan.parts=f.plan.parts.filter(p=>ids.has(p.id));f.plan.connections=f.plan.connections.filter(c=>ids.has(c.pieceA)&&ids.has(c.pieceB))
 return upgradeVisibleFixture(f)
}
