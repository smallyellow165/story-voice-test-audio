import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { ThreeColumnLayout } from './three-column-layout'
import './ring-feet-layout.css'
import './ring-feet-player.css'
import { createActivityBridge } from './activity-bridge'

// Move the original DOM nodes into layout-only slots. React does not own their
// contents, so the existing imperative RingFeet code keeps sole ownership.
const content = document.querySelector<HTMLTemplateElement>('#ring-feet-content')!
const title = content.content.querySelector('h1')!
const state = content.content.querySelector<HTMLElement>('.status-board')!
const camera = content.content.querySelector<HTMLElement>('.camera-panel')!
const controls = content.content.querySelector<HTMLElement>('.controls')!

const playerMode = new URLSearchParams(location.search).get('mode') === 'player'
if (playerMode) {
  document.body.classList.add('ringfeet-player')
  const root = document.getElementById('ring-feet-layout')!
  const left = document.createElement('section')
  left.append(title, state)
  const cameraHost = document.createElement('section'); cameraHost.className = 'three-column-layout__panel player-camera'
  cameraHost.append(camera)
  const settings = document.createElement('details')
  settings.className = 'player-settings'
  const summary = document.createElement('summary'); summary.textContent = '家长设置：摄像头 / Rings / History'
  settings.append(summary, controls)
  root.append(left, cameraHost, settings)
} else flushSync(() => {
  createRoot(document.getElementById('ring-feet-layout')!).render(
    <ThreeColumnLayout
      left={<div ref={slot => { if (slot) slot.append(title, state) }} />}
      center={<div ref={slot => { if (slot) slot.append(camera) }} />}
      right={<div ref={slot => { if (slot) slot.append(controls) }} />}
    />,
  )
})
content.remove()

// Bind handlers only after every original ID is present in the mounted layout.
const infra = await import('./ring-feet')

// Composition boundary: the game subscribes to facts; infra imports no game.
const { mountGamePanel } = await import('./games/game-panel')
const gameHost = document.createElement('section')
gameHost.id = 'game-panel'
state.before(gameHost)
let unsubscribeGame = () => {}
const bridge = playerMode ? createActivityBridge(() => { unsubscribeGame(); infra.stopRingFeetActivity() }) : null
unsubscribeGame = mountGamePanel(gameHost, (type, payload) => bridge?.send(type, payload))
bridge?.send('ready')
window.addEventListener('pagehide', () => { unsubscribeGame(); bridge?.dispose() })
if (import.meta.hot) import.meta.hot.dispose(unsubscribeGame)
