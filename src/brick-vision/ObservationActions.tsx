import type { ReactNode } from 'react'
import { useEffect, useId, useRef } from 'react'

type Action = { label: string; disabled?: boolean; run(): void }

/** Native top-layer popover stays outside the table's overflow clipping. */
export function ObservationActions({ observationId, actions, triggerLabel = '···', triggerAriaLabel }: { observationId: string; actions: Action[]; triggerLabel?: ReactNode; triggerAriaLabel?: string }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: Event) => {
      const panel = popup.current
      if (panel?.matches(':popover-open') && !(event.target instanceof Node && panel.contains(event.target))) panel.hidePopover()
    }
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [])
  return <>
    <button ref={trigger} type="button" aria-label={triggerAriaLabel || `${observationId} 更多操作`} aria-controls={id}
      onClick={event => {
        event.stopPropagation()
        const panel = popup.current
        if (!panel) return
        if (panel.matches(':popover-open')) { panel.hidePopover(); return }
        const rect = event.currentTarget.getBoundingClientRect()
        panel.showPopover()
        const margin = 8
        const left = Math.max(margin, Math.min(rect.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - margin))
        const top = rect.bottom + panel.offsetHeight + margin <= window.innerHeight
          ? rect.bottom + 4 : Math.max(margin, rect.top - panel.offsetHeight - 4)
        panel.style.left = `${left}px`; panel.style.top = `${top}px`
        panel.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
      }}>{triggerLabel}</button>
    <div id={id} ref={popup} popover="auto" className="vision-observation-menu" role="group"
      aria-label={`${observationId} 操作`} onClick={event => event.stopPropagation()}>
      {actions.map(action => <button key={action.label} type="button" disabled={action.disabled} onClick={() => {
        popup.current?.hidePopover()
        trigger.current?.focus()
        action.run()
      }}>{action.label}</button>)}
    </div>
  </>
}
