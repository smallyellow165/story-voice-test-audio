import {createActivityBridge} from '../activity-bridge.ts'
import type {ActivityMessage} from '../activity-message'
import {allowsGameAction, defaultGamePermissions} from '../game-permissions.ts'
import type {ScreenGameOptions} from '../screen-game-module'
import type {Detail, Item} from './Gallery'

/** Thin adapter over the existing Gallery API and visible GalleryModel. No plan generation. */
export class GalleryActivity {
  apiBase='/ringfeet-api/api/brick-gallery/'
  libraryUrl='/ringfeet-api/story-voice-test-audio/brick-ldraw/'
  id:string|null=null
  mode='detail'
  data:Detail|null=null
  items:{item:Item;brickCount:number;stepCount:number;canBuild:boolean}[]=[]
  warnings:{id:string;error:string}[]=[]
  step=0; replay=0; renderVersion=0; loading=false; error=''; busy=false; enabled=true; closed=false
  revision=0; runId=crypto.randomUUID(); attempt=crypto.randomUUID()
  private listeners=new Set<()=>void>()
  private generation=0
  private visualReady=false
  private recovery:Record<string,any>|null=null
  private restoredKey=''
  private visual?:{resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}
  private options:ScreenGameOptions
  private bridge:ReturnType<typeof createActivityBridge>
  constructor(options:ScreenGameOptions){
    this.options=options
    this.bridge=createActivityBridge(()=>this.close(),()=>this.snapshot(),()=>{throw Error('unsupported_reset')},
      {instanceId:options.instanceId,send:options.onMessage},(name,args)=>name==='gallery_control'?this.apply(args):false)
  }
  subscribe(fn:()=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
  // Every semantic publication must supersede the last snapshot. The shared
  // ActivitySession intentionally ignores different data at the same revision.
  private changed(){this.revision++;for(const fn of this.listeners)fn();this.bridge.send('state')}
  private permitted(){return !this.closed&&this.enabled&&(this.options.canInteract?.()??true)}
  snapshot(){
    if(this.recovery)return {...this.recovery,gallery:{...this.recovery.gallery,busy:true,error:this.error}}
    const plan=this.mode==='play'?this.data?.plan:null, total=plan?.steps.length||1
    return {instanceId:this.options.instanceId,activityType:'lego-gallery',gameId:'lego-gallery',gameName:this.data?.item.title||'LEGO 作品库',
      runId:this.runId,revision:this.revision,taskAttemptId:this.attempt,
      taskId:plan?.steps[this.step]?.stepId||'gallery',index:plan?this.step:0,total,
      lifecycle:this.closed?'closed':'running',taskStatus:'not_yet',
      taskDescription:plan?.steps[this.step]?.description||this.data?.item.title||'选择已保存的作品',
      capabilities:['get_snapshot','exit'],progress:{completed:plan?this.step:0,total},
      gallery:{galleryId:this.id,buildPlanId:this.data?.item.buildPlanId??null,mode:this.mode,stepCount:plan?.steps.length??0,
        currentStep:plan?.steps.length?this.step+1:0,remainingSteps:plan?Math.max(0,plan.steps.length-this.step-1):0,
        busy:this.busy,error:this.error,candidates:this.items.slice(0,30).map(({item})=>({id:item.id,title:item.title})),moreCandidates:this.items.length>30}}
  }
  async start(){try{await this.apply({action:'list_models'})}catch{/* Error remains visible and queryable. */}finally{this.bridge.send('ready')}}
  async read(route:string){
    const response=await fetch(this.apiBase+route,{signal:AbortSignal.timeout(3500)})
    const value=await response.json();if(!response.ok)throw Error(value.error||'gallery_service_unavailable');return value
  }
  request(action:string,args:Record<string,unknown>={}){
    const permissions=this.options.permissions?.()??defaultGamePermissions(this.permitted())
    if(!this.permitted()||!allowsGameAction(permissions,'gallery_control'))return
    const s=this.snapshot(),taskReference={instanceId:s.instanceId,runId:s.runId,taskAttemptId:s.taskAttemptId,revision:s.revision}
    if(this.options.onAction)this.options.onAction('gallery_control',{action,...args,taskReference})
    else this.receive({v:1,id:crypto.randomUUID(),instanceId:this.options.instanceId,kind:'command',name:'gallery_control',payload:{expectedRunId:s.runId,expectedTaskAttemptId:s.taskAttemptId,baseRevision:s.revision,args:{action,...args}}})
  }
  receive(message:ActivityMessage){if(message.name==='get_snapshot'||this.permitted())this.bridge.receive(message)}
  visualDone(error?:string,version=this.renderVersion){
    if(version!==this.renderVersion)return
    const pending=this.visual
    if(!pending)return
    this.visual=undefined;clearTimeout(pending.timer)
    this.visualReady=!error
    if(error)pending.reject(Error(error));else pending.resolve()
  }
  private show(){
    this.visualReady=false;this.renderVersion++
    return new Promise<void>((resolve,reject)=>{
      this.visual={resolve,reject,timer:setTimeout(()=>this.visualDone('player_render_timeout'),4500)}
      this.changed()
    })
  }
  async apply(args:Record<string,unknown>){
    const action=args.action
    if(this.closed)throw Error('activity_closed')
    if(action==='get_progress'){if(this.busy)throw Error('player_busy');if(this.mode==='play'&&!this.visualReady)throw Error('player_not_loaded');return true}
    if(this.busy)throw Error('player_busy')
    if(['next_step','previous_step','replay_step'].includes(String(action))&&this.mode==='play'&&!this.visualReady)throw Error('player_not_loaded')
    this.busy=true;this.error='';const ticket=this.generation
    // Reserve the revision before async work. Concurrent gestures cannot retarget it.
    this.attempt=crypto.randomUUID();this.changed()
    const alive=()=>{if(this.closed||ticket!==this.generation)throw Error('activity_changed')}
    try{
      if(action==='list_models'||action==='search_models'||action==='back_to_gallery'){
        const result=await this.read('items');alive()
        const query=String(args.query??'').trim().toLocaleLowerCase()
        const aliases:Record<string,string>={'公鸡':'rooster','企鹅':'penguin','骆驼':'camel'}
        this.items=result.items.filter(({item}:{item:Item})=>!query||[query,aliases[query]].filter(Boolean).some(q=>(item.title+' '+item.description).toLocaleLowerCase().includes(q)))
        this.warnings=result.warnings;this.id=null;this.data=null;this.mode='detail';this.step=0
        if(action==='search_models'&&this.items.length===1)await this.select(this.items[0].item.id,alive)
      }else if(action==='select_model'){
        await this.select(String(args.galleryId??''),alive)
      }else if(action==='start_build'){
        if(!this.data||!this.id)throw Error('no_selected_gallery_item')
        // Revalidate the explicit saved binding using the original server validator.
        const detail:Detail=await this.read('items/'+encodeURIComponent(this.id));alive()
        if(detail.item.id!==this.id||detail.item.buildPlanId!==this.data.item.buildPlanId||detail.item.layoutSelectionId!==this.data.item.layoutSelectionId)throw Error('gallery_source_changed')
        if(!detail.canBuild||!detail.plan||detail.plan.build_plan_id!==detail.item.buildPlanId)throw Error('saved_build_plan_required')
        this.data=detail;this.mode='play';this.step=0;this.replay++;await this.show()
      }else if(action==='back_to_detail'||action==='finish_build'){
        if(!this.data)throw Error('no_selected_gallery_item')
        this.mode='detail';this.step=0;this.replay++;await this.show()
      }else if(['next_step','previous_step','replay_step'].includes(String(action))){
        if(this.mode!=='play'||!this.data?.plan)throw Error('player_not_loaded')
        if(action==='next_step'&&this.step>=this.data.plan.steps.length-1)throw Error('last_step')
        if(action==='previous_step'&&this.step===0)throw Error('first_step')
        if(action==='next_step')this.step++
        if(action==='previous_step')this.step--
        this.replay++;await this.show()
      }else throw Error('unsupported_gallery_action')
      alive();return true
    }catch(e){if(ticket===this.generation&&!this.closed)this.error=String(e);throw e}
    finally{if(ticket===this.generation){this.busy=false;this.loading=false;this.changed()}}
  }
  private async select(id:string,alive:()=>void){
    if(!/^[a-f0-9-]{36}$/.test(id))throw Error('invalid_gallery_id')
    const detail:Detail=await this.read('items/'+encodeURIComponent(id));alive()
    if(detail.item.id!==id)throw Error('gallery_identity_mismatch')
    this.id=id;this.data=detail;this.mode='detail';this.step=0;this.replay++;await this.show()
  }
  restore(value:Record<string,any>){
    if(value.instanceId!==this.options.instanceId||value.activityType!=='lego-gallery')return
    const key=JSON.stringify([value.runId,value.revision,value.gallery])
    if(key===this.restoredKey)return
    this.restoredKey=key;this.recovery=value
    ++this.generation;this.visualDone('authority_changed');this.busy=true
    const ticket=this.generation,g=value.gallery
    void(async()=>{
      const detail:Detail|null=g?.galleryId?await this.read('items/'+encodeURIComponent(g.galleryId)):null
      if(ticket!==this.generation||this.closed)return
      if(detail&&(detail.item.id!==g.galleryId||detail.item.buildPlanId!==g.buildPlanId||
        (g.mode==='play'&&(!detail.canBuild||!detail.plan||value.index>=Math.max(1,detail.plan.steps.length)))))throw Error('gallery_recovery_source_changed')
      this.recovery=null;this.error='';this.id=g?.galleryId??null;this.data=detail;this.mode=g?.mode??'detail';this.step=value.index
      this.runId=value.runId;this.attempt=value.taskAttemptId;this.revision=value.revision;this.replay++
      if(detail)await this.show()
    })().catch(e=>{if(ticket===this.generation){this.error=String(e);this.restoredKey=''}}).finally(()=>{if(ticket===this.generation){this.busy=false;this.changed()}})
  }
  setEnabled(value:boolean){if(this.enabled&&!value){++this.generation;this.visualDone('authority_changed');this.busy=false}this.enabled=value}
  private close(){this.recovery=null;this.closed=true;++this.generation;this.visualDone('activity_closed');this.changed()}
  dispose(){if(!this.closed&&this.permitted()&&(!this.options.permissions||this.options.permissions().canAdminGame))this.bridge.receive({v:1,id:crypto.randomUUID(),instanceId:this.options.instanceId,kind:'command',name:'exit',payload:{}});this.close();this.bridge.dispose();this.listeners.clear()}
}
