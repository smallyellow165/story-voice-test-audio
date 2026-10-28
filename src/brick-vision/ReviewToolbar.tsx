import { InfoHint } from './InfoHint'
import type { ReactNode } from 'react'
import './review.css'
import { ObservationActions } from './ObservationActions'
import { reviewStatusLabels } from './review-status.mjs'

export type ReviewFilter = 'all' | 'unconfirmed' | 'confirmed' | 'excluded'
export function ReviewStatusFilter({ value, onChange }: { value: ReviewFilter; onChange(value: ReviewFilter): void }) {
  return <ObservationActions observationId="审核状态" triggerLabel={<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12L9.5 8v5l-3-1V8Z" fill={value === 'all' ? 'none' : 'currentColor'} stroke="currentColor" /></svg>} triggerAriaLabel={'筛选审核状态：' + (value === 'all' ? '全部' : reviewStatusLabels[value])}
    actions={(['all', 'unconfirmed', 'confirmed', 'excluded'] as const).map(option => ({ label: (option === value ? '✓ ' : '') + (option === 'all' ? '全部' : reviewStatusLabels[option]), run: () => onChange(option) }))} />
}

// Same native top-layer popover pattern as ObservationActions: help remains
// readable outside the table and nested split panes' overflow clipping.
export function ReviewToolbar({ help, confirmed, total, saved, children }: {
  help: ReactNode; confirmed: number; total: number; saved: boolean
  children: ReactNode
}) {
  return <div className="vision-review-toolbar">
    <div className="vision-review-heading"><h2>零件审核</h2><InfoHint label="零件审核">{help}</InfoHint></div>
    <div className="vision-review-controls">{children}
      <span role="status">已确认 {confirmed}/{total} · {saved ? '审核已保存' : '审核未保存'}</span>
    </div>

  </div>
}
