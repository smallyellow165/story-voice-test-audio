import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BleConnection, environmentError, SERVICE_UUID } from './connection'
import type { BleApi } from './connection'
import './style.css'

const bluetooth = (navigator as Navigator & { bluetooth?: BleApi }).bluetooth
const unavailable = environmentError(window.isSecureContext, bluetooth)

function BleTestPage() {
  const [connection] = useState(() => new BleConnection(bluetooth, window.isSecureContext, (next) => setState(next)))
  const [state, setState] = useState(connection.state)
  useEffect(() => {
    const leave = () => connection.dispose()
    // A bfcache restore needs a fresh controller after pagehide cleanup.
    const restore = (event: PageTransitionEvent) => { if (event.persisted) location.reload() }
    window.addEventListener('pagehide', leave)
    window.addEventListener('pageshow', restore)
    return () => {
      window.removeEventListener('pagehide', leave)
      window.removeEventListener('pageshow', restore)
      connection.dispose()
    }
  }, [connection])

  return <main className="ble-test">
    <h1>WZKJ01 BLE Test</h1>
    <p>V2 · 蓝牙 GATT 连接与 30min Toggle</p>
    <dl>
      <dt>Secure Context</dt><dd>{window.isSecureContext ? 'Yes' : 'No'}</dd>
      <dt>Web Bluetooth API</dt><dd>{bluetooth ? 'Available' : 'Unavailable'}</dd>
      <dt>Connection Status</dt><dd role="status">{state.status}</dd>
      <dt>Device Name</dt><dd>{state.name || '—'}</dd>
      <dt>Browser Device ID</dt><dd>{state.id || '—'}</dd>
      <dt>Service UUID</dt><dd>{SERVICE_UUID}</dd>
    </dl>
    <div className="ble-actions">
      <button disabled={!!unavailable || state.status !== 'Disconnected'} onClick={() => { void connection.connect() }}>Connect</button>
      <button disabled={state.status !== 'Connected'} onClick={() => connection.disconnect()}>Disconnect</button>
      <button disabled={state.status !== 'Connected' || state.writing} onClick={() => { void connection.toggle30min() }}>30min Toggle</button>
    </div>
    <p className="ble-hint" role="status">{state.writing ? '正在写入… ' : ''}Write Response 仅代表 GATT 写入完成，设备定时状态未确认；请观察设备 LED。</p>
    {(unavailable || state.error) && <p className="ble-error" role="alert">{unavailable || state.error}</p>}
    <h2>事件日志</h2>
    <ol role="log" aria-label="BLE 事件日志" aria-live="polite">
      {state.logs.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}
    </ol>
    <p className="ble-hint">日志仅保留当前页面最近 100 条事件。断开后保留最后选中的设备信息；Device ID 是浏览器标识，并非 MAC 地址。</p>
  </main>
}

const root = createRoot(document.getElementById('ble-test-root')!)
root.render(<BleTestPage />)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
