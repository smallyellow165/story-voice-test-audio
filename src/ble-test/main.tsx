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
    <p>V4 · 机械臂动作与定时控制测试</p>
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
    </div>
    <h2>Actions</h2>
    <p className="ble-hint">Action A：机械臂向方向 A 旋转；Action B：向相反方向 B 旋转。实际安装方向决定用途。</p>
    <div className="ble-actions" role="group" aria-label="机械臂动作">
      <button disabled={state.status !== 'Connected' || state.writing} onClick={() => { void connection.actionA() }}>Action A</button>
      <button disabled={state.status !== 'Connected' || state.writing} onClick={() => { void connection.actionB() }}>Action B</button>
    </div>
    <h2>Timers</h2>
    <p className="ble-hint">预期 LED：30min 青色、60min 绿色、90min 红色、120min 紫色。相同按钮使用同一命令开启或取消；请观察设备确认，页面不推断真实定时状态。</p>
    <div className="ble-actions" role="group" aria-label="定时控制">
      <button disabled={state.status !== 'Connected' || state.writing} onClick={() => { void connection.toggle30min() }}>30min Toggle</button>
      <button disabled={state.status !== 'Connected' || state.writing} onClick={() => { void connection.toggle60min() }}>60min Toggle</button>
      <button disabled={state.status !== 'Connected' || state.writing} onClick={() => { void connection.toggle90min() }}>90min Toggle</button>
      <button disabled={state.status !== 'Connected' || state.writing} onClick={() => { void connection.toggle120min() }}>120min Toggle</button>
    </div>
    <p className="ble-hint" role="status">{state.writing ? '正在写入… ' : ''}Write Response 仅代表 GATT 写入完成，不代表设备动作成功；请现场观察动作及 LED。</p>
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
