// Parts Input Preparation owns immutable collection identity and Mapping audits.
import {mkdir,readFile,writeFile,link,unlink} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {definitionId,resolvePartsGeometry} from './brick-parts-geometry.mjs'
import {loadBrickRules} from './brick-rules.mjs'
import {reviewedSource,prepareReviewedSource} from './brick-parts-input-source.mjs'
const fail=message=>{throw Object.assign(Error(message),{statusCode:422})}
const check=(ok,message)=>{if(!ok)fail(message)}
const equal=(a,b)=>definitionId(a)===definitionId(b)
const idPattern=/^sha256:[a-f0-9]{64}$/
const stamp=value=>({...value,integrityHash:definitionId(value)})
function verifyIntegrity(value){const {integrityHash,...body}=value;check(integrityHash===definitionId(body),'Parts Input 记录内容校验失败')}
// Only effective collection fields. Array order of geometry connectors is untouched.
export function partsIdentity(analysis,input){
 return {schemaVersion:1,sourceImageId:analysis.sourceImageId,analysisId:analysis.id,
  instances:input.observations.map(o=>({id:o.id,part:o.part,color:o.color,quantity:1,
   confirmedPart:{part_num:o.confirmedPart.part_num,color_id:o.confirmedPart.color_id},provenance:o.provenance,
   definitionReferences:o.mapping.definitionReferences,geometry:o.geometry,
   ...(o.geometry===null?{geometryStatus:o.geometryStatus,geometryUnknowns:o.geometryUnknowns}:{}),dimensionsMm:o.dimensionsMm
  })).sort((a,b)=>a.id.localeCompare(b.id)),
  inventory:[...input.inventory].sort((a,b)=>(a.part+':'+a.color).localeCompare(b.part+':'+b.color)),units:input.units}
}
export function createPartsInputStore(directory,{reverse,loadRules=loadBrickRules,resolve=resolvePartsGeometry}={}){
 const folder=path.join(directory,'brick-parts-inputs')
 function file(id,context=false){check(idPattern.test(id||''),'Parts Input ID 无效');return path.join(folder,...(context?['contexts']:[]),id.slice(7)+'.json')}
 async function readRecord(id,context=false){let r;try{r=JSON.parse(await readFile(file(id,context),'utf8'))}catch(e){fail('Parts Input 记录缺失或损坏：'+id+'；'+e.message)}verifyIntegrity(r);check(r.schemaVersion===1,'Parts Input schema 无效');return r}
 // Publish complete bytes atomically; concurrent loser never overwrites winner.
 async function publish(id,body,context=false){const target=file(id,context);await mkdir(path.dirname(target),{recursive:true});const temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(stamp(body)),{flag:'wx',mode:0o600});try{await link(temp,target)}catch(e){if(e.code!=='EEXIST')throw e}finally{await unlink(temp)}return readRecord(id,context)}
 async function read(id){const r=await readRecord(id);check(r.partsSnapshotId===id&&definitionId(r.identity)===id,'Parts Snapshot 身份不一致');check(r.mappingReview?.mapping?.valid===true,'Mapping 审计无效');check(r.identity.instances.length>0,'Parts Snapshot 实例为空');
  check(Array.isArray(r.definitions),'Snapshot 定义证据缺失')
  for(const d of r.definitions)for(const key of ['partDefinition','geometryDefinition','colorMapping'])if(d[key]){const {id,...body}=d[key];check(id===definitionId(body),'Snapshot 定义 hash 不一致')}
  for(const o of r.identity.instances){const refs=o.definitionReferences;check(refs,'Snapshot 缺少定义引用');for(const [key,ref] of [['partDefinition','partDefinitionId'],['geometryDefinition','geometryDefinitionId'],['colorMapping','colorMappingId']]){if(refs[ref]===null){check(key==='geometryDefinition'&&o.geometry===null,'Snapshot 缺少必要定义');continue}const matches=r.definitions.map(d=>d[key]).filter(d=>d?.id===refs[ref]);check(matches.length>0,'Snapshot 引用了不存在的定义');if(key==='geometryDefinition')check(equal(matches[0].profile,o.geometry),'Snapshot Profile 与定义不一致')}}
  const counts=new Map();for(const o of r.identity.instances){const rows=r.mappingReview.mapping.rows.filter(m=>m.source.part_num===o.confirmedPart.part_num&&m.source.color_id===o.confirmedPart.color_id);check(rows.length===1,'Snapshot Mapping 不唯一');const m=rows[0];check(!m.errors.length&&m.target?.part===o.part&&m.target?.color===o.color&&equal(m.definitionReferences,o.definitionReferences),'Snapshot Mapping 与实例不一致');counts.set(m,(counts.get(m)||0)+1);check(o.quantity===1&&o.definitionReferences?.schemaVersion===1,'实例定义引用缺失')}
  check(r.mappingReview.mapping.rows.every(m=>counts.get(m)===m.source.quantity),'Snapshot Mapping 数量不一致');return r}
 async function calculate(analysisId,expectedReviewVersion){check(reverse,'Current Review 服务不可用');const saved=await reverse.restore(analysisId),source=reviewedSource(saved);check(source.ready,source.errors.join('；'));if(expectedReviewVersion!==undefined)check(source.reviewVersion===expectedReviewVersion,'审核已变化，请重新加载');check(idPattern.test(saved.analysis.sourceImageId||''),'Source Image 身份缺失');
  const items=new Map();for(const r of source.rows.filter(r=>!r.excluded)){const p=r.confirmedPart,k=p.part_num+':'+p.color_id;const row=items.get(k)||{part_num:p.part_num,color_id:p.color_id,quantity:0};row.quantity++;items.set(k,row)}
  const rules=await loadRules(),resolved=await resolve([...items.values()],rules);check(resolved.valid,'正式 Mapping 不可用：'+resolved.rows.flatMap(r=>r.errors).join('；'));
  const mapping={mapping:{rows:resolved.rows,valid:resolved.valid}};
  const prepared=prepareReviewedSource(saved,mapping,rules,true,true),identity=partsIdentity(saved.analysis,prepared.input);
  return {saved,source,rules,resolved,identity,partsSnapshotId:definitionId(identity)}
 }
 async function prepare(analysisId,expectedReviewVersion){const c=await calculate(analysisId,expectedReviewVersion);let snapshot;
  try{await readFile(file(c.partsSnapshotId));snapshot=await read(c.partsSnapshotId)}catch(e){if(e.code!=='ENOENT')throw e;
   const mappingReview={id:randomUUID(),session:{schema_version:1,id:randomUUID(),name:'Parts Input '+analysisId,updated_at:new Date().toISOString(),items:c.resolved.rows.map(r=>r.source)},mapping:{rows:c.resolved.rows,valid:true}};
   snapshot=await publish(c.partsSnapshotId,{schemaVersion:1,partsSnapshotId:c.partsSnapshotId,identity:c.identity,mappingReview,definitions:c.resolved.definitions.map(({row,...d})=>d),preparationEvidence:{analysisId,reviewVersion:c.source.reviewVersion,savedReviewAt:c.source.updatedAt,rows:c.source.rows},planningEligible:true,geometryReady:c.identity.instances.every(o=>o.geometry!==null)});snapshot=await read(snapshot.partsSnapshotId)
  }
  check(equal(snapshot.identity,c.identity),'Parts Snapshot 内容冲突');
  // The context is created by Preparation from this saved review, never by Planner.
  const prepared=prepareReviewedSource(c.saved,snapshot.mappingReview,c.rules,true,true);
  check(equal(partsIdentity(c.saved.analysis,prepared.input),snapshot.identity),'准备时零件输入发生变化');
  const contextBody={schemaVersion:1,partsSnapshotId:snapshot.partsSnapshotId,prepared};const contextId=definitionId(contextBody);
  await publish(contextId,{...contextBody,preparationContextId:contextId},true);
  return {partsSnapshotId:snapshot.partsSnapshotId,preparationContextId:contextId,planningEligible:snapshot.planningEligible,geometryReady:snapshot.geometryReady}
 }
 async function forPlanning(snapshotId,contextId,includeEvidence){check(typeof includeEvidence==='boolean','需要明确 evidenceMode');const snapshot=await read(snapshotId),context=await readRecord(contextId,true);const {preparationContextId,integrityHash,...body}=context;check(preparationContextId===contextId&&definitionId(body)===contextId&&context.partsSnapshotId===snapshotId,'准备上下文身份不一致');
  const prepared=structuredClone(context.prepared),p=prepared.input.provenance;
  check(equal(partsIdentity({id:p.analysisId,sourceImageId:snapshot.identity.sourceImageId},prepared.input),snapshot.identity),'上下文与 Snapshot 实例不一致');
  check(p.reviewId===snapshot.mappingReview.id&&prepared.input.observations.every(o=>o.mapping.reviewId===p.reviewId),'上下文 Mapping ID 不一致');
  // Frozen snapshot is the source of collection geometry; context supplies only evidence.
  const instances=new Map(snapshot.identity.instances.map(o=>[o.id,o]));
  prepared.input.observations=prepared.input.observations.map(o=>({...o,geometry:structuredClone(instances.get(o.id).geometry)}));
  if(!includeEvidence){for(const o of prepared.input.observations)delete o.visionEvidence;for(const k of ['analysis','review','relations'])delete prepared.input[k];prepared.input.evidenceMode='photo_and_confirmed_parts'}
  prepared.partsSnapshotId=snapshotId;prepared.preparationContextId=contextId;prepared.input.partsSnapshotId=snapshotId;
  return {prepared,sources:[{analysisId:p.analysisId,reviewVersion:p.reviewVersion,mappingReviewId:p.reviewId,mappingReview:snapshot.mappingReview,partsSnapshotId:snapshotId,preparationContextId:contextId}]}
 }
 async function verifyTrace(trace){if(trace.inputContract===undefined&&trace.partsSnapshotId===undefined&&trace.preparationContextId===undefined&&trace.requestInput?.partsSnapshotId===undefined&&!trace.sources?.some(s=>s.partsSnapshotId!==undefined||s.preparationContextId!==undefined))return;
  check(trace.inputContract==='parts-input-snapshot-v1','Spatial Snapshot 契约缺失或无效');
  const mode=trace.requestInput?.evidenceMode;check(['saved_analysis_and_relations','photo_and_confirmed_parts'].includes(mode),'Spatial evidenceMode 无效');
  const expected=await forPlanning(trace.partsSnapshotId,trace.preparationContextId,mode==='saved_analysis_and_relations');
  for(const [key,value] of Object.entries({requestInput:expected.prepared.input,image:expected.prepared.image,geometrySnapshot:expected.prepared.geometrySnapshot,imagePayloadSha256:expected.prepared.imagePayloadSha256,sources:expected.sources}))check(equal(trace[key],value),'Spatial Snapshot 来源不一致：'+key)
 }
 async function match(trace,current){if(!trace.partsSnapshotId)return {status:'Unknown',reason:'历史未记录 Parts Snapshot'};try{await verifyTrace(trace);const id=current??(await calculate(trace.requestInput.provenance.analysisId)).partsSnapshotId;return {status:id===trace.partsSnapshotId?'Current':'Outdated',partsSnapshotId:trace.partsSnapshotId,currentPartsSnapshotId:id}}catch(e){return {status:'Unknown',reason:e.message}}}
 return {prepare,read,forPlanning,verifyTrace,match,current:async analysisId=>(await calculate(analysisId)).partsSnapshotId}
}
