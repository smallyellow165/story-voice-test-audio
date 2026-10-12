import { mkdir, lstat, readdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
export const caseDirectory = fileURLToPath(new URL('../data/reading-test-cases/', import.meta.url))
export function validateCase(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['name','reference','stt_sequence','note'].includes(k))) throw new Error('仅允许 name/reference/stt_sequence/note')
  for (const [key,max] of [['name',120],['reference',20000],['note',4000]]) {
    if (typeof value[key] !== 'string' || value[key].length > max || (key !== 'note' && !value[key].trim())) throw new Error(`${key} 无效或过长`)
  }
  if (!Array.isArray(value.stt_sequence) || !value.stt_sequence.length || value.stt_sequence.length > 256 || value.stt_sequence.some(r => !Array.isArray(r) || r.length !== 2 || !['P','F'].includes(r[0]) || typeof r[1] !== 'string' || r[1].length > 4000)) throw new Error('stt_sequence 需要 1–256 条 [P/F, 文本]；不支持 pause/restart')
  if (Buffer.byteLength(JSON.stringify(value)) > 256000) throw new Error('用例过大')
  return value
}
const revision = data => createHash('sha256').update(data).digest('hex')
export function createCaseStore(directory = caseDirectory) {
  let queue = Promise.resolve()
  async function dir() { await mkdir(directory,{recursive:true}); if (!(await lstat(directory)).isDirectory()) throw new Error('用例目录不能为符号链接') }
  function path(id) { if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.json$/.test(id)) throw new Error('非法文件名'); return join(directory,id) }
  async function read(id) {
    await dir(); const file=path(id)
    if (!(await lstat(file)).isFile()) throw new Error('仅允许普通 JSON 文件，禁止符号链接')
    const raw=await readFile(file,'utf8'); return {id,revision:revision(raw),data:validateCase(JSON.parse(raw))}
  }
  async function list() {
    await dir(); const cases=[], errors=[]
    for (const id of (await readdir(directory)).filter(n=>n.endsWith('.json')).sort()) {
      try {cases.push(await read(id))} catch(e) {errors.push(`${id}: ${e.message}`)}
    }
    return {cases,errors}
  }
  function save({data,id,expectedRevision}) {
    const operation=queue.then(async()=>{
      validateCase(data); await dir()
      const raw=JSON.stringify(data,null,2)+'\n'
      if (id === undefined) { id=`case-${randomUUID()}.json`; await writeFile(path(id),raw,{flag:'wx'}) }
      else {
        const current=await read(id)
        if (!expectedRevision || current.revision !== expectedRevision) throw new Error('文件已变化或缺少覆盖凭据，请重新加载后再确认覆盖')
        const temp=join(directory,`.${randomUUID()}.tmp`)
        try { await writeFile(temp,raw,{flag:'wx'}); await rename(temp,path(id)) } finally { await unlink(temp).catch(()=>{}) }
      }
      return {id,revision:revision(raw),data}
    })
    queue=operation.catch(()=>{}); return operation
  }
  return {list,read,save}
}
export function createCaseMiddleware(store=createCaseStore()) {
 return async (req,res,next)=>{
  if(req.url?.split('?')[0] !== '/api/debug/reading-test-cases') return next()
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return send(403,{error:'localhost only'})
  try {
   if(req.method==='GET') return send(200,await store.list())
   if(req.method!=='POST') return send(405,{error:'GET/POST only'})
   if(!req.headers['content-type']?.startsWith('application/json')) return send(415,{error:'application/json required'})
   const chunks=[]; let size=0
   for await (const chunk of req) {size+=chunk.length;if(size>270000) {send(413,{error:'请求过大'});return} chunks.push(chunk)}
   send(200,await store.save(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
  } catch(e) {send(400,{error:e.message})}
 }
}
export const readingCaseMiddleware=createCaseMiddleware()
