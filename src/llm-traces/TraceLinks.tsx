export function TraceLinks({source,id}:{source:'reverse'|'spatial';id?:string}){
 const base=import.meta.env.BASE_URL+'llm-traces.html'
 return <p>{id&&<a href={`${base}?source=${source}&id=${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">查看 Trace ↗</a>} {' · '}<a href={base} target="_blank" rel="noreferrer">全部 LLM Traces ↗</a></p>
}
