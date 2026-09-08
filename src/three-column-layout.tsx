import type { ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import './three-column-layout.css'

type ThreeColumnLayoutProps = {
  left: ReactNode
  center: ReactNode
  right: ReactNode
  defaultSizes?: [string, string, string]
}

// Fill the parent's bounded width/height; each column owns its scrolling.
export function ThreeColumnLayout({ left, center, right, defaultSizes = ['22%', '58%', '20%'] }: ThreeColumnLayoutProps) {
  return (
    <Group className="three-column-layout" orientation="horizontal">
      <Panel className="three-column-layout__panel" defaultSize={defaultSizes[0]} minSize="15%" aria-label="Left panel">
        <div className="three-column-layout__content">{left}</div>
      </Panel>
      <Separator className="three-column-layout__handle" aria-label="Resize left and center" />
      <Panel className="three-column-layout__panel" defaultSize={defaultSizes[1]} minSize="35%" aria-label="Center panel">
        <div className="three-column-layout__content">{center}</div>
      </Panel>
      <Separator className="three-column-layout__handle" aria-label="Resize center and right" />
      <Panel className="three-column-layout__panel" defaultSize={defaultSizes[2]} minSize="15%" aria-label="Right panel">
        <div className="three-column-layout__content">{right}</div>
      </Panel>
    </Group>
  )
}
