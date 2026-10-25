// Deterministic developer fixture, not a model result or a historical Analysis.
export function curvedBottomFixture() {
 const ids=['lower','curved','upper'],parts=['3437','98224','3437']
 const input={inventory:[{part:'3437',color:'4',quantity:2},{part:'98224',color:'15',quantity:1}],
  observations:ids.map((id,i)=>({id,part:parts[i],color:i===1?'15':'4',geometry:null}))}
 const exact=v=>({min:v,max:v})
 const plan={version:'spatial-assembly-plan-v1',scene:{method:'general_3d',cameraEvidence:'Deterministic fixture; no photograph inference',depthAxisEvidence:'Fixed grid',scaleEvidence:'Official LDraw LDU',unknowns:[]},
  parts:ids.map((id,i)=>({id,role:'Interface verification',image:{bbox:null,features:[],occlusion:'Not applicable'},
   pose:{relativeTo:i?ids[i-1]:null,offsetLdu:{x:exact(0),y:exact(i?48:0),z:exact(0)},yawCandidates:[0],upright:true,evidence:'Developer fixture at nominal contact planes',confidence:1,unknowns:[]},
   connections:i?[{other:ids[i-1],intent:'mates',ownSurface:'bottom',otherSurface:'top',ownConnector:null,otherConnector:null,visibility:'inferred',evidence:'Declared test connection'}]:[]})),
  relations:[],alternatives:[],missingGeometry:[]}
 return {input,plan}
}
