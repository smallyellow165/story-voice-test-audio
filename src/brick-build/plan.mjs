// Build Order describes assembly operations, never new final poses.
export const leafId = instanceId => 'part:' + instanceId
export function nodesForSteps(instanceIds, steps) {
  return [...instanceIds.map(instanceId => ({id:leafId(instanceId),kind:'part',instanceId})),
    ...steps.map(s=>({id:s.resultNodeId,kind:'assembly',children:[s.targetNodeId,s.movingNodeId]}))]
}
export function createBuildPlan(source, buildPlanId, now) {
  const instanceIds=source.assembly.bricks.map(b=>b.id)
  return {schema_version:1,build_plan_id:buildPlanId,source_selection_id:source.id,
    source_geometry_result_id:source.geometryId,source_candidate_id:source.candidateId,
    source_candidate_hash:source.candidateHash,title:'Build Plan',status:'draft',instanceIds,
    assemblyNodes:nodesForSteps(instanceIds,[]),steps:[],rootNodeId:instanceIds.length===1?leafId(instanceIds[0]):null,
    created_at:now,updated_at:now}
}
export function withSteps(plan, steps) {
  const nodes=nodesForSteps(plan.instanceIds,steps),available=new Set(plan.instanceIds.map(leafId))
  for(const s of steps){available.delete(s.movingNodeId);available.delete(s.targetNodeId);available.add(s.resultNodeId)}
  return {...plan,status:'draft',steps,assemblyNodes:nodes,rootNodeId:available.size===1?[...available][0]:null}
}
export function inspectBuildPlan(plan, expectedInstanceIds, connections) {
  const errors=[],members={},availableBefore=[]
  const bad=message=>errors.push(message)
  const string=value=>typeof value==='string'&&value.length>0&&value.length<=180
  if(!plan||plan.schema_version!==1||!Array.isArray(plan.instanceIds)||!Array.isArray(plan.assemblyNodes)||!Array.isArray(plan.steps))
    return {valid:false,complete:false,errors:['Build Plan 结构无效'],members,availableBefore,available:[]}
  const ids=plan.instanceIds
  if(!ids.length||ids.length>100||ids.some(x=>!string(x))||new Set(ids).size!==ids.length)bad('实例必须为 1–100 个唯一 instanceId')
  if(expectedInstanceIds&&(ids.length!==expectedInstanceIds.length||ids.some(x=>!expectedInstanceIds.includes(x))))bad('实例清单与选定 Layout 不一致')
  if(!['draft','reviewed'].includes(plan.status))bad('Build Steps 状态无效')
  if(typeof plan.title!=='string'||plan.title.length>200)bad('标题过长或无效')
  if(plan.steps.length>99||plan.assemblyNodes.length>199)bad('装配树超过 V1 限制')
  if(errors.length)return {valid:false,complete:false,errors,members,availableBefore,available:[]}
  const nodes=new Map(),available=new Set(),stepIds=new Set(),produced=new Set()
  for(const n of plan.assemblyNodes){
    if(!n||!string(n.id)||nodes.has(n.id)){bad('节点 ID 缺失或重复');continue}
    nodes.set(n.id,n)
    if(n.kind==='part'){
      if(!ids.includes(n.instanceId)||n.id!==leafId(n.instanceId)||Object.keys(n).some(k=>!['id','kind','instanceId'].includes(k)))bad('Leaf 必须唯一引用原始实例，不能提供位姿')
      else {members[n.id]=[n.instanceId];available.add(n.id)}
    }else if(n.kind!=='assembly'||!Array.isArray(n.children)||n.children.length!==2||Object.keys(n).some(k=>!['id','kind','children'].includes(k)))bad('Assembly 节点必须包含两个子节点')
  }
  for(const id of ids)if(!members[leafId(id)])bad('缺少实例 Leaf：'+id)
  if(errors.length)return {valid:false,complete:false,errors,members,availableBefore,available:[...available]}
  for(const s of plan.steps){
    availableBefore.push([...available])
    if(!s||!string(s.stepId)||stepIds.has(s.stepId)){bad('Step ID 缺失或重复');continue}
    stepIds.add(s.stepId)
    if(Object.keys(s).some(k=>!['stepId','movingNodeId','targetNodeId','resultNodeId','description','motion'].includes(k)))bad('Step 含未支持字段；不能修改最终布局')
    if(typeof s.description!=='string'||s.description.length>2000)bad(s.stepId+'：说明无效')
    if(s.motion){
      const m=s.motion,offset=m.offsetLdu
      if(!offset||!['x','y','z'].every(k=>Number.isFinite(offset[k])&&Math.abs(offset[k])<=1000)||Object.keys(offset).some(k=>!['x','y','z'].includes(k))||!Number.isFinite(m.startYawDegrees)||Math.abs(m.startYawDegrees)>360||Object.keys(m).some(k=>!['offsetLdu','startYawDegrees'].includes(k)))bad(s.stepId+'：动画偏移或旋转无效')
    }
    const n=nodes.get(s.resultNodeId)
    if(s.movingNodeId===s.targetNodeId||!available.has(s.movingNodeId)||!available.has(s.targetNodeId)){
      bad(s.stepId+'：组件尚未构建，或已被使用；不能重复使用、循环引用或先安装后构建');continue
    }
    if(!n||n.kind!=='assembly'||produced.has(n.id)||members[n.id]||n.children[0]!==s.targetNodeId||n.children[1]!==s.movingNodeId){bad(s.stepId+'：结果节点与步骤不一致');continue}
    const movingMembers=members[s.movingNodeId],targetMembers=members[s.targetNodeId]
    if(connections&&!connections.some(c=>(movingMembers.includes(c.lowerId)&&targetMembers.includes(c.upperId))||(movingMembers.includes(c.upperId)&&targetMembers.includes(c.lowerId))))bad(s.stepId+'：两个组件之间没有已保存的真实接合证据')
    const combined=[...targetMembers,...movingMembers]
    if(new Set(combined).size!==combined.length){bad(s.stepId+'：重复零件实例');continue}
    members[n.id]=combined;produced.add(n.id)
    available.delete(s.targetNodeId);available.delete(s.movingNodeId);available.add(n.id)
  }
  for(const n of nodes.values())if(n.kind==='assembly'&&!produced.has(n.id))bad('未由有效步骤生成的组件：'+n.id)
  const complete=!errors.length&&available.size===1&&members[[...available][0]]?.length===ids.length
  const expectedRoot=complete?[...available][0]:null
  if(plan.rootNodeId!==expectedRoot)bad('Root 必须是包含全部实例的最终组件；未完成时应为 null')
  if(plan.status==='reviewed'&&!complete)bad('未完成的装配树不能标为 reviewed')
  return {valid:!errors.length,complete:complete&&!errors.length,errors,members,availableBefore,available:[...available]}
}
export function stepScene(plan, bricks, index) {
  const report=inspectBuildPlan(plan,bricks.map(b=>b.id))
  if(!report.valid||!report.complete)throw new Error('仅完整且有效的 Build Plan 可以播放')
  const step=plan.steps[index]
  if(!step)throw new Error('步骤不存在')
  const select=node=>bricks.filter(b=>report.members[node].includes(b.id)).map(b=>({...b}))
  return {step,moving:select(step.movingNodeId),target:select(step.targetNodeId),result:select(step.resultNodeId)}
}
