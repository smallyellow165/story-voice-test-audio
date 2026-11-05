import type {WorkspaceContext} from './workspace-context.ts'

// One writer per browser workspace. Unlike a localStorage lease, Web Locks
// cannot expire while a suspended tab still owns unsaved application state.
let lease:Promise<void>|undefined
export function claimWorkspace(context:WorkspaceContext){
 if(lease)return lease
 lease=new Promise<void>((resolve,reject)=>{
  if(!navigator.locks){reject(Error('浏览器不支持安全的工作区并发锁；原草稿保留，请使用支持 Web Locks 的浏览器或 localhost / HTTPS。'));return}
  void navigator.locks.request('magnetic-workspace:'+context.mode+':'+context.id,{ifAvailable:true},async lock=>{
   if(!lock){reject(Error('此工作区已在其他页面打开。请回到原页面继续制作，或关闭原页面后重新打开；未覆盖任何草稿。'));return}
   await new Promise<void>(release=>{
    window.addEventListener('pagehide',()=>release(),{once:true})
    window.addEventListener('pageshow',e=>{if(e.persisted)location.reload()})
    resolve()
   })
  }).catch(reject)
 })
 return lease
}
