import {useEffect,useRef,useState} from 'react'
import {intakeApi} from '../../intake/api.ts'
import {moduleAssignments} from './module-plan.ts'
import type {ModulePlanRecord,ModuleHead,ModuleCommand} from './module-plan.ts'
export type ModuleState={head:ModuleHead;record:ModulePlanRecord|null;history:ModulePlanRecord[];outdated:boolean;reviewId:string;reviewHash:string}
const api=<T,>(route:string,body?:unknown)=>intakeApi<T>('visible3d/'+route,body)
export function useModulePlan(review:{id:string;hash:string}|null,active:boolean){
    const scope=review?review.id+':'+review.hash:'',current=useRef(scope);current.current=scope
    const sequence=useRef(0),[saved,setSaved]=useState<{scope:string;data:ModuleState|null}>({scope:'',data:null}),[pending,setPending]=useState(''),[failure,setFailure]=useState<{scope:string;message:string}|null>(null)
    const data=saved.scope===scope?saved.data:null
    async function readCurrent(){
        if(!review)throw Error('尚未打开 Review')
        const next=await api<ModuleState>('module-state/'+review.id)
        if(next.reviewId!==review.id||next.reviewHash!==review.hash)throw Error('模块来源与当前审核不一致')
        return next
    }
    async function refresh(){const key=scope,seq=++sequence.current;if(!review)return;setPending(key);try{const next=await readCurrent();if(current.current===key&&seq===sequence.current){setSaved({scope:key,data:next});setFailure(null)}}catch(e){if(current.current===key&&seq===sequence.current)setFailure({scope:key,message:String(e)})}finally{if(current.current===key&&seq===sequence.current)setPending('')}}
    useEffect(()=>{if(active&&review)void refresh()},[active,scope])
    async function save(command:ModuleCommand){
        if(!review||pending===scope)throw Error('模块正在保存，请稍候')
        const key=scope,knownAssignments=moduleAssignments(data?.record?.modules??[]);setPending(key);setFailure(null);++sequence.current
        try{
            // Append to the actual saved modules, never a cached display/history snapshot.
            // A single CAS retry merges independent creates/renames without asking users about versions.
            for(let attempt=0;attempt<2;attempt++){
                const latest=await readCurrent()
                if(current.current!==key)throw Error('审核来源已切换，本次未保存')
                setSaved({scope:key,data:latest})
                if(command.kind==='create'&&command.move){
                    const assignments=moduleAssignments(latest.record?.modules??[])
                    if(command.observationIds?.some(id=>assignments[id]&&assignments[id]!==knownAssignments[id]))throw Error('所选零件的模块归属已变化，请重新点击创建模块确认移动')
                }
                try{
                    const r=await api<{record:ModulePlanRecord;head:ModuleHead}>('module-plans',{reviewId:review.id,reviewHash:review.hash,expectedRevision:latest.head.revision,expectedHash:latest.head.recordHash,command})
                    if(current.current===key)setSaved({scope:key,data:{...latest,head:r.head,record:r.record,history:[r.record,...latest.history]}})
                    return r.record
                }catch(e){
                    if(attempt===0&&/Module Plan 已被其他页面更新|该来源正在更新/.test(String(e))){await new Promise(resolve=>setTimeout(resolve,100));continue}
                    throw e
                }
            }
            throw Error('模块未保存，请重试')
        }catch(e){if(current.current===key)setFailure({scope:key,message:String(e)});throw e}
        finally{if(current.current===key)setPending('')}
    }
    return {data,busy:pending===scope&&!!scope,error:failure?.scope===scope?failure.message:'',refresh,save}
}
