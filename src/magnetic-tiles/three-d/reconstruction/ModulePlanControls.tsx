import {useState} from 'react'
import type {ReviewSelectionControls} from '../../intake/ReviewWorkspace.tsx'
import type {ReviewDisplay} from '../../intake/review-display.ts'
import {moduleAssignments} from './module-plan.ts'
import type {useModulePlan} from './useModulePlan.ts'

export function ModulePlanControls({store,display,selection,busy}:{store:ReturnType<typeof useModulePlan>;display:ReviewDisplay;selection:ReviewSelectionControls;busy:boolean}){
    const [message,setMessage]=useState('')
    const modules=store.data?.record?.modules??[],filter=display.state.moduleFilter??'all',module=modules.find(m=>m.id===filter)
    const disabled=busy||store.busy||!store.data
    function chooseFilter(value:string){
        setMessage('')
        display.update({moduleFilter:value,manualSelection:true,markedIds:modules.find(m=>m.id===value)?.observationIds??[]})
    }
    async function create(){
        const ids=[...selection.markedIds]
        const existing=modules.find(m=>m.observationIds.length===ids.length&&m.observationIds.every(id=>ids.includes(id)))
        if(existing){chooseFilter(existing.id);setMessage(`这些零件已属于 ${existing.name}`);return}
        const hidden=ids.filter(id=>!selection.visibleIds.includes(id)).length
        const name=window.prompt(`模块名称 · 已选 ${ids.length} 片${hidden?`（其中 ${hidden} 片被筛选隐藏）`:''}\n${ids.join(', ')}`)
        if(name===null)return
        if(!name.trim()||name.trim().length>80){setMessage('名称需为 1–80 个字符');return}
        const assigned=moduleAssignments(modules),overlap=ids.filter(id=>assigned[id])
        if(overlap.length&&!window.confirm(`${overlap.join(', ')} 已属于 ${[...new Set(overlap.map(id=>modules.find(m=>m.id===assigned[id])!.name))].join('、')}。是否移动到新模块“${name.trim()}”？`))return
        try{
            await store.save({kind:'create',name:name.trim(),observationIds:ids,move:overlap.length>0})
            // Ready for the next group immediately, without hiding unassigned rows.
            display.update({moduleFilter:'all',manualSelection:true,markedIds:[]})
            setMessage(`已创建 ${name.trim()} · ${ids.length} 片`)
        }catch{/* The existing request error remains beside these controls. */}
    }
    async function rename(){
        if(!module)return
        const name=window.prompt('模块名称',module.name)
        if(name===null||name.trim()===module.name)return
        if(!name.trim()||name.trim().length>80){setMessage('名称需为 1–80 个字符');return}
        try{await store.save({kind:'rename',moduleId:module.id,name:name.trim()});setMessage(`已重命名为 ${name.trim()}`)}catch{/* Same saved modules remain visible on failure. */}
    }
    return <div className="review-module-controls">
        <label htmlFor="review-module-filter">模块</label><select id="review-module-filter" aria-label="模块筛选" disabled={disabled} value={module||filter==='unassigned'?filter:'all'} onChange={e=>chooseFilter(e.target.value)}><option value="all">全部</option><option value="unassigned">未分配</option>{modules.map(m=><option key={m.id} value={m.id}>{m.name} · {m.observationIds.length}</option>)}</select>
        <button disabled={disabled||!selection.markedIds.length} onClick={()=>void create()}>创建模块</button><button disabled={disabled||!module} onClick={()=>void rename()}>重命名模块</button>
        {store.error?<span className="review-confirmation-blocker" role="alert">{store.error}</span>:message&&<span className="review-module-notice" role="status">{message}</span>}
    </div>
}
