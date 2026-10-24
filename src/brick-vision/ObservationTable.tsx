import type { ReactNode, Ref } from 'react'
import { catalogShapes, catalogPrints, editDimension } from './catalog-features.mjs'
import type { FeatureEditor } from './catalog-features.mjs'
import './review.css'

/** Presentation only. Callers retain their own drafts, selection and operations. */
export function ObservationTable({ columns, children, hostRef, stickyAction = false }: {
  columns: readonly { label: string; width: number; header?: ReactNode }[]
  stickyAction?: boolean
  children: ReactNode
  hostRef?: Ref<HTMLDivElement>
}) {
  return <div className="vision-observation-scroll" ref={hostRef} tabIndex={0} role="region" aria-label="Observation 审核表，可横向滚动">
    <table className={"vision-observation-table" + (stickyAction ? " vision-matching-table" : "")} style={{ minWidth: columns.reduce((sum, c) => sum + c.width, 0) }}>
      <colgroup>{columns.map((c, i) => <col key={i} style={{ width: c.width }} />)}</colgroup>
      <thead><tr>{columns.map(c => <th key={c.label} scope="col">{c.label}{c.header}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
}

/** Same controlled feature editors; no parsing, matching or local copy of state. */
export function ObservationFeatureCells({ id, features, disabled, onChange }: {
  id: string; features: FeatureEditor; disabled: boolean; onChange(features: FeatureEditor): void
}) {
  return <>
    {(['width_studs', 'depth_studs', 'height_brick_units'] as const).map(key => <td key={key}>
      <input aria-label={id + ' ' + key} type="number" min="0" step="any" placeholder="Unknown"
        value={features[key] ?? ''} disabled={disabled} onChange={e => onChange(editDimension(features, key, e.target.value))} />
    </td>)}
    <td><input aria-label={id + ' 特征 RB Color ID'} inputMode="numeric" placeholder="Unknown" value={features.color} disabled={disabled}
      onChange={e => onChange({ ...features, color: e.target.value })} /></td>
    <td><select aria-label={id + ' Shape'} value={features.shape} disabled={disabled}
      onChange={e => onChange({ ...features, shape: e.target.value })}>
      <option value="">未知</option>{catalogShapes.map(shape => <option key={shape} value={shape}>{shape}</option>)}</select></td>
    <td><select aria-label={id + ' Print'} value={features.print} disabled={disabled}
      onChange={e => onChange({ ...features, print: e.target.value })}>
      {catalogPrints.map(print => <option key={print} value={print}>{print === 'yes' ? '有印花' : print === 'no' ? '无印花' : '未知'}</option>)}</select></td>
  </>
}
