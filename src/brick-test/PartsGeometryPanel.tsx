import { useState } from 'react'
import { InfoHint } from '../brick-vision/InfoHint'
type Definition = { id: string; ldrawPartId?: string; profile?: unknown; resources?: unknown }
type Result = { partDefinition: Definition | null; geometryDefinition: Definition | null; colorMapping: { id: string; ldrawColor: string } | null; support: { mappingValid: boolean; geometrySupported: boolean; usable: boolean; issues: string[] }; row: unknown }
export function PartsGeometryPanel() {
 const [part, setPart] = useState(''), [color, setColor] = useState(''), [result, setResult] = useState<Result | null>(null)
 const [busy, setBusy] = useState(false), [error, setError] = useState('')
 async function query() {
  setBusy(true); setError(''); setResult(null)
  try {
   const response = await fetch('/api/brick-parts-geometry?' + new URLSearchParams({partNum:part.trim(),colorId:color.trim()}))
   const data = await response.json(); if(!response.ok)throw Error(data.error); setResult(data)
  } catch(e) { setError(String(e)) } finally { setBusy(false) }
 }
 return <details className="workflow-options"><summary>Parts Geometry · 共享零件定义</summary>
  <div className="vision-history-line"><strong>查询几何定义</strong><InfoHint label="Parts Geometry">读取已有官方映射、共享 Profile 和本地 LDraw 资源。不调用模型、不保存审核、不创建 Mapping Review。定义内容变化会改变其 hash 身份。</InfoHint></div>
  <label>Rebrickable 型号<input value={part} disabled={busy} onChange={e=>{setPart(e.target.value);setResult(null)}} /></label>
  <label>Rebrickable 颜色 ID<input value={color} disabled={busy} onChange={e=>{setColor(e.target.value);setResult(null)}} inputMode="numeric" /></label>
  <button type="button" disabled={busy||!part.trim()||!/^\d+$/.test(color.trim())} onClick={()=>void query()}>{busy?'查询中…':'查询 Parts Geometry'}</button>
  {error&&<p role="alert">{error}</p>}
  {result&&<><p role="status">映射：{result.support.mappingValid?'有效':'不可用'} · Geometry Profile：{result.support.geometrySupported?'支持':'缺失或未通过校验'} · 可用于几何：{result.support.usable?'是':'否'}</p>
   <p>LDraw：{result.partDefinition?.ldrawPartId ?? '未确认'} · 颜色：{result.colorMapping?.ldrawColor ?? '未确认'}</p>
   {!!result.support.issues.length&&<ul>{result.support.issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul>}
   <details><summary>尺寸、连接点、Profile 与资源身份</summary><pre>{JSON.stringify(result.geometryDefinition,null,2)}</pre></details>
   <details><summary>官方映射与完整校验证据</summary><pre>{JSON.stringify(result,null,2)}</pre></details>
  </>}
 </details>
}
