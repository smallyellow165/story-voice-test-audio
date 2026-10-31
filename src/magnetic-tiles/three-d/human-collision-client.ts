import {canonical} from '../build-plan.ts'
import type {Assembly3D} from './assembly.ts'
import type {HumanCollisionGrant,GeometryReport} from './human-collision-policy.ts'
import type {BuildOrderOptions,BuildOrderResult} from './build-order.ts'
import type {Tutorial3D} from './tutorial.ts'
export type HumanReviewState={matches:boolean;version:number|null;assemblyCanonical:string;assemblyHash:string;diagnosticHash:string;acceptedKeys:string[];collisionKeys:string[];eligible:boolean;geometry:GeometryReport;blockers:GeometryReport['issues'];grant:HumanCollisionGrant|null}
const markerKey='magnetic-tiles.human-collision-review.v1',event='magnetic-human-review-updated'
let session:Promise<string>|undefined,queue:Promise<unknown>=Promise.resolve()
const states=new Map<string,HumanReviewState>()
function markers(){try{return JSON.parse(localStorage.getItem(markerKey)||'{}')}catch{return {}}}
export function hasHumanReview(id:string){return !!markers()[id]}
export function humanReviewPending(id:string){return !!markers()[id]?.pending}
export function markHumanMutation(id:string){const m=markers(),prior=m[id];if(!prior)return 0;const nonce=(prior.nonce??0)+1;m[id]={...prior,pending:true,nonce};localStorage.setItem(markerKey,JSON.stringify(m));return nonce}
async function post(action:string,body:unknown,token?:string){const res=await fetch('/api/magnetic-intake/assembly3d-review/'+action,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw Error(data.error??'人工审核请求失败');return data}
async function call(action:string,body:unknown){session??=post('session',{}).then(r=>r.token).catch(e=>{session=undefined;throw e});return post(action,body,await session)}
function cache(a:Assembly3D,r:HumanReviewState){const old=states.get(a.id);if(!old||(r.version??0)>=(old.version??0))states.set(a.id,r)}
function remember(a:Assembly3D,r:HumanReviewState,nonce?:number){cache(a,r);const m=markers(),prior=m[a.id]??{};m[a.id]={...prior,version:r.version,...(nonce===undefined?{}:prior.nonce===nonce?{pending:false}:{})};localStorage.setItem(markerKey,JSON.stringify(m));window.dispatchEvent(new CustomEvent(event,{detail:a.id}));return r}

function enqueue<T>(fn:()=>Promise<T>):Promise<T>{const next=queue.then(fn,fn);queue=next.catch(()=>{});return next}
export const humanReviewEvents=event
export async function readHumanReview(a:Assembly3D){const r=await call('status',{assembly:a}) as HumanReviewState;cache(a,r);if(humanReviewPending(a.id)&&r.matches&&!r.grant&&!r.acceptedKeys.length){const m=markers();m[a.id]={...m[a.id],version:r.version,pending:false};localStorage.setItem(markerKey,JSON.stringify(m))}return r}
async function ensure(a:Assembly3D,originId?:string){if(humanReviewPending(a.id))throw Error('几何变更尚未同步，旧授权不能使用；请重新验证或重新读取审核。');let r=states.get(a.id);if(!r){r=await readHumanReview(a);if(!r.matches)throw Error('服务端作品快照已变化，请重新加载已保存 Draft。')}if(r.version===null)r=remember(a,await call('sync',{assembly:a,expectedVersion:null,...(originId?{originId}:{})}));return r}
export function syncHumanReview(a:Assembly3D,nonce=markers()[a.id]?.nonce){return enqueue(async()=>{const old=states.get(a.id),version=old?.version??markers()[a.id]?.version;if(version===undefined)throw Error('审核状态尚未恢复；未覆盖服务端数据。');return remember(a,await call('sync',{assembly:a,expectedVersion:version}),nonce)})}
export function setHumanAccepted(a:Assembly3D,key:string,accepted:boolean,originId?:string){return enqueue(async()=>{const r=await ensure(a,originId);if(!r.matches||r.assemblyCanonical!==canonical(a))throw Error('审核快照不一致，请重新读取审核。');const keys=new Set(r.acceptedKeys);if(accepted)keys.add(key);else keys.delete(key);return remember(a,await call('accept',{assembly:a,expectedVersion:r.version,acceptedKeys:[...keys]}))})}
export function approveHumanReview(a:Assembly3D){return enqueue(async()=>{const r=await ensure(a);return remember(a,await call('approve',{assembly:a,expectedVersion:r.version,acceptedKeys:r.acceptedKeys}))})}
export function recheckHumanReview(a:Assembly3D){if(humanReviewPending(a.id))return syncHumanReview(a);return enqueue(async()=>{const r=await ensure(a);return remember(a,await call('revalidate',{assembly:a,expectedVersion:r.version}))})}
export async function generateHumanTutorial(a:Assembly3D,options:BuildOrderOptions){const r=await readHumanReview(a);if(humanReviewPending(a.id)||!r.matches||!r.grant)throw Error('当前作品没有有效 Human Approved 授权。');const response=await call('generate',{assembly:a,expectedVersion:r.version,approvalId:r.grant.id,options});remember(a,response.review);return response.result as BuildOrderResult}
export function saveHumanTutorial(a:Assembly3D,tutorial:Tutorial3D){return enqueue(async()=>{const r=await readHumanReview(a);if(humanReviewPending(a.id)||!r.matches||!r.grant)throw Error('人工批准已失效，教程未正式保存。');const response=await call('saveTutorial',{assembly:a,expectedVersion:r.version,approvalId:r.grant.id,tutorial});remember(a,response.review);return response})}
