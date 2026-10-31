import { useProfileRegistry } from '../ProfileRegistry.tsx'
import { workflowTerms } from '../studio-terms.ts'
import { matchOutline, needsOutlineConfirmation } from './profile-match.ts'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { profileSizeLabel } from '../profiles.ts'
import type { Evidence, Observation } from './contracts.ts'
const status=(o:Observation)=>o.excluded?'Excluded':o.profileId==='unknown'?'Unknown':'Known'
export function ReviewWorkspace({active,evidence,imageWidth,imageHeight,selected,onSelect,busy,saveControl,inputControl,onAdd,addDisabled,children,spatial=false,confirmedIds=[]}:{active:boolean;evidence?:Evidence;imageWidth:number;imageHeight:number;selected:string;onSelect:(id:string)=>void;busy:boolean;saveControl:ReactNode;inputControl:ReactNode;onAdd:()=>void;addDisabled:boolean;children:ReactNode;spatial?:boolean;confirmedIds?:string[]}){
 const {registry:{profiles}}=useProfileRegistry()
 const scroll=useRef<HTMLDivElement>(null)
 useEffect(()=>{
  const box=scroll.current,row=box?.querySelector<HTMLElement>('tr[aria-selected=true]')
  if(box&&row){const b=box.getBoundingClientRect(),r=row.getBoundingClientRect(),header=box.querySelector('thead')?.getBoundingClientRect().height??0;if(r.top<b.top+header)box.scrollTop+=r.top-b.top-header;else if(r.bottom>b.bottom)box.scrollTop+=r.bottom-b.bottom}
 },[selected,active])
 const layout=useDefaultLayout({id:'magnetic-review-vertical-v1',onlySaveAfterUserInteractions:true})
 const [query,setQuery]=useState(''),[filter,setFilter]=useState('All'),[sort,setSort]=useState('original'),[zoom,setZoom]=useState(100)
 const observations=evidence?.observations??[],chosen=observations.find(o=>o.id===selected)
 const rows=observations.filter(o=>{const p=profiles.find(p=>p.id===o.profileId&&p.version===o.profileVersion);return (filter==='All'||status(o)===filter)&&[o.id,p?.name,o.profileId,o.evidence,o.uncertainty].join(' ').toLowerCase().includes(query.trim().toLowerCase())})
 if(sort!=='original')rows.sort((a,b)=>sort==='confidence'?a.confidence-b.confidence:sort==='status'?status(a).localeCompare(status(b))||a.id.localeCompare(b.id):a.id.localeCompare(b.id,undefined,{numeric:true}))
 if(!active)return <>{children}</>
 return <Group orientation="vertical" className="review-workspace" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
  <Panel id="parts" defaultSize="65%" minSize="20%">
   <section className="review-parts" aria-label="Parts Review Table">
    <div className="review-table-tools"><div className="review-title-row"><h2 title={workflowTerms.review.label}>{workflowTerms.review.label}</h2><button disabled={addDisabled} onClick={()=>{setQuery('');setFilter('All');onAdd()}}>新增零件</button>{saveControl}</div>
     <div className="review-filter-row"><div className="review-filters">{['All','Known','Unknown','Excluded'].map(f=><button key={f} aria-pressed={filter===f} onClick={()=>setFilter(f)}>{f==='All'?'全部':f} {f==='All'?observations.length:observations.filter(o=>status(o)===f).length}</button>)}</div>{inputControl}</div>
     <div className="review-search"><input aria-label="搜索审核零件" placeholder="搜索 ID、Profile 或证据" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="审核零件排序" value={sort} onChange={e=>setSort(e.target.value)}><option value="original">原始顺序</option><option value="id">ID 升序</option><option value="confidence">Confidence 从低到高</option><option value="status">状态 / ID</option></select></div>
     {chosen&&!rows.includes(chosen)&&<p role="status">当前选中 {selected} 被筛选隐藏，选中对象未改变。<button onClick={()=>{setQuery('');setFilter('All')}}>显示全部零件</button></p>}
    </div>
    <div ref={scroll} className="review-table-scroll" tabIndex={0} aria-label="零件表滚动区"><table className="review-parts-table"><thead><tr>{['Observation ID','Profile / ID / Version','Size · 几何规格','颜色','Confidence','最佳形状匹配','状态','关系 / 不确定性'].map(h=><th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{rows.map(o=>{
     const p=profiles.find(p=>p.id===o.profileId&&p.version===o.profileVersion),xs=o.outline.map(v=>v[0]),ys=o.outline.map(v=>v[1]),links=evidence?.relations.filter(r=>r.from===o.id||r.to===o.id)??[]
     const match=spatial?{candidates:[],reason:'3D 透视证据不适用二维轮廓匹配',status:'invalid'}:matchOutline(o.outline,imageWidth,imageHeight,profiles),best=match.candidates[0],name=profiles.find(p=>p.id===best?.profileId&&p.version===best?.profileVersion)?.name
     return <tr key={o.id} data-review-id={o.id} aria-selected={selected===o.id} tabIndex={busy?-1:0} onClick={()=>{if(!busy)onSelect(o.id)}} onKeyDown={e=>{if(!busy&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onSelect(o.id)}}}>
      <td>{o.id}</td><td>{p?<>{p.name}<small>{p.id} · v{p.version}</small></>:<>Unknown<small>无正式 Profile</small></>}</td>
      <td>{p?profileSizeLabel(p):spatial?<>可见区域 / 局部边角证据<small>Profile Unknown，不能从透视轮廓推断实际尺寸</small></>:<>视觉估计：图片包围框 {((Math.max(...xs)-Math.min(...xs))*100).toFixed(1)}% × {((Math.max(...ys)-Math.min(...ys))*100).toFixed(1)}%<small>非物理尺寸，非正式规格</small></>}</td>
      <td><span className="review-color" style={{background:o.color}}/>{o.color}</td><td>{spatial?'未评估':`${Math.round(o.confidence*100)}%`}</td><td title={match.reason}>{spatial?'3D · 未作投影匹配':match.status==='invalid'?'无法评分':`${name} · ${best?.similarityScore.toFixed(1)}%${needsOutlineConfirmation(o)?' · ⚠ 仅供参考':''}`}</td><td>{status(o)}{spatial&&<small>{confirmedIds.includes(o.id)?'人工已确认':'等待人工确认'}</small>}{o.excluded&&<small>{o.profileId==='unknown'?'Unknown':'Known'} · 证据保留</small>}</td><td>{links.length} 条关系 · {links.filter(r=>r.intent==='uncertain').length} 条不确定{o.uncertainty&&<small className="review-uncertainty" title={o.uncertainty}>⚑ {o.uncertainty}</small>}</td>
     </tr>
    })}</tbody></table>{!rows.length&&<p>没有符合筛选条件的零件。请调整筛选或从左栏打开 Analysis / Review。</p>}</div>
   </section>
  </Panel>
  <Separator className="studio-separator review-separator" aria-label="调整零件表与原图高度" title="拖动或使用方向键调整上下高度"/>
  <Panel id="evidence" defaultSize="35%" minSize="15%">
   <section className="review-evidence" aria-label="Source Evidence"><div className="review-evidence-tools"><b>原图证据（Source Evidence）</b><label>缩放<select aria-label="审核原图缩放" value={zoom} onChange={e=>setZoom(Number(e.target.value))}><option value={100}>完整图片</option><option value={200}>200%</option><option value={300}>300%</option></select></label></div>
    <div className="review-evidence-scroll" tabIndex={0} aria-label="原图证据滚动区"><div className="review-evidence-content" style={{width:`${zoom}%`,height:`${zoom}%`}}>{children}</div>{chosen&&<div className="review-selected-evidence"><b>{chosen.id}{chosen.excluded?' · 已排除，原图不显示轮廓':''}</b><p>{chosen.evidence}</p><p>{chosen.uncertainty}</p></div>}</div>
   </section>
  </Panel>
 </Group>
}
