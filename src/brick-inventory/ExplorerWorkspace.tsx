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
  return <section className="explorer-workspace" aria-label="零件审核工作区">
    <Group orientation="vertical" className="explorer-workspace-split">
      <Panel id="part-matching" defaultSize="55%" minSize="20%" className="explorer-workspace-pane">
        <section className="explorer-pane-scroll explorer-matching-pane" aria-label="零件审核">
          <div className="explorer-matching-host" ref={matchingHost} />
        </section>
      </Panel>
      <Separator className="explorer-workspace-handle" disabled={!hasGeometry} style={{ display: hasGeometry ? undefined : 'none' }}
        aria-label="调整零件审核与识别结果区域高度" title="上下拖动调整高度；方向键微调"><span aria-hidden="true" /></Separator>
      <Panel id="geometry-analysis" defaultSize="45%" minSize="20%" collapsible collapsedSize="0%" panelRef={geometryPanel} className="explorer-workspace-pane">
        <section className="explorer-pane-scroll" aria-label="识别结果 · 几何与证据" hidden={!hasGeometry}>
          <h2>识别结果 · 几何与证据</h2><div ref={geometryHost} />
        </section>
      </Panel>
    </Group>
  </section>
}
