import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type Stage = 'source' | 'review' | 'reconstruction' | 'assembly' | 'build' | 'catalog'
type Column = 'workflow' | 'workspace' | 'inspector'
export const imageStages: Stage[] = ['source', 'review', 'reconstruction']
const stages: {id:Stage;label:string;detail:string}[] = [
  {id:'source',label:'图片与识别',detail:'上传 · 历史 · 识别'},
  {id:'review',label:'识别审核',detail:'零件 · 轮廓 · 关系'},
  {id:'reconstruction',label:'几何重建',detail:'原图对照 · 选择候选'},
  {id:'assembly',label:'作品编辑（Assembly）',detail:'自由搭建 · 保存作品'},
  {id:'build',label:'搭建教程（Build）',detail:'生成 · 保存 · 重播'},
]
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
  const [stage,setStage]=useState<Stage>('assembly')
  const [workflow,setWorkflow]=useState<HTMLDivElement|null>(null),[workspace,setWorkspace]=useState<HTMLDivElement|null>(null),[inspector,setInspector]=useState<HTMLDivElement|null>(null)
  useEffect(()=>{if(workspace)workspace.scrollTop=0;if(inspector)inspector.scrollTop=0},[stage,workspace,inspector])
  const [mobileColumn,setMobileColumn]=useState<Column>('workspace')
  const navigate=(s:Stage)=>{if(!dragging){setStage(s);setMobileColumn('workspace')}}
  return <Context.Provider value={{stage,navigate,hosts:{workflow:workflow??undefined,workspace:workspace??undefined,inspector:inspector??undefined}}}>
    <main className="tiles-app studio" data-mobile-column={mobileColumn}>
    <Group className="studio-panels" orientation="horizontal" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
      <Panel id="workflow" className="studio-panel studio-panel-workflow" defaultSize="18%" minSize="180px">
      <aside className="studio-column studio-workflow" aria-label="Workflow">
        <header><p className="eyebrow">MAGNETIC TILES</p><h1>Studio</h1><p className="hint">图片到作品，一片一片搭。</p></header>
        <nav aria-label="工作阶段">{stages.map((s,i)=><button key={s.id} data-stage={s.id} aria-current={stage===s.id?'step':undefined} disabled={dragging} onClick={()=>navigate(s.id)}><span>{i+1} · {s.label}</span><small>{s.detail}</small></button>)}</nav>
        <button data-stage="catalog" aria-current={stage==='catalog'?'page':undefined} disabled={dragging} onClick={()=>navigate('catalog')}>Supported Tiles / 磁力片目录</button>
        <div className="studio-mobile-controls"><button onClick={()=>setMobileColumn('workspace')}>查看工作区</button><button onClick={()=>setMobileColumn('inspector')}>查看检查器</button></div>
        <div ref={setWorkflow}/>
        <p className="hint">相对尺寸 · 零厚度二维几何，不代表实物三维磁吸或稳定性。</p>
      </aside></Panel>
      <Separator className="studio-separator studio-outer-separator" aria-label="调整左栏与中栏宽度" title="拖动或使用方向键调整左栏与中栏宽度"/>
      <Panel id="workspace" className="studio-panel studio-panel-workspace" defaultSize="58%" minSize="30%">
      <section className="studio-column studio-workspace" aria-label="Workspace">
        <div className="studio-column-heading"><h2>{stage==='catalog'?'Supported Tiles / 磁力片目录':stages.find(s=>s.id===stage)!.label}</h2><div className="studio-mobile-controls"><button onClick={()=>setMobileColumn('workflow')}>工作阶段</button><button onClick={()=>setMobileColumn('inspector')}>检查器</button></div></div>
        <div ref={setWorkspace}/>
      </section></Panel>
      <Separator className="studio-separator studio-outer-separator" aria-label="调整中栏与右栏宽度" title="拖动或使用方向键调整中栏与右栏宽度"/>
      <Panel id="inspector" className="studio-panel studio-panel-inspector" defaultSize="24%" minSize="240px">
      <aside className="studio-column studio-inspector" aria-label="Inspector">
        <div className="studio-column-heading"><h2>检查器</h2><div className="studio-mobile-controls"><button onClick={()=>setMobileColumn('workflow')}>工作阶段</button><button onClick={()=>setMobileColumn('workspace')}>工作区</button></div></div>
        <div ref={setInspector}/>
      </aside></Panel>
    </Group></main>
    {children}
  </Context.Provider>
}
