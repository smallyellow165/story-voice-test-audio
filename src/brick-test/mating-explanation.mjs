// Read-only diagnostics over the SAME shared geometry validator/candidate generator.
// No plan edits, index relaxation in execution, or alternate collision algorithm.
export function explainMating(own,other,intent,rules){
 try{return inspectMating(own,other,intent,rules)}catch(error){return {classification:"Unknown",reason:"无法完成接口复核："+String(error.message),alternatives:[]}}
}
function inspectMating(own,other,intent,rules){
 const unknown=reason=>({classification:'Unknown',reason,alternatives:[]})
 if(!own||!other)return unknown('诊断布局中缺少对应零件。')
 for(const b of [own,other])if(!rules.geometrySupport(b.part).supported)return {classification:'Physical Interface Unsupported',reason:'共享接口模型未支持 '+b.part+'；不表示实物不能连接。',alternatives:[]}
 if(!['top','bottom'].includes(intent.ownSurface)||!['top','bottom'].includes(intent.otherSurface)||intent.ownSurface===intent.otherSurface)return unknown('未声明上下接合面，无法按 Stud/Socket 评估。')
 const lower=intent.ownSurface==='top'?own:other,upper=lower===own?other:own
 const floor=Math.min(own.layer,other.layer)
 const current=rules.validateFinalAssembly([own,other].map(b=>({...b,layer:b.layer-floor})))
 const a=rules.connectors(own,intent.ownSurface),b=rules.connectors(other,intent.otherSurface)
 const alternatives=[]
 // Accept only pairs already admitted by the shared whole-pair validation.
 if(current.valid)for(const [i,u] of a.entries())for(const [j,v] of b.entries()){
  if(['x','y','z'].every(k=>Math.abs(u[k]-v[k])<1e-7)&&current.connections.some(c=>c.lowerId===lower.id&&c.upperId===upper.id&&c.points.some(p=>Math.abs(p.x*rules.STUD_LDU-u.x)<1e-7&&Math.abs(p.z*rules.STUD_LDU-u.z)<1e-7)))alternatives.push({ownConnector:i,otherConnector:j,pointLdu:{x:u.x,y:u.y,z:u.z}})
 }
 const specifiedSatisfied=alternatives.some(p=>(intent.ownConnector===null||intent.ownConnector===p.ownConnector)&&(intent.otherConnector===null||intent.otherConnector===p.otherConnector))
 let witness=null
 if(!current.valid){
  const base={...lower,x:0,z:0,layer:0}
  for(const rotation of rules.geometrySupport(upper.part).geometry.rotations){
   const found=rules.connectionCandidates([base],{...upper,rotation})[0]
   if(found&&rules.validateFinalAssembly([base,found.brick]).valid){witness={bricks:[base,found.brick],scope:'两零件独立验证，非企鹅整体修正版；忽略原计划索引和位置，仅证明存在几何接合方式。'};break}
  }
 }
 const classification=current.valid&&!specifiedSatisfied?'Connector Pair Mismatch':current.code==='COLLISION'?'Geometry Collision':!current.valid&&witness?'Pose Constraint Conflict':'Unknown'
 return {classification,ownId:own.id,otherId:other.id,current, specifiedSatisfied,alternatives,witness,
  specified:{own:intent.ownConnector===null?null:a[intent.ownConnector]??null,other:intent.otherConnector===null?null:b[intent.otherConnector]??null},
  reason:classification==='Connector Pair Mismatch'?'当前两块布局通过严格几何验证，并存在其他合法配对；计划指定的接口索引不匹配。':classification==='Geometry Collision'?'当前两零件布局存在碰撞；这不是两种零件永远无法连接的结论。':classification==='Pose Constraint Conflict'?'独立实验找到合法接合姿态，但当前计划布局不满足；不能自动套用为整体修正。':'现有证据不足以进一步归因，或当前指定配对已成立。',
  scope:'使用当前共享 Profile 对记录姿态进行只读复核；不替代历史搜索结论或完整装配校验。'}
}
