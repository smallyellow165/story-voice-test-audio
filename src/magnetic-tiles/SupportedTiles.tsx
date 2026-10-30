import { InfoHint } from '../brick-vision/InfoHint.tsx'
import { profiles, profileKey, profileSpec, profileSizeLabel, profileViewBox } from './profiles.ts'

export function SupportedTiles({selected,onSelect}:{selected:string;onSelect:(key:string)=>void}) {
 const profile=profiles.find(p=>profileKey(p)===selected)!,spec=profileSpec(profile)
 return <section className="tiles-catalog" aria-label="Tiles Catalog">
  <div className="catalog-list" role="list" aria-label="支持的磁力片">{profiles.map(p=><div key={profileKey(p)} role="listitem">
   <button className="catalog-row" data-catalog-profile={profileKey(p)} aria-pressed={selected===profileKey(p)} onClick={()=>onSelect(profileKey(p))} title={`${p.name} · ${profileKey(p)} · ${profileSizeLabel(p)}${p.sizeEvidence?' · Estimated':''}`}>
    <svg viewBox={profileViewBox(p)} aria-label={`${p.name}真实几何`}><g transform="scale(1 -1)"><polygon points={p.vertices.map(v=>v.join(',')).join(' ')} fill="#f5b942" stroke="#243e3a" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>{profileSpec(p).edges.filter(e=>e.connectable).map(e=><line key={e.id} x1={p.vertices[e.from][0]} y1={p.vertices[e.from][1]} x2={p.vertices[e.to][0]} y2={p.vertices[e.to][1]} stroke="#267b69" strokeWidth="2" vectorEffect="non-scaling-stroke"/>)}</g></svg>
    <span className="catalog-row-text"><span className="catalog-row-name"><strong>{p.name}</strong>{p.sizeEvidence&&<small className="catalog-estimated">Estimated</small>}</span><span className="catalog-row-meta"><span title={profileKey(p)}>{p.id} · v{p.version}</span><span title={profileSizeLabel(p)}>{profileSizeLabel(p).replace(/^边长 /,'')}</span></span></span>
   </button>
  </div>)}</div>
  <section className="catalog-details" aria-label="Profile 规格">
   <div className="catalog-detail-heading"><strong>{profile.name}</strong><InfoHint label="Profile 几何">规格只读，来自 profiles.json。标准正方形边长 = 1；局部坐标 Y 向上，顶点逆时针，二维零厚度且不允许缩放。绿色标出可连接边；共线、内部相反侧的正长度边段可连接，允许一长边接多短边，最终由现有 Geometry Validator 检查。</InfoHint></div>
   <p className="catalog-identity">Profile ID：{profile.id} · Version：{profile.version}</p>
   {profile.sizeEvidence&&<p className="catalog-size-source" data-testid="profile-size-source">Estimated · {profile.sizeEvidence.source}</p>}
   <h3>顶点坐标</h3><ol className="catalog-vertices" start={0}>{profile.vertices.map((v,i)=><li key={i}>v{i} = [{v.join(', ')}]</li>)}</ol>
   <h3>边与连接器</h3><table><thead><tr><th>边</th><th>长度</th><th>连接</th></tr></thead><tbody>{spec.edges.map(e=><tr key={e.id}><td>{e.id} · v{e.from} → v{e.to}</td><td>{Number(e.length.toFixed(9))}</td><td>{e.connectable?'可连接':'不可连接'}</td></tr>)}</tbody></table>
  </section>
 </section>
}
