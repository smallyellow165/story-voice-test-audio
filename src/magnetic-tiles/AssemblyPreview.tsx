import { vertices } from './geometry.ts'
import type { Assembly, Profile } from './geometry.ts'

// Shared full-assembly SVG used by reconstruction comparison and Build source preview.
export function AssemblyPreview({ assembly, profiles, selected, onSelect, className = 'intake-candidate', label = '作品完整预览' }: { assembly: Assembly; profiles: readonly Profile[]; selected?: string; onSelect?: (id: string)=>void; className?: string; label?: string }) {
  const points=assembly.instances.flatMap(t=>vertices(t,profiles)),xs=points.map(v=>v[0]),ys=points.map(v=>-v[1])
  const box=points.length?`${Math.min(...xs)-.3} ${Math.min(...ys)-.3} ${Math.max(...xs)-Math.min(...xs)+.6} ${Math.max(...ys)-Math.min(...ys)+.6}`:'0 0 1 1'
  return <svg className={className} viewBox={box} aria-label={label} role={onSelect?undefined:'img'}><g transform="scale(1 -1)">{assembly.instances.map(t=><polygon key={t.id} data-preview-piece={t.id} data-candidate-piece={onSelect?t.id:undefined} role={onSelect?'button':undefined} tabIndex={onSelect?0:undefined} aria-label={onSelect?`候选零件 ${t.id}`:undefined} aria-pressed={onSelect?selected===t.id:undefined} onClick={onSelect?()=>onSelect(t.id):undefined} onKeyDown={onSelect?e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(t.id)}}:undefined} points={vertices(t,profiles).map(v=>v.join(',')).join(' ')} fill={t.color} stroke={selected===t.id?'#006aff':'#243e3a'} vectorEffect="non-scaling-stroke" strokeWidth={selected===t.id?3.5:1.5}/>)}</g></svg>
}
