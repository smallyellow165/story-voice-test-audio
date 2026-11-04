import {InfoHint} from '../../brick-vision/InfoHint.tsx'
import { useProfileRegistry } from '../ProfileRegistry.tsx'
import { matchOutline, needsOutlineConfirmation } from './profile-match.ts'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { profileSizeLabel } from '../profiles.ts'
import type { Evidence, Observation } from './contracts.ts'
import {filteredReviewRows,reviewStatus as status,reviewImageSelection} from './review-display.ts'
import type {ReviewDisplay} from './review-display.ts'
type IdFilter={text:string;mode:'contains'|'startsWith'}
const emptyIdFilter=():IdFilter=>({text:'',mode:'contains'})
function readIdFilter(key:string):IdFilter{try{const v=key?JSON.parse(sessionStorage.getItem(key)??'null'):null;return typeof v?.text==='string'&&['contains','startsWith'].includes(v.mode)?{text:v.text,mode:v.mode}:emptyIdFilter()}catch{return emptyIdFilter()}}
export type ReviewSelectionControls={markedIds:string[];visibleIds:string[];select:(ids:string[])=>void}
export function ReviewWorkspace({active,evidence,imageWidth,imageHeight,selected,onSelect,busy,saveControl,inputControl,onAdd,addDisabled,children,spatial=false,confirmedIds=[],spatialLabels,display,imageControls,evidenceLabel,currentImageId,bulkControl,inputHelp,moduleControls,moduleNames,idFilterScope=''}:{active:boolean;evidence?:Evidence;imageWidth:number;imageHeight:number;selected:string;onSelect:(id:string)=>void;busy:boolean;saveControl:ReactNode;inputControl:ReactNode;onAdd:()=>void;addDisabled:boolean;children:ReactNode;spatial?:boolean;confirmedIds?:string[];spatialLabels?:Record<string,string>;display:ReviewDisplay;imageControls?:ReactNode;evidenceLabel?:string;currentImageId:string;bulkControl?:ReactNode;inputHelp?:string;moduleControls?:(selection:ReviewSelectionControls)=>ReactNode;moduleNames?:Record<string,string>;idFilterScope?:string}){
 const {registry:{profiles}}=useProfileRegistry()
 const scroll=useRef<HTMLDivElement>(null)
 useEffect(()=>{
  const box=scroll.current,row=box?.querySelector<HTMLElement>('tr[aria-selected=true]')
  if(box&&row){const b=box.getBoundingClientRect(),r=row.getBoundingClientRect(),header=box.querySelector('thead')?.getBoundingClientRect().height??0;if(r.top<b.top+header)box.scrollTop+=r.top-b.top-header;else if(r.bottom>b.bottom)box.scrollTop+=r.bottom-b.bottom}
 },[selected,active])
 const layout=useDefaultLayout({id:'magnetic-review-vertical-v1',onlySaveAfterUserInteractions:true})
 const [zoom,setZoom]=useState(100),{query,filter,sort}=display.state
 const filterId=useId(),filterPopover=useRef<HTMLDivElement>(null),filterInput=useRef<HTMLInputElement>(null)
 const filterKey=spatial&&idFilterScope?'magnetic-review-id-filter.v1:'+idFilterScope:'', [filterState,setFilterState]=useState<{key:string;value:IdFilter}>({key:'',value:emptyIdFilter()})
 const idFilter=filterState.key===filterKey?filterState.value:readIdFilter(filterKey)
 function setIdFilter(value:IdFilter){setFilterState({key:filterKey,value});try{if(filterKey){if(value.text.trim())sessionStorage.setItem(filterKey,JSON.stringify(value));else sessionStorage.removeItem(filterKey)}}catch{/* Optional display preference. */}}
 const [idDraft,setIdDraft]=useState(idFilter),[filterPosition,setFilterPosition]=useState({top:0,left:0})
 const observations=evidence?.observations??[],chosen=observations.find(o=>o.id===selected)
 const expected=observations.filter(o=>!o.excluded),pending=expected.filter(o=>!confirmedIds.includes(o.id)),confirmed=expected.length-pending.length
 const scoped=observations.filter(o=>display.visibleIds.includes(o.id)),baseRows=filteredReviewRows(observations,display.visibleIds,display.state,o=>profiles.find(p=>p.id===o.profileId&&p.version===o.profileVersion)?.name??'')
 const term=idFilter.text.trim().toLocaleLowerCase(),rows=spatial&&term?baseRows.filter(o=>idFilter.mode==='startsWith'?o.id.toLocaleLowerCase().startsWith(term):o.id.toLocaleLowerCase().includes(term)):baseRows
 // The column filter changes rendered rows only. Existing evidence selection and
 // batch controls continue to use the original, unfiltered operation scope.
 const selection=reviewImageSelection(display.state,currentImageId,display.idsForImage(currentImageId),baseRows.map(o=>o.id),spatial),markedIds=selection.markedIds
 const mark=(ids:string[],manual=true)=>display.update({markedIds:ids,annotationScope:selection.scope,...(spatial&&manual?{manualSelection:true}:{})})
 const markedKey=markedIds.join('\0'),savedMarkedKey=display.state.markedIds.join('\0')
 useLayoutEffect(()=>{if(active&&!busy&&(display.state.annotationScope!==selection.scope||markedKey!==savedMarkedKey))mark(markedIds,false)},[active,busy,selection.scope,display.state.annotationScope,markedKey,savedMarkedKey])
 const allMarked=!!selection.eligibleIds.length&&selection.eligibleIds.every(id=>markedIds.includes(id)),someMarked=markedIds.length>0
 const markAll=(checked:boolean)=>mark(spatial?(checked?[...new Set([...markedIds,...selection.eligibleIds])]:markedIds.filter(id=>!selection.eligibleIds.includes(id))):checked?selection.eligibleIds:[])
 const statusContent=(o:Observation)=><>{status(o)}{spatial&&<small data-confirmation-state={o.excluded?'excluded':confirmedIds.includes(o.id)?'confirmed':'pending'} className={!o.excluded&&!confirmedIds.includes(o.id)?'review-confirmation-blocker':undefined}>{o.excluded?'已排除 · 不参与重建':confirmedIds.includes(o.id)?'人工已确认':'等待人工确认'}</small>}{o.excluded&&<small>{o.profileId==='unknown'?'Unknown':'Known'} · 证据保留</small>}</>
 if(!active)return <>{children}</>
 return <Group orientation="vertical" className="review-workspace" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
  <Panel id="parts" defaultSize="70%" minSize="20%">
   <section className="review-parts" aria-label="Parts Review Table">
    <div className={`review-table-tools${spatial?' review-spatial-toolbar':''}`}>
    {spatial?<>
     <div className="review-toolbar review-toolbar-primary">
      <div className="review-filters" role="group" aria-label="Review 统计与筛选" data-testid="review-confirmation-progress" data-confirmed={confirmed} data-pending={pending.length} data-expected={expected.length} data-excluded={observations.length-expected.length}>
       {(['All','Known','Unknown','Excluded'] as const).map(f=>{const count=f==='All'?observations.length:observations.filter(o=>status(o)===f).length;return <button key={f} aria-pressed={filter===f} onClick={()=>display.update({filter:f})}>{f==='All'?'全部':f} {count}{f==='Known'&&count!==confirmed&&<small> · 确认 {confirmed}</small>}{f==='Unknown'&&count!==pending.length&&<small> · 待确认 {pending.length}</small>}</button>})}
       <InfoHint label="审核统计">{`完整 Review：已确认 ${confirmed}/${expected.length} · 尚未确认 ${pending.length} · 已排除 ${observations.length-expected.length}。Known / Unknown 按正式 Profile 筛选；存在性确认独立。Excluded 不参与重建。${confirmed===0?'无法执行 Spatial Planning：请确认至少一个实例并保存 Review。':pending.length?'未确认实例不参与本次部分重建。':'全部应审核实例已确认。'}`}</InfoHint>
      </div>
      <div className="review-search"><input aria-label="搜索审核零件" placeholder="搜索 ID、Profile 或证据" value={query} onChange={e=>display.update({query:e.target.value})}/><select aria-label="审核零件排序" value={sort} onChange={e=>display.update({sort:e.target.value as typeof sort})}><option value="original">原始顺序</option><option value="id">ID 升序</option><option value="confidence">Confidence 从低到高</option><option value="status">状态 / ID</option></select></div>
      {imageControls}{moduleControls?.({markedIds,visibleIds:baseRows.map(o=>o.id),select:mark})}<InfoHint label="图片与标注筛选">多图按 OR 过滤表格；当前证据图片切换时自动勾选该图内可见行；手动选择后跨图保留，使用“按当前图片选择”明确同步。表格 Checkbox 仅控制标注，不代表人工确认。Observation ID 列筛选只隐藏行，不改变标注勾选或批量操作范围。批量采用针对完整 Review，不受这些筛选影响。{chosen&&!rows.includes(chosen)&&<><br/>当前选中 {selected} 被筛选隐藏，选中对象未改变。<button onClick={()=>{setIdFilter({text:'',mode:'contains'});display.update({query:'',filter:'All',imageIds:null})}}>显示全部零件</button></>}</InfoHint>
     </div>
     <div className="review-toolbar review-toolbar-actions">
      <div className="review-display-summary"><button disabled={busy||!selection.eligibleIds.length} title={spatial&&term?'选择原有筛选范围；Observation ID 筛选不改变勾选范围':spatial?'选择当前筛选结果；隐藏勾选项保留':'勾选当前图片中、且在表格筛选范围内的实例'} onClick={()=>markAll(true)}>全选当前结果</button><button disabled={busy||!markedIds.length} onClick={()=>mark([])}>清空勾选</button><button disabled={busy||!currentImageId} onClick={()=>mark(display.idsForImage(currentImageId).filter(id=>baseRows.some(o=>o.id===id)))}>按当前图片选择</button><span className="review-view-count" title={markedIds.join(', ')}>显示 {rows.length}/{observations.length} · 已勾选 {markedIds.length}{markedIds.some(id=>!rows.some(o=>o.id===id))&&`（隐藏 ${markedIds.filter(id=>!rows.some(o=>o.id===id)).length}）`}</span></div>
      <div className="review-bulk-actions">{bulkControl}</div>
      <div className="review-save-actions">{saveControl}<span className="review-reconstruction-action">{inputControl}<InfoHint label="进入 3D Reconstruction">{inputHelp??'请先保存 Review；Spatial Planning 仅使用已保存、已确认且未排除的实例，未确认实例不参与本次部分重建。'} </InfoHint>{confirmed===0&&<span className="review-confirmation-blocker" role="status">待确认</span>}</span></div>
     </div>
    </>:<><div className="review-toolbar">
     <div className="review-filters">{(['All','Known','Unknown','Excluded'] as const).map(f=><button key={f} aria-pressed={filter===f} onClick={()=>display.update({filter:f})}>{f==='All'?'全部':f} {f==='All'?scoped.length:scoped.filter(o=>status(o)===f).length}</button>)}</div>
     <div className="review-search"><input aria-label="搜索审核零件" placeholder="搜索 ID、Profile 或证据" value={query} onChange={e=>display.update({query:e.target.value})}/><select aria-label="审核零件排序" value={sort} onChange={e=>display.update({sort:e.target.value as typeof sort})}><option value="original">原始顺序</option><option value="id">ID 升序</option><option value="confidence">Confidence 从低到高</option><option value="status">状态 / ID</option></select></div>
     {imageControls}<div className="review-title-row">{!spatial&&<button disabled={addDisabled} onClick={()=>{display.update({query:'',filter:'All',imageIds:null});onAdd()}}>新增零件</button>}{saveControl}</div>{inputControl}
    </div>
    <div className="review-display-summary"><span>显示 {rows.length}/{observations.length} · 标注：已勾选 {markedIds.length} 个</span><button disabled={busy||!selection.eligibleIds.length} title={spatial?'选择当前筛选结果；隐藏勾选项保留':'勾选当前图片中、且在表格筛选范围内的实例'} onClick={()=>markAll(true)}>全选当前结果</button><button disabled={busy||!markedIds.length} onClick={()=>mark([])}>清空勾选</button><span className="hint">切图同步勾选；勾选仅控制标注，不代表人工确认</span></div>
    </>}
     {!spatial&&chosen&&!rows.includes(chosen)&&<p role="status">当前选中 {selected} 被筛选隐藏，选中对象未改变。<button onClick={()=>display.update({query:'',filter:'All',imageIds:null})}>显示全部零件</button></p>}
    </div>
    <div ref={scroll} className="review-table-scroll" tabIndex={0} aria-label="零件表滚动区"><table className="review-parts-table"><thead><tr><th scope="col" className="review-mark-cell"><input type="checkbox" aria-label="全选当前筛选结果" checked={allMarked} ref={el=>{if(el)el.indeterminate=someMarked&&!allMarked}} disabled={busy||!selection.eligibleIds.length} onChange={e=>markAll(e.target.checked)}/></th><th scope="col">Observation ID{spatial&&<><button type="button" className="review-id-filter-trigger" aria-label="筛选 Observation ID" aria-haspopup="dialog" aria-pressed={!!term} title={term?'Observation ID 筛选已启用':'筛选 Observation ID'} popoverTarget={filterId} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setIdDraft(idFilter);setFilterPosition({top:Math.max(8,Math.min(r.bottom+4,window.innerHeight-180)),left:Math.max(8,Math.min(r.left,window.innerWidth-250))});setTimeout(()=>filterInput.current?.focus(),0)}}><svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 3h12L9.4 8.2v4L6.6 14V8.2L2 3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg></button><div id={filterId} ref={filterPopover} popover="auto" role="dialog" aria-label="Observation ID 筛选" className="review-id-filter-popover" style={filterPosition}><form onSubmit={e=>{e.preventDefault();setIdFilter(idDraft);filterPopover.current?.hidePopover()}}><label>Observation ID<input ref={filterInput} aria-label="Observation ID 筛选文本" value={idDraft.text} onChange={e=>setIdDraft(d=>({...d,text:e.target.value}))}/></label><label>匹配方式<select aria-label="Observation ID 匹配方式" value={idDraft.mode} onChange={e=>setIdDraft(d=>({...d,mode:e.target.value as 'contains'|'startsWith'}))}><option value="contains">Contains</option><option value="startsWith">Starts With</option></select></label><div><button type="button" onClick={()=>{const empty={text:'',mode:'contains' as const};setIdDraft(empty);setIdFilter(empty);filterPopover.current?.hidePopover()}}>Clear</button><button type="submit">Apply</button></div></form></div></>}</th>{[...(moduleNames?['Module']:[]),'Profile / ID / Version','状态','Size · 几何规格','颜色','Confidence','最佳形状匹配','关系 / 不确定性'].map(h=><th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{rows.map(o=>{
     const p=profiles.find(p=>p.id===o.profileId&&p.version===o.profileVersion),xs=o.outline.map(v=>v[0]),ys=o.outline.map(v=>v[1]),links=evidence?.relations.filter(r=>r.from===o.id||r.to===o.id)??[]
     const match=spatial?{candidates:[],reason:'3D 透视证据不适用二维轮廓匹配',status:'invalid'}:matchOutline(o.outline,imageWidth,imageHeight,profiles),best=match.candidates[0],name=profiles.find(p=>p.id===best?.profileId&&p.version===best?.profileVersion)?.name
     return <tr key={o.id} data-review-id={o.id} aria-selected={selected===o.id} tabIndex={busy?-1:0} onClick={()=>{if(!busy)onSelect(o.id)}} onKeyDown={e=>{if(e.target===e.currentTarget&&!busy&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onSelect(o.id)}}}>
      <td className="review-mark-cell" onClick={e=>e.stopPropagation()}><input type="checkbox" aria-label={'显示证据 '+o.id} checked={markedIds.includes(o.id)} disabled={busy||!selection.eligibleIds.includes(o.id)} title={selection.eligibleIds.includes(o.id)?spatial?'选择 Observation；当前图片没有证据时不生成标注':'仅控制当前图片的证据标注':'当前图片没有此实例的证据；可点击行查看详情或切换图片'} onChange={e=>mark(e.target.checked?[...markedIds,o.id]:markedIds.filter(id=>id!==o.id))}/></td>
      <td>{o.id}</td>{moduleNames&&<td className="review-module-cell" title={moduleNames[o.id]??'未分配'}>{moduleNames[o.id]??'未分配'}</td>}<td>{p?<>{p.name}<small>{p.id} · v{p.version}</small></>:<>Unknown<small>无正式 Profile</small></>}{spatialLabels?.[o.id]&&<small>AI 形状：{spatialLabels[o.id]}</small>}</td><td>{statusContent(o)}</td>
      <td>{p?profileSizeLabel(p):spatial?<>可见区域 / 局部边角证据<small>Profile Unknown，不能从透视轮廓推断实际尺寸</small></>:<>视觉估计：图片包围框 {((Math.max(...xs)-Math.min(...xs))*100).toFixed(1)}% × {((Math.max(...ys)-Math.min(...ys))*100).toFixed(1)}%<small>非物理尺寸，非正式规格</small></>}</td>
      <td><span className="review-color" style={{background:o.color}}/>{o.color}</td><td>{spatial?'未评估':`${Math.round(o.confidence*100)}%`}</td><td title={match.reason}>{spatial?'3D · 未作投影匹配':match.status==='invalid'?'无法评分':`${name} · ${best?.similarityScore.toFixed(1)}%${needsOutlineConfirmation(o)?' · ⚠ 仅供参考':''}`}</td><td>{links.length} 条关系 · {links.filter(r=>r.intent==='uncertain').length} 条不确定{o.uncertainty&&<small className="review-uncertainty" title={o.uncertainty}>⚑ {o.uncertainty}</small>}</td>
     </tr>
    })}</tbody></table>{!rows.length&&<p>没有符合筛选条件的零件。请调整筛选或从左栏打开 Analysis / Review。</p>}</div>
   </section>
  </Panel>
  <Separator className="studio-separator review-separator" aria-label="调整零件表与原图高度" title="拖动或使用方向键调整上下高度"/>
  <Panel id="evidence" defaultSize="30%" minSize="15%">
   <section className="review-evidence" aria-label="Source Evidence"><div className="review-evidence-tools"><b>原图证据（Source Evidence）</b><span title={evidenceLabel}>{evidenceLabel}</span>{spatial?<span>完整图片 · 自动适配</span>:<label>缩放<select aria-label="审核原图缩放" value={zoom} onChange={e=>setZoom(Number(e.target.value))}><option value={100}>完整图片</option><option value={200}>200%</option><option value={300}>300%</option></select></label>}</div>
    {spatial?<><div className="review-evidence-fit" aria-label="原图证据预览区">{children}</div>{chosen&&<details className="review-selected-evidence review-spatial-evidence-description"><summary>{chosen.id}{chosen.excluded?' · 已排除':''} · 证据说明</summary><p>{chosen.evidence}</p><p>{chosen.uncertainty}</p></details>}</>:<div className="review-evidence-scroll" tabIndex={0} aria-label="原图证据滚动区"><div className="review-evidence-content" style={{width:`${zoom}%`,height:`${zoom}%`}}>{children}</div>{chosen&&<div className="review-selected-evidence"><b>{chosen.id}{chosen.excluded?' · 已排除，原图不显示轮廓':''}</b><p>{chosen.evidence}</p><p>{chosen.uncertainty}</p></div>}</div>}
   </section>
  </Panel>
 </Group>
}
