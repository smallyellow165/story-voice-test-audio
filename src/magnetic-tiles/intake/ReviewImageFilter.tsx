import {useId,useState} from 'react'
import type {AnalysisImage} from './image-set.ts'
/** Native non-modal popover keeps any number of filenames out of table height. */
export function ReviewImageFilter({entries,imageIds,activeId,onImages,onActive}:{entries:AnalysisImage[];imageIds:string[];activeId:string;onImages:(ids:string[]|null)=>void;onActive:(id:string)=>void}){
 const id=useId(),[query,setQuery]=useState(''),[position,setPosition]=useState({top:80,left:20})
 if(entries.length<2)return null
 const images=entries.filter(e=>imageIds.includes(e.sourceId))
 return <div className="review-image-filter">
  <button className="review-image-trigger" popoverTarget={id} aria-haspopup="dialog" title="按来源图片过滤表格和证据；不修改审核数据" onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setPosition({top:Math.max(8,Math.min(r.bottom+4,window.innerHeight-340)),left:Math.max(8,Math.min(r.left,window.innerWidth-360))})}}>图片 {images.length}/{entries.length} ▾</button>
  <div id={id} popover="auto" role="dialog" aria-label="Review 图片筛选" className="review-image-popover" style={position}>
   <div className="review-image-popover-actions"><b>来源图片</b><button onClick={()=>onImages(null)}>全部图片</button><button onClick={()=>onImages([])}>清除图片</button><button popoverTarget={id} popoverTargetAction="hide" aria-label="关闭图片筛选">×</button></div>
   <input aria-label="搜索审核图片" placeholder="搜索文件名" value={query} onChange={e=>setQuery(e.target.value)}/>
   <div className="review-image-options">{entries.filter(e=>e.name.toLowerCase().includes(query.toLowerCase())).map(e=><label key={e.sourceId} title={e.name}><input type="checkbox" aria-label={'筛选图片 '+e.name} checked={imageIds.includes(e.sourceId)} onChange={v=>onImages(v.target.checked?[...imageIds,e.sourceId]:imageIds.filter(id=>id!==e.sourceId))}/><span>{e.name}</span></label>)}</div>
  </div>
  <select aria-label="当前证据图片" title={entries.find(e=>e.sourceId===activeId)?.name??'尚未选择图片'} value={images.some(e=>e.sourceId===activeId)?activeId:''} disabled={!images.length} onChange={e=>onActive(e.target.value)}>{!images.length&&<option value="">尚未选择图片</option>}{images.map(e=><option key={e.sourceId} value={e.sourceId}>{e.name}</option>)}</select>
 </div>
}
