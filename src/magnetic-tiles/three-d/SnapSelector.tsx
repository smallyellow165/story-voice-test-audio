import type {SnapPicker} from './module-snap-selection.ts'

export function SnapSelector({kind,active,toggle,disabled}:{kind:SnapPicker;active:SnapPicker|null;toggle:(kind:SnapPicker)=>void;disabled:boolean}){
 const name=kind.split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join(' ')
 return <button type="button" className="snap-selector" aria-label={'从 Viewer 选择 '+name} title={'在 Viewer 拾取 '+name+'；再次点击或 Esc 取消'} aria-pressed={active===kind} disabled={disabled} onClick={()=>toggle(kind)}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/><path d="m9 8 1 10 3-3 3 5 2-1-3-5 4-1Z"/></svg></button>
}
