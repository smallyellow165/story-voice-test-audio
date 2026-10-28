import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './review.css'
export function InfoHint({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLSpanElement>(null)
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
  return <span className="vision-info-hint">
      <button ref={trigger} type="button" className="vision-review-info" aria-label={`${label}说明`}
        aria-expanded={open} aria-controls={id} onMouseEnter={show} onMouseLeave={leave}
        onFocus={show} onBlur={leave} onClick={() => {
          if (pinned.current && popup.current?.matches(':popover-open')) hide()
          else { pinned.current = true; show() }
        }}>ⓘ</button>
    <span id={id} ref={popup} popover="auto" className="vision-review-help" role="region" aria-label={`${label}说明`}
      onMouseEnter={cancelClose} onMouseLeave={leave} onFocus={cancelClose} onBlur={leave}
      onToggle={() => {
        const visible = popup.current?.matches(':popover-open') ?? false
        setOpen(visible)
        if (!visible) pinned.current = false
      }}>{children}</span>
  </span>
}
