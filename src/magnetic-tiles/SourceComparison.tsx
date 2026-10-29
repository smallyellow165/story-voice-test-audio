import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import type { PanelImperativeHandle, GroupImperativeHandle } from 'react-resizable-panels'

// Same nested Panel mechanism as LEGO ExplorerWorkspace. Collapsing for another
// stage is presentation only; it must not overwrite the user's comparison ratio.
export function SourceComparison({ comparing, source, candidate }: { comparing: boolean; source: ReactNode; candidate: ReactNode }) {
  const candidatePanel = useRef<PanelImperativeHandle | null>(null)
  const layout = useDefaultLayout({ id: 'magnetic-studio-comparison-v1', onlySaveAfterUserInteractions: true })
  const group = useRef<GroupImperativeHandle | null>(null)
  // Restore the full comparison explicitly: the collapsed stage has a different layout.
  const comparisonLayout = useRef(layout.defaultLayout ?? { source: 50, candidate: 50 })
  useEffect(() => {
    if (comparing) group.current?.setLayout(comparisonLayout.current)
    else candidatePanel.current?.collapse()
  }, [comparing])
  return <Group orientation="horizontal" className="studio-comparison" defaultLayout={layout.defaultLayout} groupRef={group} onLayoutChanged={(next,meta)=>{if(meta.isUserInteraction)comparisonLayout.current=next;layout.onLayoutChanged(next,meta)}}>
    <Panel id="source" defaultSize="50%" minSize="20%" className="studio-view-pane">{source}</Panel>
    <Separator className="studio-separator" disabled={!comparing} hidden={!comparing} aria-label="调整原图与候选宽度" title="拖动或使用方向键调整原图与候选宽度"/>
    <Panel id="candidate" defaultSize="50%" minSize="20%" collapsible={!comparing} collapsedSize="0%" panelRef={candidatePanel} className="studio-view-pane">
      <div hidden={!comparing}>{candidate}</div>
    </Panel>
  </Group>
}
