import {createRoot} from 'react-dom/client'
import {useEffect,useRef,useState} from 'react'
import './style.css'
type Row={id:string;source:string;createdAt:string;provider:string;model:string;promptVersion:string;status:string}
type Content={available:boolean;text:string;origin?:string;changes?:{credentials:number;images:number}}
type Detail=Row&{request:Content;response:Content;parsed:Content}
const tabs={request:'Raw Request',response:'Raw Response',parsed:'Parsed Result（解析结果）'}
async function get(path:string,signal?:AbortSignal){const r=await fetch('/api/llm-traces'+path,{signal});if(!r.headers.get('content-type')?.includes('application/json'))throw Error('Trace API 尚未加载，请重启开发服务后刷新页面。');const data=await r.json();if(!r.ok)throw Error(data.error||'读取失败');return data}
function Modal({row,close}:{row:Pick<Row,'source'|'id'>;close():void}){
 const dialog=useRef<HTMLDialogElement>(null),[data,setData]=useState<Detail|null>(null),[error,setError]=useState(''),[tab,setTab]=useState<keyof typeof tabs>('request'),[copied,setCopied]=useState('')
 useEffect(()=>{dialog.current?.showModal();const c=new AbortController();get('/'+encodeURIComponent(row.source)+'/'+encodeURIComponent(row.id),c.signal).then(setData).catch(e=>{if(!c.signal.aborted)setError(String(e))});return()=>c.abort()},[row.source,row.id])
 const current=data?.[tab]
 return <dialog ref={dialog} onCancel={close} aria-labelledby="trace-title"><header><h2 id="trace-title">Trace · {row.id}</h2><button onClick={close}>Close</button></header>
 {data&&<p>{data.source} · {data.provider} / {data.model} · {data.promptVersion} · {data.status}</p>}
 <nav aria-label="Trace 内容">{Object.entries(tabs).map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>{setTab(key as keyof typeof tabs);setCopied('')}}>{label}</button>)}</nav>
 <p>只读脱敏视图：隐藏凭据，省略图片 base64 并明确标记；Copy 复制当前 Tab 的全部脱敏文本，不仅是可见部分。</p>
 {error?<p role="alert">{error}</p>:!data?<p role="status">加载中…</p>:<>
 <div className="copy-bar"><span>{current?.origin||'unavailable'}</span><button disabled={!current?.available} onClick={async()=>{try{await navigator.clipboard.writeText(current!.text);setCopied('已复制完整脱敏文本')}catch{setCopied('复制失败，请在文本框内全选后复制')}}}>Copy 脱敏文本</button><span role="status">{copied}</span></div>
 {current?.changes&&<small>凭据处理：{current.changes.credentials} · 图片省略：{current.changes.images} · {current.text.length.toLocaleString()} 字符</small>}
 <textarea aria-label={tabs[tab]} readOnly spellCheck={false} value={current?.text||'unavailable'}/></>}
 </dialog>
}
function App(){
 const params=new URL(location.href).searchParams
 const [selection,setSelection]=useState<Pick<Row,'source'|'id'>|null>(params.get('id')?{id:params.get('id')!,source:params.get('source')||''}:null)
 const [rows,setRows]=useState<Row[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[warning,setWarning]=useState(0)
 useEffect(()=>{const c=new AbortController();get('',c.signal).then(v=>{setRows(v.items);setWarning(v.unreadable)}).catch(e=>{if(!c.signal.aborted)setError(String(e))}).finally(()=>{if(!c.signal.aborted)setLoading(false)});return()=>c.abort()},[])
 function select(row:Pick<Row,'source'|'id'>|null){setSelection(row);const u=new URL(location.href);if(row){u.searchParams.set('source',row.source);u.searchParams.set('id',row.id)}else{u.searchParams.delete('source');u.searchParams.delete('id')}history.replaceState(null,'',u)}
 return <main><h1>LLM Trace Viewer</h1><p>Part Explorer / Reverse Geometry 与 Spatial Planning · 历史只读 · 不调用模型</p>
 {loading&&<p role="status">读取历史元信息…</p>}{error&&<p role="alert">{error}</p>}{warning>0&&<p>{warning} 条记录无法读取。</p>}
 <table><thead><tr>{['时间','来源 / 功能','Provider / Model','Prompt Version','Status'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.source+r.id} onClick={()=>select(r)}><td><button onClick={e=>{e.stopPropagation();select(r)}}>{r.createdAt}</button><small>{r.id}</small></td><td>{r.source==='reverse'?'Part Explorer / Reverse Geometry':'Spatial Planning'}</td><td>{r.provider||'Unknown'} / {r.model||'Unknown'}</td><td>{r.promptVersion||'Unknown'}</td><td>{r.status}</td></tr>)}</tbody></table>
 {!loading&&!error&&!rows.length&&<p>没有历史 Trace。</p>}{selection&&<Modal key={selection.source+selection.id} row={selection} close={()=>select(null)}/>}</main>
}
createRoot(document.getElementById('trace-root')!).render(<App/>);
