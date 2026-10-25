import {createContext,useContext,type ReactNode} from 'react'
import {createPortal} from 'react-dom'

export type InspectorStep='planning'|'geometry'|'refinement'
export const InspectorContext=createContext<{host:HTMLElement|null;step:InspectorStep;select(step:InspectorStep,open?:boolean):void}>({host:null,step:'planning',select:()=>{}})
// Move presentation only. Workflow/form state remains in its original owner;
// hidden panels stay mounted, and portal fieldsets retain operation locks.
export function InspectorContent({step,disabled=false,children}:{step:InspectorStep;disabled?:boolean;children:ReactNode}){
 const context=useContext(InspectorContext)
 return context.host?createPortal(<div hidden={context.step!==step} data-inspector-step={step}><fieldset disabled={disabled}>{children}</fieldset></div>,context.host):null
}
export function InspectButton({step,children='查看详情'}:{step:InspectorStep;children?:ReactNode}){
 const context=useContext(InspectorContext)
 return <button type="button" className="inspect-button" onClick={()=>context.select(step,true)}>{children} →</button>
}
