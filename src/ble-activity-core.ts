import { BleConnection, type BleApi } from './ble-test/connection.ts'
import { createActivityBridge } from './activity-bridge.ts'
import type { ActivityMessage } from './activity-message.ts'
import type { ScreenGameOptions } from './screen-game-module.ts'

export const BLE_CONTROLS = {
  action_a: { label: 'Action A', method: 'actionA' },
  action_b: { label: 'Action B', method: 'actionB' },
  toggle_30min: { label: '30min Toggle', method: 'toggle30min' },
  toggle_60min: { label: '60min Toggle', method: 'toggle60min' },
  toggle_90min: { label: '90min Toggle', method: 'toggle90min' },
  toggle_120min: { label: '120min Toggle', method: 'toggle120min' },
} as const

export function createBleActivity(options: ScreenGameOptions, bluetooth: BleApi | undefined,
  secure: boolean, changed: () => void = () => {}) {
  let revision = 1, closed = false, enabled = true
  let runId: string = crypto.randomUUID(), taskAttemptId: string = crypto.randomUUID()
  let lastOutcome = '尚未发送；机械动作和定时状态未确认。'
  const canWrite = () => !closed && enabled && (options.canInteract?.() ?? true)
  const connection = new BleConnection(bluetooth, secure, () => {
    revision++
    changed()
    bridge.send('state')
  })
  function snapshot() {
    return { activityType: 'ble-switch', gameId: 'wzkj01', gameName: 'WZKJ01 蓝牙开关',
      runId, taskAttemptId, revision, index: 0, total: 1, taskId: 'ble-control',
      taskDescription: `蓝牙连接：${connection.state.status}；写入中：${connection.state.writing}。${lastOutcome} 用户需在浏览器手动连接；只支持两个方向动作及四种定时 Toggle，不可查询真实设备状态。`,
      lifecycle: closed ? 'closed' : 'running', taskStatus: 'not_yet',
      progress: { completed: 0, total: 1 }, capabilities: ['get_snapshot', 'exit'],
    }
  }
  const bridge = createActivityBridge(() => {
    closed = true; connection.dispose(); changed()
  }, snapshot, () => { throw new Error('ble_reset_unsupported') },
  { instanceId: options.instanceId, send: options.onMessage }, async (name, args) => {
    if (!canWrite()) throw new Error('not_game_authority')
    if (name !== 'ble_control' || typeof args.action !== 'string' || !Object.hasOwn(BLE_CONTROLS, args.action)) {
      throw new Error('unsupported_ble_action')
    }
    if (connection.state.status !== 'Connected') throw new Error('ble_not_connected: 请先在浏览器连接 WZKJ01')
    if (connection.state.writing) throw new Error('ble_write_busy')
    // Consume the reference before any await, including unsuccessful physical writes.
    revision++; taskAttemptId = crypto.randomUUID()
    const control = BLE_CONTROLS[args.action as keyof typeof BLE_CONTROLS]
    const result = await connection[control.method]()
    lastOutcome = `${control.label}：${result.gattWrite === 'completed' ? 'GATT Write Response 完成' : '写入未确认'}；机械动作和定时状态未确认。`
    revision++; changed(); bridge.send('state')
    if (result.status !== 'applied') throw new Error(result.error || 'ble_write_unconfirmed')
    return true
  })
  return {
    connection, snapshot,
    start() { bridge.send('ready') },
    setEnabled(value: boolean) { enabled = value; if (!canWrite()) connection.disconnect(); changed() },
    receive(message: ActivityMessage) {
      if (message.name !== 'get_snapshot' && !canWrite()) return
      if (message.name === 'ble_control' && message.payload?.expectedTaskAttemptId === undefined) {
        bridge.send('command_result', { replyTo: message.id, sessionEpoch: message.sessionEpoch,
          status: 'rejected', error: 'missing_task_reference' }); return
      }
      bridge.receive(message)
    },
    restore(value: Record<string, unknown>) {
      if (value.activityType !== 'ble-switch' || value.gameId !== 'wzkj01'
        || !Number.isInteger(value.revision) || typeof value.runId !== 'string') throw new Error('ble_snapshot_mismatch')
      // Recovery never restores a Bluetooth connection or replays a physical action.
      runId = value.runId; taskAttemptId = crypto.randomUUID()
      revision = Math.max(revision, Number(value.revision)) + 1
      lastOutcome = '已恢复活动记录；本浏览器连接状态以实际连接为准，机械动作未确认。'
      changed()
    },
    dispose() { closed = true; connection.dispose(); bridge.dispose() },
  }
}
