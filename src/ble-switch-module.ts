import { BLE_CONTROLS, createBleActivity } from './ble-activity-core'
import { environmentError, type BleApi } from './ble-test/connection'
import { allowsGameAction, defaultGamePermissions } from './game-permissions'
import type { ScreenGameOptions } from './screen-game-module'
import type { ActivityMessage } from './activity-message'

export function mount(host: HTMLElement, options: ScreenGameOptions) {
  const root = host.shadowRoot || host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = ':host{display:block;font-family:system-ui;color:#18302f}section{padding:20px;background:white;border-radius:12px}button{font:inherit;margin:6px;padding:12px;min-height:48px}button:disabled{opacity:.45}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto}.error{color:#a21b24}'
  const panel = document.createElement('section')
  panel.innerHTML = '<h2>WZKJ01 BLE</h2><p class="state" role="status"></p><p class="error" role="alert"></p><button class="connect">Connect BLE</button><button class="disconnect">Disconnect BLE</button><div class="controls"></div><p>Action A/B 为相反方向；定时命令为 Toggle。GATT 写入完成不代表机械动作完成或定时已开启。请观察设备确认。</p><h3>事件日志</h3><pre class="logs"></pre>'
  root.replaceChildren(style, panel)
  const bluetooth = (navigator as Navigator & { bluetooth?: BleApi }).bluetooth
  const unavailable = environmentError(window.isSecureContext, bluetooth)
  let disposed = false, enabled = true
  const permissions = () => options.permissions?.() ?? defaultGamePermissions(true)
  const canConnect = () => enabled && (options.canInteract?.() ?? true) && permissions().canControlGame
  const buttons: HTMLButtonElement[] = []
  const connect = panel.querySelector<HTMLButtonElement>('.connect')!
  const disconnect = panel.querySelector<HTMLButtonElement>('.disconnect')!
  const activity = createBleActivity(options, bluetooth, window.isSecureContext, render)
  function render() {
    if (disposed) return
    const state = activity.connection.state
    panel.querySelector('.state')!.textContent = `${state.status} · ${state.name || '尚未选择设备'} · ${state.id}`
    panel.querySelector('.error')!.textContent = unavailable || state.error
    panel.querySelector('.logs')!.textContent = state.logs.join('\n')
    connect.disabled = !!unavailable || !canConnect() || state.status !== 'Disconnected'
    disconnect.disabled = !canConnect() || state.status !== 'Connected'
    for (const button of buttons) button.disabled = !canConnect() || !allowsGameAction(permissions(), 'ble_control') || state.status !== 'Connected' || state.writing
  }
  connect.onclick = () => {
    if (canConnect()) void activity.connection.connect().then(() => {
      if (!enabled || !(options.canInteract?.() ?? true)) activity.connection.disconnect()
    })
  }
  disconnect.onclick = () => { if (canConnect()) activity.connection.disconnect() }
  for (const [action, control] of Object.entries(BLE_CONTROLS)) {
    const button = document.createElement('button'); button.textContent = control.label
    button.onclick = event => {
      if (event.detail > 1 || button.disabled || !canConnect()) return
      const state = activity.snapshot()
      const taskReference = { instanceId: options.instanceId, runId: state.runId, taskAttemptId: state.taskAttemptId, revision: state.revision }
      if (options.onAction) options.onAction('ble_control', { action, taskReference })
      else activity.receive({ v: 1, id: crypto.randomUUID(), kind: 'command', name: 'ble_control', instanceId: options.instanceId,
        payload: { expectedRunId: state.runId, expectedTaskAttemptId: state.taskAttemptId, baseRevision: state.revision, args: { action } } })
    }
    buttons.push(button); panel.querySelector('.controls')!.append(button)
  }
  const leave = () => activity.dispose()
  window.addEventListener('pagehide', leave)
  render(); activity.start()
  return {
    snapshot: activity.snapshot, restore: activity.restore,
    setEnabled(value: boolean) { enabled = value; activity.setEnabled(value) },
    receive(message: ActivityMessage) { activity.receive(message) },
    unmount() {
      if (permissions().canAdminGame) activity.receive({ v: 1, id: crypto.randomUUID(), instanceId: options.instanceId,
        kind: 'command', name: 'exit', payload: {} })
      disposed = true; window.removeEventListener('pagehide', leave); activity.dispose(); root.replaceChildren()
    },
  }
}
