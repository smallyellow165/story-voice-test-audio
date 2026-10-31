import {useCallback,useEffect,useRef,useState} from 'react'
import type {Assembly3D} from './assembly.ts'
import {canonical} from '../build-plan.ts'
import {grantMatches} from './human-collision-policy.ts'
import * as api from './human-collision-client.ts'
export function useHumanCollisionReview(assembly:Assembly3D|null,active:boolean,owner=false){
 const [state,setState]=useState<api.HumanReviewState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const raw=assembly?canonical(assembly):'',latest=useRef(raw);latest.current=raw
 const previous=useRef(raw),request=useRef(0),pending=useRef(false)
 const refresh=useCallback(async()=>{if(!assembly)return;const source=canonical(assembly),seq=++request.current;try{const r=await api.readHumanReview(assembly);if(seq===request.current&&source===latest.current){setState(r);setError(r.matches?'':'服务端作品已被其他页面更新；旧审核不能用于当前快照。')}}catch(e){if(seq===request.current){setState(null);setError(String(e))}}},[raw])
 useEffect(()=>{if(previous.current!==raw){previous.current=raw;request.current++;setState(null);setError('');setBusy(false)}if(active&&assembly&&api.hasHumanReview(assembly.id))void refresh()},[raw,active,owner,refresh])
 function noteMutation(a:Assembly3D){if(!owner||!api.hasHumanReview(a.id))return;const nonce=api.markHumanMutation(a.id),source=canonical(a);setState(null);setBusy(true);setError('');pending.current=true;request.current++;api.syncHumanReview(a,nonce).then(r=>{if(source===latest.current)setState(r)}).catch(e=>{if(source===latest.current){setState(null);setError(String(e))}}).finally(()=>{pending.current=false;if(source===latest.current)setBusy(false)})}
 useEffect(()=>{if(!active||!assembly)return;const update=(e:Event)=>{if((e as CustomEvent).detail===assembly.id&&!pending.current)void refresh()};const storage=(e:StorageEvent)=>{if(e.key?.includes('human-collision-review')&&!pending.current)void refresh()};window.addEventListener(api.humanReviewEvents,update);window.addEventListener('storage',storage);const timer=setInterval(()=>{if(api.hasHumanReview(assembly.id)&&!pending.current)void refresh()},3000);return()=>{window.removeEventListener(api.humanReviewEvents,update);window.removeEventListener('storage',storage);clearInterval(timer)}},[raw,active,refresh])
 async function act(fn:(a:Assembly3D)=>Promise<api.HumanReviewState>){if(!assembly||busy)return;const source=raw;setBusy(true);pending.current=true;request.current++;try{const r=await fn(assembly);if(source===latest.current){setState(r);setError('')}}catch(e){if(source===latest.current){setState(null);setError(String(e))}}finally{pending.current=false;if(source===latest.current)setBusy(false)}}
 const current=state?.matches&&state.assemblyCanonical===raw&&(!assembly||!api.humanReviewPending(assembly.id))?state:null
 const grant=!busy&&!error&&current?.grant&&assembly&&grantMatches(assembly,current.grant)?current.grant:undefined
 return {state:current,grant,busy,error,refresh,noteMutation,accept:(key:string,checked:boolean,originId?:string)=>act(a=>api.setHumanAccepted(a,key,checked,originId)),approve:()=>act(api.approveHumanReview),revalidate:()=>act(async a=>{const latest=await api.readHumanReview(a);if(!latest.matches){if(!confirm('服务端审核快照与当前 Draft 不同。使用当前 Draft 重新开始审核？旧审核和批准将失效；其他页面的并发更新仍会阻断。'))throw Error('已取消重新开始审核，服务端记录未改变。');const nonce=api.markHumanMutation(a.id);return api.syncHumanReview(a,nonce)}return api.recheckHumanReview(a)})}
}
