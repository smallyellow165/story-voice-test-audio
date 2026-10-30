import { workflowTerms } from './studio-terms.ts'
import { SupportedTiles } from './SupportedTiles.tsx'
import { PANEL_PREFERENCES_KEY, resolvePanelState } from './studio-panel-state.ts'
import type { RightTab } from './studio-panel-state.ts'
import type { WorkflowStage } from './studio-url.ts'
import { readStudioUrl, useUrlRequest, writeStudioUrl } from './studio-url.ts'
import { InfoHint } from '../brick-vision/InfoHint.tsx'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type Stage = WorkflowStage
type Column = 'workflow' | 'workspace' | 'inspector'
export const imageStages: Stage[] = ['source', 'review', 'reconstruction']
const stages: {id:Stage;label:string;detail:string}[] = (['source','review','reconstruction','assembly','build'] as const).map(id=>({id,label:workflowTerms[id].label,detail:workflowTerms[id].hint}))
const Context = createContext<{stage:Stage; navigate:(s:Stage)=>void; hosts:Partial<Record<Column,HTMLDivElement>>}|null>(null)
export function useStudio(){const value=useContext(Context);if(!value)throw Error('Studio layout required');return value}
// Stable portal hosts keep each feature's existing state and DOM alive across navigation.
// Only presentation changes; storage and feature controllers remain owned by their modules.
export function StudioSlot({column,stages:visible,children}:{column:Column;stages:Stage[];children:ReactNode}){
  const {stage,hosts}=useStudio(),host=hosts[column]
  return host ? createPortal(<div className="studio-slot" hidden={!visible.includes(stage)}>{children}</div>,host) : null
}
export function StudioLayout({children,dragging}:{children:ReactNode;dragging:boolean}){
  const layout=useDefaultLayout({id:'magnetic-studio-columns-v1',onlySaveAfterUserInteractions:true})
  const request=useUrlRequest(), parsed=readStudioUrl(request.href)
  const readPreferences=()=>{try{return {saved:JSON.parse(localStorage.getItem(PANEL_PREFERENCES_KEY)||'{}'),warning:''}}catch{return {saved:{},warning:'右栏 UI 偏好无法读取；工作快照和草稿未修改。'}}}
  const [boot]=useState(()=>{const p=readPreferences();return {...resolvePanelState(request.href,p.saved),storageWarning:p.warning}})
  const [stage,setStage]=useState<Stage>(boot.stage),[rightTab,setRightTab]=useState<RightTab>(boot.rightTab),[catalogProfile,setCatalogProfile]=useState(boot.catalogProfile)
  const [appliedRequest,setAppliedRequest]=useState(request),[warnings,setWarnings]=useState(boot.warnings),[storageWarning,setStorageWarning]=useState(boot.storageWarning)
  const rightColumn=useRef<HTMLElement>(null),scrollOffsets=useRef({inspector:0,catalog:0})
  useEffect(()=>{const p=readPreferences(),state=resolvePanelState(request.href,p.saved);setStage(state.stage);setRightTab(state.rightTab);setCatalogProfile(state.catalogProfile);setWarnings(state.warnings);setStorageWarning(p.warning);setAppliedRequest(request);setMobileColumn(state.rightTab==='catalog'?'inspector':'workspace')},[request])
  useEffect(()=>{
    if(appliedRequest!==request)return
    writeStudioUrl({stage,rightTab,catalogProfile})
    try{localStorage.setItem(PANEL_PREFERENCES_KEY,JSON.stringify({rightTab,catalogProfile,lastStage:stage}));setStorageWarning('')}catch{setStorageWarning('右栏 UI 偏好无法保存；URL 仍可恢复 Tab 与 Profile，工作数据未修改。')}
  },[stage,rightTab,catalogProfile,appliedRequest,request])
  useLayoutEffect(()=>{if(rightColumn.current)rightColumn.current.scrollTop=scrollOffsets.current[rightTab]},[rightTab])
  const [workflow,setWorkflow]=useState<HTMLDivElement|null>(null),[workspace,setWorkspace]=useState<HTMLDivElement|null>(null),[inspector,setInspector]=useState<HTMLDivElement|null>(null)
  useEffect(()=>{if(workspace)workspace.scrollTop=0;if(rightTab==='inspector'&&rightColumn.current){rightColumn.current.scrollTop=0;scrollOffsets.current.inspector=0}},[stage,workspace])
  const [mobileColumn,setMobileColumn]=useState<Column>(boot.rightTab==='catalog'?'inspector':'workspace')
  const navigate=(s:Stage)=>{if(!dragging){writeStudioUrl({stage:s,...(stage==='assembly'&&s==='build'?{buildId:undefined}:{})},true);setStage(s);setMobileColumn('workspace')}}
  const selectTab=(tab:RightTab)=>{if(tab===rightTab)return;if(rightColumn.current)scrollOffsets.current[rightTab]=rightColumn.current.scrollTop;setRightTab(tab);setWarnings([]);setMobileColumn('inspector')}
  return <Context.Provider value={{stage,navigate,hosts:{workflow:workflow??undefined,workspace:workspace??undefined,inspector:inspector??undefined}}}>
    <main className="tiles-app studio" data-mobile-column={mobileColumn} data-active-stage={stage}>
    <Group className="studio-panels" orientation="horizontal" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
      <Panel id="workflow" className="studio-panel studio-panel-workflow" defaultSize="18%" minSize="180px">
      <aside className="studio-column studio-workflow" aria-label="Workflow">
        <header><p className="eyebrow">MAGNETIC TILES</p><h1>Studio <InfoHint label="Studio">图片到作品，一片一片搭。</InfoHint></h1></header>
        <nav aria-label="工作阶段">{stages.map((s,i)=><div className="studio-stage-row" key={s.id} data-active={stage===s.id}><button data-stage={s.id} aria-current={stage===s.id?'step':undefined} disabled={dragging} onClick={()=>navigate(s.id)}><span title={s.label}>{i+1} · {s.label}</span></button><InfoHint label={s.label}>{s.detail}</InfoHint></div>)}</nav>
        <div className="studio-mobile-controls"><button onClick={()=>setMobileColumn('workspace')}>查看工作区</button><button onClick={()=>setMobileColumn('inspector')}>查看检查器</button></div>
        <div ref={setWorkflow}/>{parsed.errors.map(e=><p key={e} role="alert">{e}；未按无效参数恢复。</p>)}
        <p className="hint">相对尺寸 · 零厚度二维几何，不代表实物三维磁吸或稳定性。</p>
      </aside></Panel>
      <Separator className="studio-separator studio-outer-separator" aria-label="调整左栏与中栏宽度" title="拖动或使用方向键调整左栏与中栏宽度"/>
      <Panel id="workspace" className="studio-panel studio-panel-workspace" defaultSize="58%" minSize="30%">
      <section className="studio-column studio-workspace" aria-label="Workspace">
        <div className="studio-column-heading"><h2>{stages.find(s=>s.id===stage)!.label}</h2><div className="studio-mobile-controls"><button onClick={()=>setMobileColumn('workflow')}>工作阶段</button><button onClick={()=>setMobileColumn('inspector')}>检查器</button></div></div>
        <div ref={setWorkspace}/>
      </section></Panel>
      <Separator className="studio-separator studio-outer-separator" aria-label="调整中栏与右栏宽度" title="拖动或使用方向键调整中栏与右栏宽度"/>
      <Panel id="inspector" className="studio-panel studio-panel-inspector" defaultSize="24%" minSize="240px">
      <aside ref={rightColumn} className="studio-column studio-inspector" aria-label="Inspector" onScroll={e=>{scrollOffsets.current[rightTab]=e.currentTarget.scrollTop}}>
        <div className="studio-column-heading studio-inspector-heading">
          <div className="inspector-tabs" role="tablist" aria-label="右栏工具" onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?'inspector':e.key==='End'?'catalog':rightTab==='inspector'?'catalog':'inspector';selectTab(next);e.currentTarget.querySelector<HTMLButtonElement>(`[data-right-tab="${next}"]`)?.focus()}}>
            <button id="studio-inspector-tab" role="tab" data-right-tab="inspector" aria-controls="studio-inspector-content" aria-selected={rightTab==='inspector'} tabIndex={rightTab==='inspector'?0:-1} onClick={()=>selectTab('inspector')}>Inspector</button>
            <button id="studio-catalog-tab" role="tab" data-right-tab="catalog" aria-controls="studio-catalog-content" aria-selected={rightTab==='catalog'} tabIndex={rightTab==='catalog'?0:-1} onClick={()=>selectTab('catalog')}>Tiles Catalog</button>
          </div>
          {(warnings.length>0||storageWarning)&&<InfoHint label="右栏状态">{[...warnings,storageWarning].filter(Boolean).map(w=><p key={w}>{w}</p>)}</InfoHint>}
          <div className="studio-mobile-controls"><button onClick={()=>setMobileColumn('workflow')}>工作阶段</button><button onClick={()=>setMobileColumn('workspace')}>工作区</button></div>
        </div>
        <div id="studio-inspector-content" role="tabpanel" aria-labelledby="studio-inspector-tab" hidden={rightTab!=='inspector'} ref={setInspector}/>
        <div id="studio-catalog-content" role="tabpanel" aria-labelledby="studio-catalog-tab" hidden={rightTab!=='catalog'}><SupportedTiles selected={catalogProfile} onSelect={key=>{setCatalogProfile(key);setWarnings([])}}/></div>
      </aside></Panel>
    </Group></main>
    {children}
  </Context.Provider>
}
