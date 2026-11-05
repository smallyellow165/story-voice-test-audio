import {useEffect,useId,useRef} from 'react'

/** The wrapper receives hover/focus even when the native button is disabled.
 * A top-layer popover keeps the explanation outside the resizable pane's clip. */
export function DisabledReasonButton({reason,onClick,children}:{reason:string;onClick:()=>void;children:string}){
    const id=useId(),trigger=useRef<HTMLSpanElement>(null),popup=useRef<HTMLSpanElement>(null)
    function hide(){if(popup.current?.matches(':popover-open'))popup.current.hidePopover()}
    function show(){
        const panel=popup.current,anchor=trigger.current
        if(!reason||!panel||!anchor)return
        if(!panel.matches(':popover-open'))panel.showPopover()
        const rect=anchor.getBoundingClientRect(),margin=8
        panel.style.left=Math.max(margin,Math.min(rect.left,window.innerWidth-panel.offsetWidth-margin))+'px'
        panel.style.top=(rect.bottom+panel.offsetHeight+margin<=window.innerHeight?rect.bottom+4:Math.max(margin,rect.top-panel.offsetHeight-4))+'px'
    }
    useEffect(()=>{
        const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')hide()}
        window.addEventListener('keydown',escape)
        window.addEventListener('resize',hide)
        window.addEventListener('scroll',hide,true)
        return()=>{window.removeEventListener('keydown',escape);window.removeEventListener('resize',hide);window.removeEventListener('scroll',hide,true)}
    },[])
    return <span ref={trigger} className="review-disabled-action" tabIndex={reason?0:undefined}
        role={reason?'group':undefined} aria-label={reason?children+'禁用原因':undefined} aria-describedby={reason?id:undefined}
        onMouseEnter={show} onMouseLeave={()=>{if(document.activeElement!==trigger.current)hide()}} onFocus={show} onBlur={hide}>
        <button type="button" disabled={!!reason} aria-describedby={reason?id:undefined} onClick={onClick}>{children}</button>
        {reason&&<span ref={popup} id={id} popover="manual" role="tooltip" className="review-disabled-reason">{reason}</span>}
    </span>
}
