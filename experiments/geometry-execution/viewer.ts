import { BrickViewer } from '../../src/brick-test/viewer'
import { validateFinalAssembly } from '../../src/brick-test/assembly'
import { PARTS, validPosition } from '../../src/brick-test/catalog'
import type { Brick } from '../../src/brick-test/catalog'
import { assessDesignDisplay } from '../../src/brick-design-display.mjs'

const status=document.querySelector<HTMLDivElement>('#status')!
const error=document.querySelector<HTMLDivElement>('#error')!
const select=document.querySelector<HTMLSelectElement>('#candidate')!
const report=document.querySelector<HTMLPreElement>('#report')!
const viewer=new BrickViewer(document.querySelector<HTMLElement>('#scene')!,import.meta.env.BASE_URL+'brick-ldraw/',message=>{error.textContent=message})
const appearance=document.createElement('p')
appearance.textContent='LDraw 几何预览：通过基础几何映射的印花未渲染；具体印花身份保留在原计划的确认型号与 Mapping 证据中。'
status.after(appearance)
type Entry={id:string;layoutId:string;file:string;bricks:Brick[]}
type Index={purpose?:'refinement-review';diagnosticAssembly?:{bricks:Brick[];note:string};status:string;completeSearch:boolean;diagnostics:unknown[];groups:unknown[];candidates:Entry[];image:{mimeType:string;imageBase64:string};sourcePlan:unknown}
let diagnostic=false
let index:Index,base:URL|undefined, revision=0
const pose={x:-0.85,y:0.8,z:2.2}
async function show() {
  const token=++revision
  select.disabled=true;error.textContent='';status.textContent='加载真实 LDraw 零件…'
  try {
    const c=diagnostic?{id:'diagnostic-only',layoutId:'非合法候选',file:'',bricks:index.diagnosticAssembly!.bricks}:index.candidates[Number(select.value)]
    if(!c)throw new Error('没有可显示候选')
    const display=assessDesignDisplay({bricks:c.bricks},{PARTS,COLORS:c.bricks.filter(b=>/^(0|[1-9]\d*)$/.test(b.color)).map(b=>({code:b.color})),validPosition})
    if(!display.renderable)throw new Error(display.issues.join('; '))
    const geometry=validateFinalAssembly(c.bricks)
    const detail=base && !diagnostic ? await fetch(new URL(c.file,base)).then(r=>{if(!r.ok)throw new Error('Candidate HTTP '+r.status);return r.json()}) : null
    if(token!==revision)return
    if(!await viewer.replace(c.bricks))throw new Error('模型未完整加载')
    if(token!==revision)return
    viewer.fit(pose)
    document.querySelector<HTMLDivElement>('#difference')!.textContent=diagnostic ? index.diagnosticAssembly!.note : c.id+' / '+c.layoutId+'；相对首候选差异：'+(c.bricks.map(b=>{
      const first=index.candidates[0].bricks.find(a=>a.id===b.id)!
      return JSON.stringify(first)===JSON.stringify(b)?'':b.id+' '+JSON.stringify({x:b.x,z:b.z,layer:b.layer,yaw:b.rotation})
    }).filter(Boolean).join('；')||'无（默认首候选）')
    report.textContent=JSON.stringify({currentGeometry:geometry,recorded:detail??'选择本地 viewer.json 时只做当前几何复核；完整记录请打开同目录 report.json。'},null,2)
    status.style.color=diagnostic||!geometry.valid?'#991b1b':index.purpose==='refinement-review'?'#92400e':'#166534'
    status.style.background=diagnostic||!geometry.valid?'#fef2f2':'#f0fdf4'
    status.style.padding='12px'
    status.textContent=(index.purpose==='refinement-review'?'Refinement 审核预览 · 未批准 · '+c.id+' / '+c.layoutId+' · ':'')+(diagnostic?'失败布局诊断 · 非合法候选 · ':'')+'Geometry '+(geometry.valid?'Valid':'Invalid')+' · '+c.bricks.length+' 块 · '+(geometry.valid?geometry.connections.length+' 对连接 · '+geometry.connections.reduce((n,c)=>n+c.points.length,0)+' 个接合点':geometry.reason+'；连接总数未完成统计')+' · '+index.candidates.length+(index.purpose==='refinement-review'?' 个审核布局（含原始布局）':' 个候选 / '+index.groups.length+' 个位置布局')+'；未测试 Build Order。'
    document.body.dataset.ready='true'
    document.body.dataset.candidate=c.id
  }catch(e){error.textContent=String(e);status.textContent='加载或校验失败';document.body.dataset.ready='error'}
  finally{if(token===revision)select.disabled=false}
}
async function load(data:Index,url?:URL) {
  ++revision;index=data;base=url;diagnostic=!data.candidates.length&&!!data.diagnosticAssembly
  if(!Array.isArray(data.candidates)||!Array.isArray(data.groups))throw new Error('需要 Geometry Execution viewer.json')
  select.replaceChildren(...(diagnostic?[{id:'失败布局（非合法候选）',layoutId:'诊断'}]:data.candidates).map((c,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=c.id+' / '+c.layoutId;return o}))
  const image=document.querySelector<HTMLImageElement>('#photo')!
  if(!/^image\/(jpeg|png|webp)$/.test(data.image.mimeType)||!/^[A-Za-z0-9+/]+={0,2}$/.test(data.image.imageBase64))throw new Error('Invalid saved image')
  image.src='data:'+data.image.mimeType+';base64,'+data.image.imageBase64
  document.querySelector('#plan')!.textContent=JSON.stringify(data.sourcePlan,null,2)
  if(!data.candidates.length&&!diagnostic){viewer.reset();status.textContent='无候选：'+data.status;report.textContent=JSON.stringify(data.diagnostics,null,2);return}
  const requested=new URLSearchParams(location.search).get('candidate')
  if(requested&&data.candidates.some(c=>c.id===requested))select.value=String(data.candidates.findIndex(c=>c.id===requested))
  await show()
}
select.addEventListener('change',()=>void show())
document.querySelector<HTMLInputElement>('#file')!.addEventListener('change',async e=>{
  try{const f=(e.target as HTMLInputElement).files?.[0];if(f)await load(JSON.parse(await f.text()))}catch(e){error.textContent=String(e)}
})
document.querySelector('#photo-view')!.addEventListener('click',()=>viewer.fit(pose))
document.querySelector('#front')!.addEventListener('click',()=>viewer.fit({x:0,y:0,z:1}))
document.querySelector('#back')!.addEventListener('click',()=>viewer.fit({x:0,y:0.4,z:-1}))
document.querySelector('#fit')!.addEventListener('click',()=>viewer.fit())
const source=new URLSearchParams(location.search).get('result')
if(source){const url=new URL(source,location.href);if(url.origin!==location.origin)throw new Error('Local same-origin results only');fetch(url).then(r=>{if(!r.ok)throw new Error('Index HTTP '+r.status);return r.json()}).then(data=>load(data,url)).catch(e=>{error.textContent=String(e)})}
window.addEventListener('pagehide',()=>viewer.dispose(),{once:true})
