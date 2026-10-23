import type { RefObject } from 'react'
import { ObservationTable } from '../brick-vision/ObservationTable'

export type GeometryDimension = {
  value: number | null; status: 'observed' | 'inferred' | 'unknown'; confidence: number
  evidence: string; alternatives: { value: number; evidence: string }[]; anchor_ids: string[]
}
// Optional on the shared observation envelope: legacy Catalog records do not contain geometry.
export type GeometryFields = {
  color?: string
  dimensions?: { width_studs: GeometryDimension; depth_studs: GeometryDimension; height_brick_units: GeometryDimension }
  orientation?: { description: string; yaw_degrees: number | null; status: string; evidence: string }
  visible_seams?: string[]; unknowns?: string[]; alternatives?: string[]
}
const format = (n: number | null | undefined) => n == null ? 'Unknown' : Number(n.toFixed(3)).toString()
function Dimension({ dimension, unit }: { dimension?: GeometryDimension; unit: string }) {
  return <><strong>{format(dimension?.value)} {dimension?.value == null ? '' : unit}</strong>
    <small>{dimension?.status || 'unknown'} · {dimension?.confidence ?? '—'}</small></>
}
export function GeometryObservationTable({ observations, active, onSelect, onDetail, hostRef }: {
  observations: (GeometryFields & { id: string; confidence: number; evidence: string; occlusion: string; visible_studs: number | null })[]
  active: string; onSelect(id: string): void; onDetail(id: string): void; hostRef: RefObject<HTMLDivElement | null>
}) {
  return <div className="geometry-observations"><ObservationTable hostRef={hostRef} columns={[
    { label: 'ID / Color', width: 130 }, { label: 'Width (Stud)', width: 115 }, { label: 'Depth (Stud)', width: 115 },
    { label: 'Height (Brick)', width: 150 }, { label: 'Confidence', width: 90 },
    { label: 'Evidence / Anchors', width: 300 }, { label: 'Unknown / Alternatives', width: 300 }, { label: 'Orientation / Visible', width: 220 },
  ]}>
    {observations.map(o => <tr key={o.id} data-observation-id={o.id} className={active === o.id ? 'is-active' : ''} onClick={() => onSelect(o.id)}>
      <td><button type="button" className="vision-observation-id" aria-pressed={active === o.id} onClick={() => onSelect(o.id)}>{o.id}</button>
        <small>{o.color || 'Unknown'}</small><button type="button" onClick={() => onDetail(o.id)}>详情</button></td>
      <td><Dimension dimension={o.dimensions?.width_studs} unit="stud" /></td>
      <td><Dimension dimension={o.dimensions?.depth_studs} unit="stud" /></td>
      <td><Dimension dimension={o.dimensions?.height_brick_units} unit="brick" /></td>
      <td>{o.confidence}</td>
      <td>{o.evidence}{Object.entries(o.dimensions || {}).map(([key, d]) => <p key={key}><b>{key}</b>: {d.evidence}<small>Anchor: {d.anchor_ids.join(', ') || '无'}</small></p>)}</td>
      <td><p>{o.occlusion}</p>{[...(o.unknowns || []), ...(o.alternatives || [])].map((v, i) => <p key={i}>{v}</p>)}
        {Object.entries(o.dimensions || {}).map(([key, d]) => <div key={key}>
          {d.status === 'unknown' && <p>{key}: Unknown</p>}
          {d.alternatives.map((a, i) => <p key={i}>{key}: {format(a.value)} — {a.evidence}</p>)}
        </div>)}</td>
      <td>{o.orientation?.description || 'Unknown'}<small>{o.orientation?.status} · yaw {format(o.orientation?.yaw_degrees)}°</small>
        <p>{o.orientation?.evidence}</p><p>Visible studs: {o.visible_studs ?? 'Unknown'}</p>
        {(o.visible_seams || []).map((v, i) => <p key={i}>{v}</p>)}</td>
    </tr>)}
  </ObservationTable></div>
}
