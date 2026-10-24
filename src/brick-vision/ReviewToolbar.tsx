import { useEffect, useId, useRef, useState } from 'react'
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
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const pinned = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const cancelClose = () => { clearTimeout(timer.current) }
  const hide = () => {
    cancelClose(); pinned.current = false
    if (popup.current?.matches(':popover-open')) popup.current.hidePopover()
  }
  const show = () => {
    cancelClose()
    const panel = popup.current, button = trigger.current
    if (!panel || !button) return
    if (!panel.matches(':popover-open')) panel.showPopover()
    const rect = button.getBoundingClientRect(), margin = 8
    panel.style.left = Math.max(margin, Math.min(rect.left, window.innerWidth - panel.offsetWidth - margin)) + 'px'
    panel.style.top = (rect.bottom + panel.offsetHeight + margin <= window.innerHeight
      ? rect.bottom + 4 : Math.max(margin, rect.top - panel.offsetHeight - 4)) + 'px'
  }
  const leave = () => {
    cancelClose()
    if (!pinned.current) timer.current = setTimeout(hide, 150)
  }
  useEffect(() => {
    const close = () => {
      clearTimeout(timer.current); pinned.current = false
      if (popup.current?.matches(':popover-open')) popup.current.hidePopover()
    }
    window.addEventListener('resize', close)
    return () => { window.removeEventListener('resize', close); clearTimeout(timer.current) }
  }, [])
  return <div className="vision-review-toolbar">
    <div className="vision-review-heading"><h2>零件审核</h2>
      <button ref={trigger} type="button" className="vision-review-info" aria-label="零件审核说明"
        aria-expanded={open} aria-controls={id} onMouseEnter={show} onMouseLeave={leave}
        onFocus={show} onBlur={leave} onClick={() => {
          if (pinned.current && popup.current?.matches(':popover-open')) hide()
          else { pinned.current = true; show() }
        }}>ⓘ</button>
    </div>
    <div id={id} ref={popup} popover="auto" className="vision-review-help" role="region" aria-label="零件审核说明"
      onMouseEnter={cancelClose} onMouseLeave={leave} onFocus={cancelClose} onBlur={leave}
      onToggle={() => {
        const visible = popup.current?.matches(':popover-open') ?? false
        setOpen(visible)
        if (!visible) pinned.current = false
      }}>{help}</div>
    <div className="vision-review-controls">{children}
      <span role="status">已确认 {confirmed}/{total} · {saved ? '审核已保存' : '审核未保存'}</span>
    </div>

  </div>
}
