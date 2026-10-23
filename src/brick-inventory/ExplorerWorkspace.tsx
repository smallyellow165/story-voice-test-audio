import { useEffect, useRef } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { PanelImperativeHandle } from 'react-resizable-panels'

export function ExplorerWorkspace({ hasGeometry, matchingHost, geometryHost }: {
  hasGeometry: boolean; matchingHost(node: HTMLDivElement | null): void; geometryHost(node: HTMLDivElement | null): void
}) {
  const geometryPanel = useRef<PanelImperativeHandle | null>(null)
  useEffect(() => {
    if (hasGeometry) geometryPanel.current?.expand()
    else geometryPanel.current?.collapse()
  }, [hasGeometry])
  return <section className="explorer-workspace" aria-label="Workspace">
    <h2 className="inventory-panel-title">Workspace</h2>
    <Group orientation="vertical" className="explorer-workspace-split">
      <Panel id="part-matching" defaultSize="55%" minSize="20%" className="explorer-workspace-pane">
        <section className="explorer-pane-scroll" aria-label="Part Matching">
          <h2>Part Matching</h2><p>从左栏识别或加载历史，在此审核；Catalog Search 位于右栏。</p>
          <div ref={matchingHost} />
        </section>
      </Panel>
      <Separator className="explorer-workspace-handle" disabled={!hasGeometry} style={{ display: hasGeometry ? undefined : 'none' }}
        aria-label="调整 Part Matching 与 Geometry Analysis 高度" title="上下拖动调整高度；方向键微调"><span aria-hidden="true" /></Separator>
      <Panel id="geometry-analysis" defaultSize="45%" minSize="20%" collapsible collapsedSize="0%" panelRef={geometryPanel} className="explorer-workspace-pane">
        <section className="explorer-pane-scroll" aria-label="Geometry Analysis" hidden={!hasGeometry}>
          <h2>Geometry Analysis</h2><div ref={geometryHost} />
        </section>
      </Panel>
    </Group>
  </section>
}
