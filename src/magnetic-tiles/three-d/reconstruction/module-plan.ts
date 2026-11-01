import type {VisibleReview3D} from './contracts.ts'
export type ReviewModule={id:string;name:string;observationIds:string[]}
export type ModuleCommand={kind:'create'|'rename'|'members'|'delete';moduleId?:string;name?:string;observationIds?:string[];move?:boolean}|{kind:'restore';recordId:string}
export type ModulePlanRecord={
    id:string;hash:string;createdAt:string;kind:'magnetic-module-plan';schemaVersion:1;modulePlanId:string;revision:number;
    parent:{id:string;hash:string}|null;sourceId:string;sourceHash:string;analysisId:string;analysisHash:string;reviewId:string;reviewHash:string;
    modules:ReviewModule[];change:{kind:string;moduleId?:string;moved:{observationId:string;fromModuleId:string;toModuleId:string}[];restoredFrom?:string};
}
export type ModuleHead={revision:number;recordId:string|null;recordHash:string|null;modulePlanId:string|null}
const moduleId=(id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
function assertName(name:unknown):asserts name is string{if(typeof name!=='string'||!name.trim()||name.trim().length>80)throw Error('模块名称需为 1–80 个字符')}
export function assertModules(modules:ReviewModule[],review:VisibleReview3D){
    if(!Array.isArray(modules)||modules.length>32)throw Error('模块数量超出范围')
    const ids=new Set<string>(),assigned=new Set<string>(),allowed=new Set(review.pieces.map(p=>p.id))
    for(const m of modules){
        if(!m||Object.keys(m).some(k=>!['id','name','observationIds'].includes(k))||!moduleId(m.id)||ids.has(m.id))throw Error('Module ID 无效或重复')
        ids.add(m.id);assertName(m.name)
        if(!Array.isArray(m.observationIds)||m.observationIds.length>review.pieces.length)throw Error('模块成员列表无效')
        for(const id of m.observationIds){if(!allowed.has(id))throw Error('模块成员不属于当前 Review');if(assigned.has(id))throw Error('Observation 不得重复或同时属于两个模块');assigned.add(id)}
    }
}
export function moduleAssignments(modules:ReviewModule[]){return Object.fromEntries(modules.flatMap(m=>m.observationIds.map(id=>[id,m.id])))}
export function moduleFilterIds(modules:ReviewModule[],filter:string,review:VisibleReview3D){
    const assignments=moduleAssignments(modules)
    return filter==='all'?review.pieces.map(p=>p.id):filter==='unassigned'?review.pieces.filter(p=>!assignments[p.id]).map(p=>p.id):modules.find(m=>m.id===filter)?.observationIds??[]
}
/** Mutations are membership-only; no Recognition/Profile/confirmation edits.
 * Overlapping assignments require the caller's explicit move authorization. */
export function changeModules(before:ReviewModule[],review:VisibleReview3D,command:Exclude<ModuleCommand,{kind:'restore'}>,newId:string){
    assertModules(before,review)
    if(!command||!['create','rename','members','delete'].includes(command.kind))throw Error('未知模块操作')
    const modules=structuredClone(before),target=modules.find(m=>m.id===command.moduleId)
    if(command.kind!=='create'&&!target)throw Error('模块不存在或版本已变化')
    if(command.kind==='delete'){const next=modules.filter(m=>m.id!==target!.id);return {modules:next,change:{kind:command.kind,moduleId:target!.id,moved:[]}}}
    if(command.kind==='rename'){assertName(command.name);target!.name=command.name.trim();return {modules,change:{kind:command.kind,moduleId:target!.id,moved:[]}}}
    const incoming=command.observationIds
    if(!Array.isArray(incoming)||new Set(incoming).size!==incoming.length||incoming.some(id=>!review.pieces.some(p=>p.id===id)))throw Error('成员需要来自当前 Review 的唯一 Observation ID')
    if(command.kind==='create'&&!incoming.length)throw Error('请先勾选模块成员')
    if(command.move!==undefined&&typeof command.move!=='boolean')throw Error('移动授权无效')
    if(command.kind==='create'){assertName(command.name);if(!moduleId(newId)||modules.some(m=>m.id===newId))throw Error('新 Module ID 无效');modules.push({id:newId,name:command.name.trim(),observationIds:[]})}
    const module=command.kind==='create'?modules[modules.length-1]:target!,moved=modules.filter(m=>m.id!==module.id).flatMap(m=>m.observationIds.filter(id=>incoming.includes(id)).map(observationId=>({observationId,fromModuleId:m.id,toModuleId:module.id})))
    if(moved.length&&command.move!==true)throw Error('成员已分配到其他模块；必须明确移动，不能复制')
    for(const m of modules)if(m.id!==module.id)m.observationIds=m.observationIds.filter(id=>!incoming.includes(id))
    module.observationIds=review.pieces.filter(p=>incoming.includes(p.id)).map(p=>p.id)
    assertModules(modules,review)
    return {modules,change:{kind:command.kind,moduleId:module.id,moved}}
}
