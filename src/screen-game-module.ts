import { mountGamePanel, type GamePanelOptions } from './games/game-panel'
import { createRingFacts } from './ring-infra-state'
import { createActivityBridge } from './activity-bridge'
import type { GameAction, GamePermissions } from './game-permissions'
import type { ActivityMessage } from './activity-message'

// Shared screen-game mount: one bridge, permission gate and lifecycle; no camera.
export type ScreenGameOptions = {
  instanceId: string; onMessage(message: ActivityMessage): void; canInteract?: () => boolean; permissions?: () => GamePermissions; onAction?: (name: GameAction, args: Record<string, unknown>) => void;
}
export function mountScreenGame(host: HTMLElement, options: ScreenGameOptions, panelOptions: GamePanelOptions, css: string) {
  const root = host.shadowRoot || host.attachShadow({ mode: 'open' })
  const style = document.createElement('style'); style.textContent = css
  const panelHost = document.createElement('section'); panelHost.className = 'touch-color-player'
  root.replaceChildren(style, panelHost)
  const facts = createRingFacts() // inert empty facts; never starts RingFeet infrastructure
  let panel: ReturnType<typeof mountGamePanel> | undefined
  let disposed = false
  const bridge = createActivityBridge(() => panel?.(), () => panel?.snapshot() || {}, () => panel?.reset(),
    { instanceId: options.instanceId, send: options.onMessage }, (name, args) => panel?.applyAction(name, args) ?? false)
  panel = mountGamePanel(panelHost, (name, payload) => bridge.send(name, payload), facts.subscribeRingFacts,
    { ...panelOptions, canInteract: options.canInteract, permissions: options.permissions, onAction: options.onAction })
  bridge.send('ready')
  return {
    snapshot: panel.snapshot,
    restore: panel.restore,
    setEnabled: panel.setEnabled,
    receive(message: ActivityMessage) {
      // Read-only inspection remains available, even after an authority handoff.
      if (message.name === 'reset' && options.canInteract && !options.canInteract()) return
      bridge.receive(message)
    },
    unmount() {
      if (disposed) return
      disposed = true
      if (options.permissions && !options.permissions().canAdminGame) bridge.dispose()
      bridge.receive({ v: 1, id: crypto.randomUUID(), instanceId: options.instanceId, kind: 'command', name: 'exit', payload: {} })
      panel?.(); bridge.dispose(); root.replaceChildren()
    },
  }
}
