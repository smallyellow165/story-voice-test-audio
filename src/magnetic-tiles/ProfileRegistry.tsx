import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react'
import type {ReactNode} from 'react'
import type {Profile} from './geometry.ts'
import {profileIssues} from './geometry.ts'
import {profileKey} from './profiles.ts'
import type {ProfileInput} from './parametric-profile.ts'
export type Registry={schemaVersion:1;revision:number;hash:string;profiles:Profile[]}
async function request(method='GET',body?:unknown){
 const r=await fetch('/api/magnetic-intake/profiles',{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'}),data=await r.json()
 if(!r.ok)throw Error(data.error||`Catalog HTTP ${r.status}`)
 return data
}
function checked(r:Registry){
 if(r?.schemaVersion!==1||!Number.isSafeInteger(r.revision)||r.revision<0||typeof r.hash!=='string'||!Array.isArray(r.profiles)||!r.profiles.length||r.profiles.some(p=>profileIssues(p).length)||new Set(r.profiles.map(profileKey)).size!==r.profiles.length)throw Error('服务端 Catalog 无效；未载入本地作品')
 return r
}
const Context=createContext<{registry:Registry;refresh:()=>Promise<Registry>;save:(input:ProfileInput,operation:'create'|'version',revision:number)=>Promise<Profile>;warning:string}|null>(null)
export function useProfileRegistry(){const c=useContext(Context);if(!c)throw Error('Profile Registry 尚未加载');return c}
export function ProfileRegistryProvider({children}:{children:ReactNode}){
 const [registry,setRegistry]=useState<Registry|null>(null),[warning,setWarning]=useState(''),latest=useRef<Registry|null>(null)
 const accept=useCallback((r:Registry)=>{checked(r);if(latest.current&&r.revision<latest.current.revision)return;if(latest.current?.revision===r.revision&&latest.current.hash!==r.hash)throw Error('同版本 Catalog Hash 不一致；保留当前 Registry');if(latest.current?.revision===r.revision){setWarning('');return}latest.current=r;setRegistry(r);setWarning('')},[])
 const refresh=useCallback(async()=>{try{const r=await request();accept(r);return r as Registry}catch(e){setWarning(String(e));throw e}},[accept])
 useEffect(()=>{
  const reload=()=>{void refresh().catch(()=>{})},onStorage=(e:StorageEvent)=>{if(e.key==='magnetic-profile-registry-changed')reload()}
  reload();window.addEventListener('focus',reload);window.addEventListener('storage',onStorage)
  return()=>{window.removeEventListener('focus',reload);window.removeEventListener('storage',onStorage)}
 },[refresh])
 async function save(input:ProfileInput,operation:'create'|'version',revision:number){
  const result=await request('POST',{input,operation,expectedRevision:revision});accept(result.registry)
  try{localStorage.setItem('magnetic-profile-registry-changed',crypto.randomUUID())}catch{/* Invalidation only; server remains authoritative. */}
  return result.profile as Profile
 }
 if(!registry)return <div role="status">{warning||'正在加载 Profile Registry…'}{warning&&<button onClick={()=>void refresh().catch(()=>{})}>重试加载 Catalog</button>}</div>
 return <Context.Provider value={{registry,refresh,save,warning}}>{children}</Context.Provider>
}
