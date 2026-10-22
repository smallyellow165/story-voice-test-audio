export const SERVICE_UUID = 'fa879af4-d601-420c-b2b4-07ffb528dde3'
export const WRITE_UUID = 'b02eaeaa-f6bc-4a7e-bc94-f7b7fc8ded0b'
export const TOGGLE_30MIN_HEX = 'fe01000632010100ff08'

// Minimal native API surface; no BLE library or global DOM type augmentation.
export interface BleDevice extends EventTarget {
  readonly name?: string
  readonly id: string
  readonly gatt?: {
    readonly connected: boolean
    connect(): Promise<unknown>
    disconnect(): void
    getPrimaryService(uuid: string): Promise<{
      getCharacteristic(uuid: string): Promise<{
        writeValueWithResponse(value: Uint8Array): Promise<void>
      }>
    }>
  }
}
export interface BleApi {
  requestDevice(options: { filters: { name: string }[]; optionalServices: string[] }): Promise<BleDevice>
}
export type ConnectionState = {
  status: 'Disconnected' | 'Selecting' | 'Connecting' | 'Connected'
  name: string
  id: string
  error: string
  logs: string[]
  writing: boolean
}

export function environmentError(secure: boolean, bluetooth?: BleApi): string {
  if (!secure) return '当前页面不是 Secure Context。请使用受信任的 HTTPS，或本机 localhost；Android 访问电脑局域网 HTTP 地址不能使用 Web Bluetooth。'
  if (!bluetooth) return '当前浏览器未提供 Web Bluetooth API。请使用支持此 API 的 Chrome，并检查浏览器及系统蓝牙权限。'
  return ''
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

export class BleConnection {
  state: ConnectionState = { status: 'Disconnected', name: '', id: '', error: '', logs: [], writing: false }
  private generation = 0
  private device?: BleDevice
  private busy = false
  private disposed = false
  private onChange: (state: ConnectionState) => void
  private bluetooth?: BleApi
  private secure: boolean

  constructor(bluetooth: BleApi | undefined, secure: boolean, onChange: (state: ConnectionState) => void) {
    this.bluetooth = bluetooth
    this.secure = secure
    this.onChange = onChange
  }

  private update(patch: Partial<ConnectionState>, message: string) {
    if (this.disposed) return
    this.state = { ...this.state, ...patch, logs: [...this.state.logs, `${new Date().toLocaleTimeString()} — ${message}`].slice(-100) }
    this.onChange(this.state)
  }

  private onDisconnected = () => {
    this.release()
    this.update({ status: 'Disconnected', error: '设备连接已意外断开。请检查设备电源、距离和系统蓝牙状态，再点击 Connect。' }, '收到 gattserverdisconnected：设备已断开。')
  }

  private release() {
    this.generation++
    this.device?.removeEventListener('gattserverdisconnected', this.onDisconnected)
    this.device = undefined
  }

  // Called directly from the click handler: requestDevice retains user activation.
  async connect() {
    if (this.disposed || this.busy || this.state.status === 'Connected') return
    const unavailable = environmentError(this.secure, this.bluetooth)
    if (unavailable) {
      this.update({ error: unavailable }, unavailable)
      return
    }
    this.busy = true
    let selected: BleDevice | undefined
    try {
      this.update({ status: 'Selecting', error: '', name: '', id: '' }, '正在选择 WZKJ01…')
      selected = await this.bluetooth!.requestDevice({ filters: [{ name: 'WZKJ01' }], optionalServices: [SERVICE_UUID] })
      if (this.disposed) return
      if (!selected.gatt) throw new Error('所选设备没有可用的 GATT Server。')
      this.device = selected
      selected.addEventListener('gattserverdisconnected', this.onDisconnected)
      this.update({ status: 'Connecting', name: selected.name ?? '未知设备', id: selected.id }, '正在建立 GATT 连接…')
      await selected.gatt.connect()
      if (this.disposed) {
        selected.gatt.disconnect()
        return
      }
      if (this.device !== selected || !selected.gatt.connected) throw new Error('GATT 连接未建立或已断开。')
      this.update({ status: 'Connected', error: '' }, 'GATT Connected。')
    } catch (error) {
      const cancelled = !selected && error instanceof Error && error.name === 'NotFoundError'
      const message = cancelled ? '已取消选择，或没有可选择的 WZKJ01 设备。' : `连接失败：${errorText(error)}`
      this.release()
      try { selected?.gatt?.disconnect() } catch { /* Preserve the original connection error. */ }
      this.update({ status: 'Disconnected', error: message }, message)
    } finally {
      this.busy = false
    }
  }

  async toggle30min() {
    if (this.disposed || this.state.writing) return
    const details = `HEX=${TOGGLE_30MIN_HEX} Service=${SERVICE_UUID} Characteristic=${WRITE_UUID}`
    const device = this.device
    const generation = this.generation
    const assertConnected = () => {
      if (this.disposed || generation !== this.generation || !device?.gatt?.connected || this.state.status !== 'Connected') {
        throw new Error('GATT 未连接或原连接已断开；命令不会自动重试。')
      }
    }
    try {
      assertConnected()
      this.update({ writing: true, error: '' }, `BLE Write 开始：${details}`)
      // Discover on the current connection each time; never reuse stale characteristics.
      const service = await device!.gatt!.getPrimaryService(SERVICE_UUID)
      assertConnected()
      const characteristic = await service.getCharacteristic(WRITE_UUID)
      assertConnected()
      const bytes = Uint8Array.from(TOGGLE_30MIN_HEX.match(/.{2}/g)!, (byte) => parseInt(byte, 16))
      await characteristic.writeValueWithResponse(bytes)
      this.update({ writing: false }, `BLE Write Response 完成：${details}；仅确认 GATT 写入完成，设备定时状态未确认。`)
    } catch (error) {
      const message = `BLE Write 失败：${details}；${errorText(error)}；设备定时状态未确认。`
      // A late result from an old connection must not overwrite a new session's error.
      this.update({ writing: false, ...(generation === this.generation ? { error: message } : {}) }, message)
    }
  }

  disconnect() {
    if (this.disposed || this.busy || !this.device) return
    const device = this.device
    // Remove the listener first so an intentional disconnect isn't logged as unexpected.
    device.removeEventListener('gattserverdisconnected', this.onDisconnected)
    try {
      device.gatt?.disconnect()
      this.release()
      this.update({ status: 'Disconnected', error: '' }, '主动断开：Disconnected。')
    } catch (error) {
      if (device.gatt?.connected) device.addEventListener('gattserverdisconnected', this.onDisconnected)
      else this.release()
      const message = `断开失败：${errorText(error)}`
      this.update({ status: device.gatt?.connected ? 'Connected' : 'Disconnected', error: message }, message)
    }
  }

  dispose() {
    this.disposed = true
    const device = this.device
    this.release()
    try { device?.gatt?.disconnect() } catch { /* Best effort when leaving the page. */ }
  }
}
