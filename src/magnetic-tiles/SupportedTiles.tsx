import { useState } from 'react'
import { StudioSlot } from './StudioLayout.tsx'
import { profiles, profileKey, profileSpec, profileSizeLabel, profileViewBox } from './profiles.ts'

export function SupportedTiles() {
  const [selected, setSelected] = useState(profileKey(profiles[0]))
  const profile = profiles.find(p => profileKey(p) === selected)!
  const spec = profileSpec(profile)
  return <>
    <StudioSlot column="workflow" stages={['catalog']}>
      <p>只读目录 · {profiles.length} 个 Profile</p>
      <label>支持的磁力片<select aria-label="支持的磁力片" value={selected} onChange={e=>setSelected(e.target.value)}>{profiles.map(p=><option key={profileKey(p)} value={profileKey(p)}>{p.name} · v{p.version}</option>)}</select></label>
      <p className="hint">规格来自 profiles.json。选择卡片可查看顶点与可连接边；五阶段工作内容会保留。</p>
    </StudioSlot>
    <StudioSlot column="workspace" stages={['catalog']}>
      <div className="supported-tiles-grid">{profiles.map(p=><button className="supported-tile" key={profileKey(p)} aria-pressed={selected===profileKey(p)} onClick={()=>setSelected(profileKey(p))}>
        <strong>{p.name}</strong><span>{p.id} · Version {p.version}</span>
        <svg viewBox={profileViewBox(p)} aria-label={`${p.name}真实几何`}><g transform="scale(1 -1)"><polygon points={p.vertices.map(v=>v.join(',')).join(' ')} fill="#f5b942" stroke="#243e3a" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>{profileSpec(p).edges.filter(e=>e.connectable).map(e=><line key={e.id} x1={p.vertices[e.from][0]} y1={p.vertices[e.from][1]} x2={p.vertices[e.to][0]} y2={p.vertices[e.to][1]} stroke="#267b69" strokeWidth="3" vectorEffect="non-scaling-stroke"/>)}</g></svg>
        <span>{profileSizeLabel(p)}</span>{p.sizeEvidence&&<small>Estimated · V1 估计规格</small>}<small>可连接边：{p.connectableEdges.join('、') || '无'}（绿色）</small>
      </button>)}</div>
    </StudioSlot>
    <StudioSlot column="inspector" stages={['catalog']}>
      <section aria-label="Profile 规格"><h3>{profile.name}</h3><p>Profile ID：{profile.id}<br/>Version：{profile.version}</p>
        <p>相对单位 · 2D 零厚度 · 严格凸多边形<br/>局部坐标 Y 向上，顶点逆时针；不允许缩放。</p>
        {profile.sizeEvidence&&<p data-testid="profile-size-source">Estimated · {profile.sizeEvidence.source}</p>}
        <h4>顶点坐标</h4><ol start={0}>{profile.vertices.map((v,i)=><li key={i}>v{i} = [{v.join(', ')}]</li>)}</ol>
        <h4>边与连接器</h4>{spec.edges.map(e=><p key={e.id}>{e.id}：v{e.from} → v{e.to}<br/>边长 {Number(e.length.toFixed(9))} · {e.connectable?'可整边连接':'不可连接'}</p>)}
        <p className="hint">仅等长整边可连接，最终连接仍由 Geometry Validator 检查。未知规格不会自动替换为目录中的形状。</p>
      </section>
    </StudioSlot>
  </>
}
