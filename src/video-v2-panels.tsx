import { Group, Panel, Separator } from 'react-resizable-panels'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'

let videoV2Root: Root | null = null

const MoreActionsMenu = () => {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setIsOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  const closeMenu = () => setIsOpen(false)

  return (
    <div className="video-v2-more-actions" ref={containerRef}>
      <button
        ref={triggerRef}
        className="video-v2-more-trigger"
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="video-v2-more-menu"
        onClick={() => setIsOpen((open) => !open)}
      >
        ⋯
      </button>
      {isOpen && (
        <nav id="video-v2-more-menu" className="video-v2-more-menu" aria-label="More actions" role="menu">
          <a href="#/" role="menuitem" onClick={closeMenu}>Audio</a>
          <a href="#/generate" role="menuitem" onClick={closeMenu}>Generate Audio</a>
          <a href="#/video" role="menuitem" onClick={closeMenu}>Video</a>
          <a href="#/video-v2" role="menuitem" aria-current="page" onClick={closeMenu}>Video V2</a>
        </nav>
      )}
    </div>
  )
}

export const VideoV2Panels = () => (
  <Group className="video-v2-panel-group" orientation="horizontal">
    <Panel id="video-v2-left" className="video-v2-panel-scroll" defaultSize="25%" minSize="15%">
      <section className="video-v2-panel" aria-label="Left panel">
        <div id="video-v2-left-slot" className="video-v2-panel-slot" />
      </section>
    </Panel>
    <Separator id="video-v2-left-separator" className="video-v2-separator" />
    <Panel id="video-v2-center" className="video-v2-panel-scroll" defaultSize="35%" minSize="20%">
      <section className="video-v2-panel" aria-label="Center panel">
        <div id="video-v2-center-slot" className="video-v2-panel-slot" />
      </section>
    </Panel>
    <Separator id="video-v2-right-separator" className="video-v2-separator" />
    <Panel id="video-v2-right" className="video-v2-panel-scroll" defaultSize="40%" minSize="20%">
      <section className="video-v2-panel" aria-label="Right panel">
        <MoreActionsMenu />
        <div id="video-v2-right-slot" className="video-v2-panel-slot video-v2-right-slot" />
      </section>
    </Panel>
  </Group>
)

export const mountVideoV2 = (container: HTMLElement) => {
  videoV2Root?.unmount()
  videoV2Root = createRoot(container)
  flushSync(() => videoV2Root?.render(<VideoV2Panels />))
}

export const unmountVideoV2 = () => {
  videoV2Root?.unmount()
  videoV2Root = null
}
