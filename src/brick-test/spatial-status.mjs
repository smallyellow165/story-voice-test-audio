// Operation completion is separate from domain validity and scene provenance.
export function spatialStatus(stage,record,{running=false,error=''}={}) {
 if(running||record?.state==='running')return {tone:'running',label:'Running · 执行中',reason:'不会自动重试或重新调用模型。'}
 if(error)return {tone:'failed',label:'Failed · 失败',reason:error}
 if(!record)return {tone:'idle',label:'Not Run · 尚未执行',reason:''}
 if(stage==='planning'){
  if(record.usable)return {tone:'success',label:'Success · 空间计划已保存',reason:'JSON 与计划校验通过；不代表 Geometry Valid。'}
  if(record.status==='prepared')return {tone:'idle',label:'Not Run · 请求已准备',reason:'尚未调用模型。'}
  return {tone:'failed',label:'Failed · 计划不可执行',reason:record.error?JSON.stringify(record.error):record.status}
 }
 const seen=new Set()
 const reason=[record.error,...(record.diagnostics||[])].filter(Boolean).filter(v=>{
  if(typeof v!=='object'||!v.id||!v.other)return true
  const key=[v.id,v.other].sort().join('/')+v.code
  if(seen.has(key))return false;seen.add(key);return true
 }).map(v=>typeof v==='string'?v:v.reason?`${v.id||''}${v.other?' ↔ '+v.other:''}：${v.reason}${v.code?' ('+v.code+')':''}`:v.example?.geometry?.reason||JSON.stringify(v)).join('；')||record.status
 if(['budget_exceeded','insufficient_information'].includes(record.status))return {tone:'review',label:'Needs Review · 尚未解决',reason}
 if(record.state!=='complete'||!['candidates_found','candidates_with_unverified_constraints'].includes(record.status)||!record.candidates?.length)return {tone:'failed',label:'Failed / Invalid · 几何执行失败',reason}
 if(!record.completeSearch||record.status==='candidates_with_unverified_constraints')return {tone:'review',label:'Needs Review · 候选仍需审核',reason:'存在未验证的视觉约束或搜索未完成；查看详细诊断。'}
 return {tone:'success',label:'Success · 几何候选有效',reason:'Geometry Valid；仍需对照原图审核。'}
}
