import type {Source} from '../../intake/contracts.ts'
import type {VisibleEvidence3D} from './contracts.ts'
/** Existing Visible3D overlay extracted for Source, Review and Candidate comparison.
 * Reuses the 2D Review's Observation-ID selection/classes; no annotation editor.
 */
export function VisibleEvidenceImage({source,image,evidence,selected,onSelect,excluded=[]}:{source:Source|null;image:string;evidence?:VisibleEvidence3D;selected:string;onSelect:(id:string)=>void;excluded?:string[]}){
 return <div className="visible3d-image">{image?<svg preserveAspectRatio="none" style={{aspectRatio:`${source?.view.width??1}/${source?.view.height??1}`}} viewBox="0 0 1000 1000" role="img" aria-label="Visible 3D 原图与观察证据"><image href={image} width="1000" height="1000" preserveAspectRatio="none"/>{evidence?.observations.map(o=><g key={o.id} data-observation={o.id} data-selected={selected===o.id} role="button" tabIndex={0} aria-label={`识别零件 ${o.id}`} aria-pressed={selected===o.id} onClick={()=>onSelect(o.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(o.id)}}} opacity={excluded.includes(o.id)?.35:1}>
 {o.bbox&&<rect x={o.bbox[0]*1000} y={o.bbox[1]*1000} width={(o.bbox[2]-o.bbox[0])*1000} height={(o.bbox[3]-o.bbox[1])*1000} className={selected===o.id?'observation selected':'observation'} fill={selected===o.id?'#ffca4525':'transparent'} stroke={selected===o.id?'#e43c38':'#248780'} strokeWidth={selected===o.id?8:3}/>}
 {o.features.map(f=>f.points.length===1?<circle key={f.id} cx={f.points[0][0]*1000} cy={f.points[0][1]*1000} r="7" fill={f.visibility==='visible'?'#ec5c1e':'none'} stroke="#ec5c1e" strokeWidth="3"/>:<polyline key={f.id} points={f.points.map(p=>p.map(n=>n*1000).join(',')).join(' ')} stroke="#ec5c1e" strokeWidth={selected===o.id?7:4} strokeDasharray={f.visibility==='estimated'?'10 8':undefined} fill="none"/>)}<text x={(o.bbox?.[0]??o.features[0]?.points[0]?.[0]??0)*1000} y={(o.bbox?.[1]??o.features[0]?.points[0]?.[1]??0)*1000+25} fill="#a01818" fontSize="25">{o.id}</text>
 </g>)}</svg>:<p>请先上传照片。只处理可见证据，不补全隐藏结构。</p>}</div>
}
