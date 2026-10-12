interface CaseData {name:string;reference:string;stt_sequence:[string,string][];note:string}
interface SavedCase {id:string;revision:string;data:CaseData}
export function setupTestCases(select:HTMLSelectElement, fill:(reference:string,sequence:string)=>void, draft:()=>{reference:string;sequence:string}) {
 const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T
 const name=get<HTMLInputElement>('case-name'), note=get<HTMLTextAreaElement>('case-note'), message=get('case-message')
 const group=document.createElement('optgroup');group.label='已保存 JSON Test Cases';select.append(group)
 let cases:SavedCase[]=[], current:SavedCase|undefined
 const api=async(body?:unknown)=>{
  const response=await fetch('/api/debug/reading-test-cases',body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  const result=await response.json();if(!response.ok) throw new Error(result.error);return result
 }
 async function refresh() {
  const result=await api();cases=result.cases;const selected=select.value;group.replaceChildren()
  for(const item of cases) {const option=document.createElement('option');option.value=`case:${item.id}`;option.textContent=item.data.name;group.append(option)}
  select.value=selected
  if(result.errors.length) message.textContent=result.errors.join('; ')
 }
 function choose() {
  current=cases.find(c=>`case:${c.id}`===select.value)
  get<HTMLButtonElement>('case-overwrite').disabled=!current
  if(!current) {name.value='';note.value='';return false}
  name.value=current.data.name;note.value=current.data.note
  fill(current.data.reference,JSON.stringify(current.data.stt_sequence,null,2))
  message.textContent=`已填入 ${current.id}；请 Load STT Sequence 后再 Match。`
  return true
 }
 async function save(overwrite:boolean) {
  try {
   if (!name.value.trim()) {get<HTMLDetailsElement>('case-meta').open=true;name.focus();throw new Error('请填写 Case 名称，并注明输入来源。')}
   const input=draft(), data={name:name.value,reference:input.reference,stt_sequence:JSON.parse(input.sequence),note:note.value}
   if(overwrite && (!current || !window.confirm(`确认覆盖 ${current.id}（${current.data.name}）？仅保存当前输入，不保存参数或结果。`))) return
   const saved:SavedCase=await api({data,...(overwrite?{id:current!.id,expectedRevision:current!.revision}:{})})
   await refresh();select.value=`case:${saved.id}`;current=saved;get<HTMLButtonElement>('case-overwrite').disabled=false
   message.textContent=`已保存 data/reading-test-cases/${saved.id}；未执行 Load 或 Match。`
  } catch(e) {message.textContent=String(e)}
 }
 get('case-save').onclick=()=>void save(false)
 get('case-overwrite').onclick=()=>void save(true)
 get('case-reload').onclick=async()=>{
  try {
   if (!window.confirm('重新读取所选用例到编辑区？当前未保存的编辑会被替换，不会执行 Match。')) return
   const id=select.value;await refresh();select.value=id;choose()
  }catch(e){message.textContent=String(e)}
 }
 void refresh().catch(e=>{message.textContent=`用例接口不可用：${String(e)}；仍可手动输入。`})
 return choose
}
