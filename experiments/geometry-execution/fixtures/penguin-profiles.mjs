// Deterministic interface fixtures, not photograph plans or runtime fallback data.
export function penguinProfileFixture(part) {
 if(!['11170','98223'].includes(part))throw Error('Unknown verification fixture')
 const h=part==='11170'?72:48,lower=part==='11170'?'3437':'3011',color=part==='11170'?'0':'25'
 const ids=['support','subject','cap'],parts=[lower,part,'3437'],colors=['14',color,'15']
 const input={observations:ids.map((id,i)=>({id,part:parts[i],color:colors[i],geometry:null})),inventory:parts.map((p,i)=>({part:p,color:colors[i],quantity:1}))}
 const exact=v=>({min:v,max:v})
 const plan={version:'spatial-assembly-plan-v1',scene:{method:'general_3d',cameraEvidence:'Deterministic connector verification; no image inference',depthAxisEvidence:'Fixed grid',scaleEvidence:'Official LDraw units',unknowns:[]},
  parts:ids.map((id,i)=>({id,role:'Interface verification',image:{bbox:null,features:[],occlusion:'Not applicable'},
   pose:{relativeTo:i?ids[i-1]:null,offsetLdu:{x:exact(0),y:exact(i===0?0:i===1?48:h),z:exact(0)},yawCandidates:[0],upright:true,evidence:'Nominal mating planes',confidence:1,unknowns:[]},
   connections:i?[{other:ids[i-1],intent:'mates',ownSurface:'bottom',otherSurface:'top',ownConnector:null,otherConnector:null,visibility:'inferred',evidence:'Declared test interface'}]:[]})),relations:[],alternatives:[],missingGeometry:[]}
 return {input,plan}
}
