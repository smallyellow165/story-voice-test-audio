import {createRoot} from 'react-dom/client'
import {Gallery} from './brick-gallery/Gallery'
import {GalleryActivity} from './brick-gallery/activity'
import type {ScreenGameOptions} from './screen-game-module'
import css from './brick-gallery/gallery.css?inline'
export function mount(host:HTMLElement,options:ScreenGameOptions){
 const shadow=host.shadowRoot||host.attachShadow({mode:'open'}),style=document.createElement('style'),container=document.createElement('div')
 style.textContent=css;shadow.replaceChildren(style,container)
 const activity=new GalleryActivity(options),root=createRoot(container)
 root.render(<Gallery activity={activity}/>);void activity.start()
 return {snapshot:()=>activity.snapshot(),restore:(s:Record<string,unknown>)=>activity.restore(s),setEnabled:(v:boolean)=>activity.setEnabled(v),
 receive:(message:Parameters<typeof activity.receive>[0])=>activity.receive(message),unmount(){activity.dispose();root.unmount();shadow.replaceChildren()}}
}
