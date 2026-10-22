import test from 'node:test'
import assert from 'node:assert/strict'
import { BleConnection, environmentError, SERVICE_UUID, WRITE_UUID, TOGGLE_30MIN_HEX } from '../src/ble-test/connection.ts'

// Native API doubles exist only in tests; no hardware or server is used.
function fixture(connect) {
  const device = new EventTarget()
  device.name = 'WZKJ01'
  device.id = 'browser-device-id'
  device.gatt = {
    connected: false,
    async connect() {
      if (connect) await connect()
      this.connected = true
      return this
    },
    disconnect() {
      this.connected = false
      device.dispatchEvent(new Event('gattserverdisconnected'))
    },
  }
  let calls = 0
  const api = { async requestDevice(options) {
    calls++
    assert.deepEqual(options, { filters: [{ name: 'WZKJ01' }], optionalServices: [SERVICE_UUID] })
    return device
  } }
  const states = []
  const connection = new BleConnection(api, true, (state) => states.push(state.status))
  return { device, api, connection, states, calls: () => calls }
}

test('click flow connects, exposes identity, disconnects intentionally, and reconnects', async () => {
  const f = fixture()
  const pending = f.connection.connect()
  assert.equal(f.calls(), 1, 'chooser must be called synchronously before user activation expires')
  await f.connection.connect()
  assert.equal(f.calls(), 1, 'duplicate clicks must not create another request')
  await pending
  assert.equal(f.connection.state.name, 'WZKJ01')
  assert.equal(f.connection.state.id, 'browser-device-id')
  assert.deepEqual(f.states, ['Selecting', 'Connecting', 'Connected'])
  f.connection.disconnect()
  assert.equal(f.connection.state.status, 'Disconnected')
  assert.equal(f.connection.state.error, '')
  assert.equal(f.device.gatt.connected, false)
  await f.connection.connect()
  assert.equal(f.connection.state.status, 'Connected')
  f.connection.dispose()
})

test('unexpected disconnect updates UI and permits retry', async () => {
  const f = fixture()
  await f.connection.connect()
  f.device.gatt.disconnect()
  assert.equal(f.connection.state.status, 'Disconnected')
  assert.match(f.connection.state.error, /意外断开/)
  await f.connection.connect()
  assert.equal(f.connection.state.status, 'Connected')
  assert.equal(f.connection.state.error, '')
  f.connection.dispose()
})

test('cancellation and permission denial resolve with a visible error', async () => {
  for (const name of ['NotFoundError', 'SecurityError']) {
    const connection = new BleConnection({ requestDevice() { return Promise.reject(new DOMException('Denied', name)) } }, true, () => {})
    await connection.connect()
    assert.equal(connection.state.status, 'Disconnected')
    assert.match(connection.state.error, name === 'NotFoundError' ? /取消选择/ : /SecurityError/)
  }
})

test('connection failure removes listeners and does not reject', async () => {
  const f = fixture(() => { throw new DOMException('GATT unavailable', 'NetworkError') })
  await f.connection.connect()
  assert.equal(f.connection.state.status, 'Disconnected')
  assert.match(f.connection.state.error, /NetworkError: GATT unavailable/)
  const before = f.connection.state
  f.device.dispatchEvent(new Event('gattserverdisconnected'))
  assert.equal(f.connection.state, before)
})

test('insecure or unsupported environments never open the chooser', async () => {
  const api = { requestDevice() { assert.fail('must not request a device') } }
  for (const [secure, bluetooth] of [[false, api], [true, undefined]]) {
    const connection = new BleConnection(bluetooth, secure, () => {})
    await connection.connect()
    assert.equal(connection.state.status, 'Disconnected')
    assert.equal(connection.state.error, environmentError(secure, bluetooth))
    assert.ok(connection.state.error)
  }
})

test('leaving during chooser does not start a GATT connection', async () => {
  const f = fixture()
  let choose
  f.api.requestDevice = () => new Promise((resolve) => { choose = resolve })
  const pending = f.connection.connect()
  f.connection.dispose()
  choose(f.device)
  await pending
  assert.equal(f.device.gatt.connected, false)
  assert.deepEqual(f.states, ['Selecting'])
})

test('leaving during connection disconnects late success without updating UI', async () => {
  let finish
  const gate = new Promise((resolve) => { finish = resolve })
  const f = fixture(() => gate)
  const pending = f.connection.connect()
  await Promise.resolve()
  f.connection.dispose()
  finish()
  await pending
  assert.equal(f.device.gatt.connected, false)
  assert.deepEqual(f.states, ['Selecting', 'Connecting'])
})

test('disconnect failure remains visible and keeps listening for real disconnection', async () => {
  const f = fixture()
  await f.connection.connect()
  f.device.gatt.disconnect = () => { throw new Error('disconnect failed') }
  f.connection.disconnect()
  assert.equal(f.connection.state.status, 'Connected')
  assert.match(f.connection.state.error, /disconnect failed/)
  f.device.gatt.connected = false
  f.device.dispatchEvent(new Event('gattserverdisconnected'))
  assert.equal(f.connection.state.status, 'Disconnected')
  f.connection.dispose()
})

function writeFixture() {
  const f = fixture()
  const writes = []
  const characteristic = { async writeValueWithResponse(bytes) { writes.push(bytes) } }
  const service = { async getCharacteristic(uuid) {
    assert.equal(uuid, 'b02eaeaa-f6bc-4a7e-bc94-f7b7fc8ded0b')
    return characteristic
  } }
  f.device.gatt.getPrimaryService = async (uuid) => {
    assert.equal(uuid, 'fa879af4-d601-420c-b2b4-07ffb528dde3')
    return service
  }
  return { ...f, writes, characteristic, service }
}

const controls = [
  ['actionA', 'Action A', 'fe01000632010100ff46'],
  ['actionB', 'Action B', 'fe01000632010100ff47'],
  ['toggle30min', '30min Toggle', 'fe01000632010100ff08'],
  ['toggle60min', '60min Toggle', 'fe01000632010100ff1c'],
  ['toggle90min', '90min Toggle', 'fe01000632010100ff5a'],
  ['toggle120min', '120min Toggle', 'fe01000632010100ff4a'],
]

for (const [method, operation, hex] of controls) {
  test(`${operation}: exact payload on each click, full logs, and no write after disconnect`, async () => {
    const f = writeFixture()
    await f.connection.connect()
    for (let count = 1; count <= 2; count++) {
      await f.connection[method]()
      assert.equal(f.writes.length, count)
      assert.ok(f.writes.at(-1) instanceof Uint8Array)
      assert.equal(Buffer.from(f.writes.at(-1)).toString('hex'), hex)
      assert.equal(f.connection.state.writing, false)
      const log = f.connection.state.logs.at(-1)
      for (const value of [operation, hex, SERVICE_UUID, WRITE_UUID, 'BLE Write Response 完成']) assert.ok(log.includes(value))
      assert.match(log, /^.+ — /)
    }
    assert.equal(f.calls(), 1)
    f.connection.disconnect()
    await f.connection[method]()
    assert.equal(f.writes.length, 2)
    assert.equal(f.connection.state.status, 'Disconnected')
  })

  test(`${operation}: lock blocks all other controls and releases after a write error`, async () => {
    const f = writeFixture()
    await f.connection.connect()
    let rejectWrite
    let started
    const writing = new Promise((resolve) => { started = resolve })
    f.characteristic.writeValueWithResponse = (bytes) => {
      f.writes.push(bytes)
      started()
      return new Promise((_, reject) => { rejectWrite = reject })
    }
    const pending = f.connection[method]()
    assert.equal(f.connection.state.writing, true)
    for (const [other] of controls) await f.connection[other]()
    await writing
    for (const [other] of controls) await f.connection[other]()
    assert.equal(f.writes.length, 1, 'no queued or concurrent writes')
    rejectWrite(new DOMException('write rejected', 'NetworkError'))
    await pending
    assert.equal(f.connection.state.writing, false)
    const log = f.connection.state.logs.at(-1)
    for (const value of [operation, hex, WRITE_UUID, SERVICE_UUID, 'NetworkError: write rejected']) assert.ok(log.includes(value))
    assert.match(log, /^.+ — BLE Write 失败/)
    f.characteristic.writeValueWithResponse = async (bytes) => { f.writes.push(bytes) }
    await f.connection[method]()
    assert.equal(f.writes.length, 2)
    assert.equal(f.connection.state.error, '')
    f.connection.dispose()
  })
}

test('two toggles write identical exact bytes with response using the existing connection', async () => {
  const f = writeFixture()
  await f.connection.connect()
  await f.connection.toggle30min()
  await f.connection.toggle30min()
  assert.equal(f.calls(), 1)
  assert.equal(f.writes.length, 2)
  for (const bytes of f.writes) {
    assert.ok(bytes instanceof Uint8Array)
    assert.deepEqual([...bytes], [0xfe, 0x01, 0x00, 0x06, 0x32, 0x01, 0x01, 0x00, 0xff, 0x08])
  }
  const completed = f.connection.state.logs.filter((line) => line.includes('BLE Write Response 完成'))
  assert.equal(completed.length, 2)
  for (const line of completed) {
    assert.ok(line.includes(TOGGLE_30MIN_HEX) && line.includes(WRITE_UUID) && line.includes(SERVICE_UUID))
    assert.match(line, /^.+ — /)
    assert.match(line, /设备定时状态未确认/)
  }
  assert.equal(f.connection.state.writing, false)
  f.connection.dispose()
})

test('disconnected calls cannot write', async () => {
  const f = writeFixture()
  await f.connection.toggle30min()
  await f.connection.connect()
  f.connection.disconnect()
  await f.connection.toggle30min()
  assert.equal(f.writes.length, 0)
  assert.match(f.connection.state.error, /GATT 未连接/)
  assert.equal(f.connection.state.writing, false)
})

test('write lock spans discovery and response; duplicate clicks are not queued', async () => {
  const f = writeFixture()
  await f.connection.connect()
  let finish
  let started
  const writing = new Promise((resolve) => { started = resolve })
  f.characteristic.writeValueWithResponse = async (bytes) => {
    f.writes.push(bytes)
    started()
    await new Promise((resolve) => { finish = resolve })
  }
  const pending = f.connection.toggle30min()
  assert.equal(f.connection.state.writing, true)
  await f.connection.toggle30min()
  await writing
  await f.connection.toggle30min()
  assert.equal(f.writes.length, 1)
  finish()
  await pending
  assert.equal(f.connection.state.writing, false)
  f.connection.dispose()
})

test('service, characteristic and write errors are logged and unlock retry without auto retry', async () => {
  for (const stage of ['service', 'characteristic', 'write']) {
    const f = writeFixture()
    await f.connection.connect()
    const fail = async () => { throw new DOMException(`${stage} failed`, 'NetworkError') }
    if (stage === 'service') f.device.gatt.getPrimaryService = fail
    if (stage === 'characteristic') f.service.getCharacteristic = fail
    if (stage === 'write') f.characteristic.writeValueWithResponse = fail
    await f.connection.toggle30min()
    assert.equal(f.connection.state.writing, false)
    assert.equal(f.connection.state.status, 'Connected')
    const line = f.connection.state.logs.at(-1)
    assert.ok(line.includes(TOGGLE_30MIN_HEX) && line.includes(WRITE_UUID) && line.includes(SERVICE_UUID))
    assert.ok(line.includes(`NetworkError: ${stage} failed`))
    assert.match(line, /^.+ — /)
    assert.equal(f.connection.state.error, line.split(' — ')[1])
    f.connection.dispose()
  }
})

test('disconnect during discovery prevents writing even after reconnecting to the same device', async () => {
  const f = writeFixture()
  await f.connection.connect()
  let finish
  f.device.gatt.getPrimaryService = () => new Promise((resolve) => { finish = resolve })
  const pending = f.connection.toggle30min()
  f.device.gatt.disconnect()
  await f.connection.connect()
  finish(f.service)
  await pending
  assert.equal(f.writes.length, 0)
  assert.equal(f.connection.state.status, 'Connected')
  assert.equal(f.connection.state.error, '')
  assert.equal(f.connection.state.writing, false)
  assert.match(f.connection.state.logs.at(-1), /BLE Write 失败/)
  f.connection.dispose()
})

test('late write response after manual disconnect does not restore Connected', async () => {
  const f = writeFixture()
  await f.connection.connect()
  let finish
  let started
  const writing = new Promise((resolve) => { started = resolve })
  f.characteristic.writeValueWithResponse = () => {
    started()
    return new Promise((resolve) => { finish = resolve })
  }
  const pending = f.connection.toggle30min()
  await writing
  f.connection.disconnect()
  finish()
  await pending
  assert.equal(f.connection.state.status, 'Disconnected')
  assert.equal(f.connection.state.writing, false)
  assert.match(f.connection.state.logs.at(-1), /设备定时状态未确认/)
})

test('unmount during discovery prevents writing and further UI updates', async () => {
  const f = writeFixture()
  await f.connection.connect()
  let finish
  f.device.gatt.getPrimaryService = () => new Promise((resolve) => { finish = resolve })
  const pending = f.connection.toggle30min()
  f.connection.dispose()
  const state = f.connection.state
  finish(f.service)
  await pending
  assert.equal(f.writes.length, 0)
  assert.equal(f.connection.state, state)
})
