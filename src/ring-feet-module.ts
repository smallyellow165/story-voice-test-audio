import html from '../ring-feet.html?raw'
import css from './ring-feet-layout.css?inline'
import playerCss from './ring-feet-player.css?inline'
import sheetCss from './ui/bottom-sheet.css?inline'
import { mountRingFeetInfra, type RingFeetInput } from './ring-feet'
import { mountGamePanel } from './games/game-panel'
import { createActivityBridge } from './activity-bridge'
import { createRingFacts } from './ring-infra-state'

export type MountOptions = RingFeetInput & {
  instanceId: string
  debug?: boolean
  onMessage: (message: any) => void
}
// UI and processing stay in this project. The host supplies media and semantic messaging only.
export function mount(host: HTMLElement, options: MountOptions) {
  const root = host.shadowRoot || host.attachShadow({ mode: 'open' })
  const template = document.createElement('template')
  template.innerHTML = html
  const content = template.content.querySelector<HTMLTemplateElement>('#ring-feet-content')!.content
  const style = document.createElement('style')
  style.textContent = css.replace(/\bbody\b/g, ':host').replace(/html, /g, '') + playerCss + sheetCss +
    ':host{display:block;height:100%;width:100%;overflow:auto} #ring-feet-layout{width:100%;height:100%;min-height:100%;} '
  if (options.debug) style.textContent += '.ringfeet-player #ring-feet-layout{grid-template-columns:minmax(0,2fr) minmax(240px,1fr)} .player-camera{max-width:420px} .ringfeet-player #game-panel .game-description,.ringfeet-player #game-panel .game-result{font-size:32px!important} @media(max-width:700px){.ringfeet-player #ring-feet-layout{grid-template-columns:1fr}}'
  const wrapper = document.createElement('div'); wrapper.className = 'ringfeet-player'
  const layout = document.createElement('div'); layout.id = 'ring-feet-layout'
  const left = document.createElement('section'), camera = document.createElement('section')
  camera.className = 'three-column-layout__panel player-camera'
  const state = content.querySelector<HTMLElement>('.status-board')!
  left.append(content.querySelector('h1')!, state)
  camera.append(content.querySelector('.camera-panel')!)
  const settings = document.createElement('details'); settings.className = 'player-settings'
  const summary = document.createElement('summary'); summary.textContent = '家长设置：摄像头 / Rings / History'
  settings.append(summary, content.querySelector('.controls')!)
  layout.append(left, camera, settings); wrapper.append(layout); root.replaceChildren(style, wrapper)
  const facts = createRingFacts()
  const infra = mountRingFeetInfra(root, { ...options, publishFacts: facts.publishRingFacts })
  const gameHost = document.createElement('section'); gameHost.id = 'game-panel'; state.before(gameHost)
  let panel: ReturnType<typeof mountGamePanel> | undefined
  const bridge = createActivityBridge(() => { panel?.(); infra.stop() },
    () => panel?.snapshot() || {}, () => panel?.reset(), { instanceId: options.instanceId, send: options.onMessage })
  panel = mountGamePanel(gameHost, (name, payload) => bridge.send(name, payload), facts.subscribeRingFacts)
  bridge.send('ready')
  let disposed = false
  console.info('[RingFeet] module mounted', options.instanceId)
  return { inspect: infra.inspect, receive: bridge.receive, unmount() {
    if (disposed) return
    disposed = true
    bridge.receive({ v: 1, id: crypto.randomUUID(), instanceId: options.instanceId, kind: 'command', name: 'exit', payload: {} })
    panel?.(); bridge.dispose(); infra.dispose(); root.replaceChildren()
    console.info('[RingFeet] module unmounted', options.instanceId)
  } }
}
