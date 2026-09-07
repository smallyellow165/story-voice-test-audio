import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { ThreeColumnLayout } from './three-column-layout'
import './ring-feet-layout.css'

// Move the original DOM nodes into layout-only slots. React does not own their
// contents, so the existing imperative RingFeet code keeps sole ownership.
const content = document.querySelector<HTMLTemplateElement>('#ring-feet-content')!
const title = content.content.querySelector('h1')!
const state = content.content.querySelector<HTMLElement>('.status-board')!
const camera = content.content.querySelector<HTMLElement>('.camera-panel')!
const controls = content.content.querySelector<HTMLElement>('.controls')!

flushSync(() => {
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
await import('./ring-feet')

// Composition boundary: the game subscribes to facts; infra imports no game.
const { mountGamePanel } = await import('./games/game-panel')
const gameHost = document.createElement('section')
gameHost.id = 'game-panel'
state.after(gameHost)
const unsubscribeGame = mountGamePanel(gameHost)
if (import.meta.hot) import.meta.hot.dispose(unsubscribeGame)
