import type {GameAction,GamePermissions} from './game-permissions'
import type {ActivityMessage} from './activity-message'
export function mount(host:HTMLElement,options:{instanceId:string;onMessage(message:ActivityMessage):void;
 canInteract?:()=>boolean;permissions?:()=>GamePermissions;onAction?:(name:GameAction,args:Record<string,unknown>)=>void
}):{snapshot():Record<string,unknown>;restore(snapshot:Record<string,unknown>):void;setEnabled(value:boolean):void;receive(message:ActivityMessage):void;unmount():void}
