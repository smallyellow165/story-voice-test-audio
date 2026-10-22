export const SERVICE_UUID = 'fa879af4-d601-420c-b2b4-07ffb528dde3'
export const WRITE_UUID = 'b02eaeaa-f6bc-4a7e-bc94-f7b7fc8ded0b'
export const TOGGLE_30MIN_HEX = 'fe01000632010100ff08'
export const TOGGLE_60MIN_HEX = 'fe01000632010100ff1c'
export const TOGGLE_90MIN_HEX = 'fe01000632010100ff5a'
export const TOGGLE_120MIN_HEX = 'fe01000632010100ff4a'
// User confirmed opposite rotation directions; installation determines their meaning.
export const ACTION_A_HEX = 'fe01000632010100ff46'
export const ACTION_B_HEX = 'fe01000632010100ff47'

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
export interface DevicePreference {
  read(): string | null
  save(id: string): void
}

export interface BleApi {
  getDevices?(): Promise<BleDevice[]>
  requestDevice(options: { filters: { name: string }[]; optionalServices: string[] }): Promise<BleDevice>
}
export type ConnectionState = {
  status: 'Disconnected' | 'Checking' | 'Selecting' | 'Connecting' | 'Connected'
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

export type BleWriteResult = { status: 'applied' | 'rejected'; gattWrite: 'completed' | 'unconfirmed'; physicalAction: 'unconfirmed'; error?: string }

export class BleConnection {
  state: ConnectionState = { status: 'Disconnected', name: '', id: '', error: '', logs: [], writing: false }
  private generation = 0
  private device?: BleDevice
  private busy = false
  private autoAttempted = false
  private preference?: DevicePreference
  private disposed = false
  private onChange: (state: ConnectionState) => void
  private bluetooth?: BleApi
  private secure: boolean

  constructor(bluetooth: BleApi | undefined, secure: boolean, onChange: (state: ConnectionState) => void, preference?: DevicePreference) {
    this.bluetooth = bluetooth
    this.secure = secure
    this.onChange = onChange
    this.preference = preference
  }

  private update(patch: Partial<ConnectionState>, message: string) {
    if (this.disposed) return
    this.state = { ...this.state, ...patch, logs: [...this.state.logs, `${new Date().toLocaleTimeString()} — ${message}`].slice(-100) }
    this.onChange(this.state)
  }

  private onDisconnected = () => {
    this.release()
    this.update({ status: 'Disconnected', error: '设备连接已意外断开。请检查设备电源、距离和系统蓝牙状态，再点击 Connect。' }, 'Unexpected Disconnect：收到 gattserverdisconnected；浏览器未提供具体断线原因，请检查电源、距离和系统蓝牙。')
  }

  private release() {
    this.generation++
    this.device?.removeEventListener('gattserverdisconnected', this.onDisconnected)
    this.device = undefined
  }

  // One attempt per page lifetime, never from a disconnect event.
  async autoConnect() {
    if (this.autoAttempted || this.disposed) return
    this.autoAttempted = true
    return this.connectDevice('Auto Connect')
  }

  // No await before requestDevice: preserve click user activation.
  async connect() {
    this.autoAttempted = true
    return this.connectDevice('Manual Connect')
  }

  private async connectDevice(mode: 'Auto Connect' | 'Manual Connect') {
    if (this.disposed || this.busy || this.state.status === 'Connected') return
    const unavailable = environmentError(this.secure, this.bluetooth)
    if (unavailable) {
      this.update({ error: unavailable }, `${mode}：${unavailable}`)
      return
    }
    this.busy = true
    let selected: BleDevice | undefined
    try {
      if (mode === 'Auto Connect') {
        if (typeof this.bluetooth!.getDevices !== 'function') {
          this.update({}, 'Auto Connect：浏览器不支持 getDevices()，请点击 Connect 手动选择。')
          return
        }
        this.update({ status: 'Checking', error: '' }, 'Auto Connect：正在检查已授权设备…')
        const devices = await this.bluetooth!.getDevices!()
        if (this.disposed) return
        const candidates = devices.filter((device) => device.name === 'WZKJ01')
        let lastId: string | null = null
        try { lastId = this.preference?.read() ?? null } catch (error) {
          this.update({}, `Auto Connect：读取上次 Device ID 失败：${errorText(error)}`)
        }
        const preferred = candidates.filter((device) => device.id === lastId)
        selected = preferred.length === 1 ? preferred[0] : candidates.length === 1 ? candidates[0] : undefined
        if (!selected) {
          this.update({ status: 'Disconnected' }, candidates.length
            ? 'Auto Connect：多个 WZKJ01 且无法确定上次设备，请点击 Connect 手动选择。'
            : 'Auto Connect：没有已授权的 WZKJ01，请点击 Connect 首次授权。')
          return
        }
      } else {
        this.update({ status: 'Selecting', error: '', name: '', id: '' }, 'Manual Connect：正在选择 WZKJ01…')
        selected = await this.bluetooth!.requestDevice({ filters: [{ name: 'WZKJ01' }], optionalServices: [SERVICE_UUID] })
      }
      if (this.disposed) return
      if (!selected.gatt) throw new Error('所选设备没有可用的 GATT Server。')
      this.device = selected
      selected.addEventListener('gattserverdisconnected', this.onDisconnected)
      this.update({ status: 'Connecting', name: selected.name ?? '未知设备', id: selected.id }, `${mode}：正在建立 GATT 连接…`)
      await selected.gatt.connect()
      if (this.disposed) {
        selected.gatt.disconnect()
        return
      }
      if (this.device !== selected || !selected.gatt.connected) throw new Error('GATT 连接未建立或已断开。')
      this.update({ status: 'Connected', error: '' }, `${mode}：GATT Connected。`)
      try { this.preference?.save(selected.id) } catch (error) {
        this.update({}, `${mode}：保存 Device ID 失败：${errorText(error)}；连接仍可使用。`)
      }
    } catch (error) {
      const cancelled = mode === 'Manual Connect' && !selected && error instanceof Error && error.name === 'NotFoundError'
      const message = `${mode}：${cancelled ? '已取消选择，或没有可选择的 WZKJ01 设备。' : '连接失败'}；${errorText(error)}`
      this.release()
      try { selected?.gatt?.disconnect() } catch { /* Preserve the original connection error. */ }
      this.update({ status: 'Disconnected', error: message }, message)
    } finally {
      this.busy = false
    }
  }

  async toggle30min() {
    return this.writeCommand('30min Toggle', TOGGLE_30MIN_HEX)
  }

  async toggle60min() {
    return this.writeCommand('60min Toggle', TOGGLE_60MIN_HEX)
  }

  async toggle90min() {
    return this.writeCommand('90min Toggle', TOGGLE_90MIN_HEX)
  }

  async toggle120min() {
    return this.writeCommand('120min Toggle', TOGGLE_120MIN_HEX)
  }

  async actionA() {
    return this.writeCommand('Action A', ACTION_A_HEX)
  }

  async actionB() {
    return this.writeCommand('Action B', ACTION_B_HEX)
  }

  private async writeCommand(operation: string, hex: string): Promise<BleWriteResult> {
    if (this.disposed || this.state.writing) return { status: 'rejected', gattWrite: 'unconfirmed', physicalAction: 'unconfirmed', error: this.disposed ? 'ble_disposed' : 'ble_write_busy' }
    const details = `Operation=${operation} HEX=${hex} Service=${SERVICE_UUID} Characteristic=${WRITE_UUID}`
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
      const bytes = Uint8Array.from(hex.match(/.{2}/g)!, (byte) => parseInt(byte, 16))
      await characteristic.writeValueWithResponse(bytes)
      this.update({ writing: false }, `BLE Write Response 完成：${details}；仅确认 GATT 写入完成，设备定时状态未确认，实际动作需现场观察。`)
      return { status: 'applied', gattWrite: 'completed', physicalAction: 'unconfirmed' }
    } catch (error) {
      const message = `BLE Write 失败：${details}；${errorText(error)}；设备定时状态未确认，实际动作需现场观察。`
      // A late result from an old connection must not overwrite a new session's error.
      this.update({ writing: false, ...(generation === this.generation ? { error: message } : {}) }, message)
      return { status: 'rejected', gattWrite: 'unconfirmed', physicalAction: 'unconfirmed', error: errorText(error) }
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
      this.update({ status: 'Disconnected', error: '' }, 'Manual Disconnect：用户主动断开，Disconnected；本页不自动重连。')
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
