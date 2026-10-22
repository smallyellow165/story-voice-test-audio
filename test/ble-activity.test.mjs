import test from 'node:test'
import assert from 'node:assert/strict'
import { createBleActivity } from '../src/ble-activity-core.ts'

// Offline native API doubles only; never imported into runtime.
function setup(write = async () => {}) {
  Object.assign(globalThis, { location: { search: '' }, window: { removeEventListener() {} } })
  const messages = [], writes = []
  const device = new EventTarget()
  device.name = 'WZKJ01'; device.id = 'browser-id'
  device.gatt = {
    connected: false,
    async connect() { this.connected = true },
    disconnect() { this.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')) },
    async getPrimaryService(uuid) {
      assert.equal(uuid, 'fa879af4-d601-420c-b2b4-07ffb528dde3')
      return { async getCharacteristic(uuid) {
        assert.equal(uuid, 'b02eaeaa-f6bc-4a7e-bc94-f7b7fc8ded0b')
        return { async writeValueWithResponse(bytes) { writes.push(Buffer.from(bytes).toString('hex')); await write() } }
      } }
    },
  }
  const activity = createBleActivity({ instanceId: 'ble', onMessage: message => messages.push(message) },
    { async requestDevice() { return device } }, true)
  const command = (action, id = crypto.randomUUID()) => {
    const state = activity.snapshot()
    return { v: 1, id, kind: 'command', name: 'ble_control', instanceId: 'ble', sessionEpoch: 'epoch',
      payload: { expectedRunId: state.runId, expectedTaskAttemptId: state.taskAttemptId,
        baseRevision: state.revision, args: { action } } }
  }
  return { activity, device, writes, messages, command }
}
async function receipt(f, id) {
  // Microtask-only drain: no network, timers, BLE, or application server.
  for (let i = 0; i < 30; i++) {
    const result = f.messages.find(m => m.kind === 'result' && m.payload.replyTo === id)
    if (result) return result.payload
    await Promise.resolve()
  }
  assert.fail('missing Activity result')
}

test('all six Activity actions use the existing BLE controller and exact bytes', async () => {
  const f = setup(); await f.activity.connection.connect()
  const entries = [ ['action_a', '46'], ['action_b', '47'], ['toggle_30min', '08'],
    ['toggle_60min', '1c'], ['toggle_90min', '5a'], ['toggle_120min', '4a'] ]
  for (const [action, suffix] of entries) {
    const command = f.command(action); f.activity.receive(command)
    const result = await receipt(f, command.id)
    assert.equal(result.status, 'applied')
    assert.equal(f.writes.at(-1), 'fe01000632010100ff' + suffix)
    assert.match(result.snapshot.taskDescription, /机械动作和定时状态未确认/)
  }
  assert.equal(f.writes.length, 6); f.activity.dispose()
})

test('in-flight/completed duplicate IDs and stale revisions cannot repeat a physical action', async () => {
  let finish
  const f = setup(() => new Promise(resolve => { finish = resolve }))
  await f.activity.connection.connect()
  const command = f.command('action_a')
  f.activity.receive(command); f.activity.receive(command)
  f.activity.receive({ ...command, id: 'stale-new-id' })
  const rejected = await receipt(f, 'stale-new-id')
  assert.equal(rejected.status, 'rejected')
  for (let i = 0; !finish && i < 20; i++) await Promise.resolve()
  assert.equal(f.writes.length, 1)
  assert.equal(f.messages.filter(m => m.kind === 'result' && m.payload.replyTo === command.id).length, 0)
  finish(); assert.equal((await receipt(f, command.id)).status, 'applied')
  f.activity.receive(command)
  assert.equal(f.writes.length, 1); f.activity.dispose()
})

test('unconnected, missing reference, failed writes and authority loss never report success', async () => {
  const f = setup(async () => { throw new Error('GATT refused') })
  let command = f.command('action_a'); f.activity.receive(command)
  assert.match((await receipt(f, command.id)).error, /ble_not_connected/)
  await f.activity.connection.connect()
  command = f.command('action_a'); delete command.payload.expectedTaskAttemptId; f.activity.receive(command)
  assert.equal((await receipt(f, command.id)).error, 'missing_task_reference')
  command = f.command('action_a'); f.activity.receive(command)
  assert.match((await receipt(f, command.id)).error, /GATT refused/)
  f.activity.setEnabled(false)
  assert.equal(f.device.gatt.connected, false)
  f.activity.receive(f.command('action_b')); assert.equal(f.writes.length, 1)
  f.activity.dispose()
})

test('connection change invalidates a voice reference and recovery never restores connection', async () => {
  const f = setup(); await f.activity.connection.connect()
  const command = f.command('toggle_30min')
  f.device.gatt.disconnect(); f.activity.receive(command)
  assert.equal((await receipt(f, command.id)).status, 'rejected')
  const snapshot = f.activity.snapshot()
  f.activity.restore(snapshot)
  assert.ok(f.activity.snapshot().revision > snapshot.revision)
  assert.equal(f.device.gatt.connected, false)
  assert.equal(f.writes.length, 0); f.activity.dispose()
})
