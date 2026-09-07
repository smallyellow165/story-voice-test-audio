import gameJson from './game-1.json'
import { subscribeRingFacts, type RingInfraFacts } from '../ring-infra-state'
import { createGameRuntime, parseGame } from './game-runtime'

export function mountGamePanel(host: HTMLElement) {
  const game = parseGame(gameJson), runtime = createGameRuntime(game)
  host.innerHTML = `<hr><h2></h2><div class="game-bindings"></div><p class="game-task"></p>
    <p class="game-description"></p><strong class="game-result"></strong>
    <p><button class="game-next">Next Task</button><button class="game-reset">Reset Game</button></p>
    <p>结果实时更新；站位改变后会重新判断。Next 手动切换，Reset 回到 Task 1，保留圈绑定。</p>
    <details><summary>Game Debug</summary><pre class="game-debug"></pre></details>`
  host.querySelector('h2')!.textContent = game.name
  const bindings: Record<string, string> = {}, selects = new Map<string, HTMLSelectElement>()
  let latest: RingInfraFacts, ringSignature = ''
  for (const slot of game.ringSlots) {
    const label = document.createElement('label'), select = document.createElement('select')
    label.textContent = `圈 ${slot} `
    select.setAttribute('aria-label', `Game ring ${slot}`)
    label.append(select); host.querySelector('.game-bindings')!.append(label)
    selects.set(slot, select)
    select.onchange = () => { bindings[slot] = select.value; runtime.reset(); render() }
  }
  const next = host.querySelector<HTMLButtonElement>('.game-next')!
  function render() {
    const state = runtime.read(latest, bindings)
    host.querySelector('.game-task')!.textContent = `Task ${state.index + 1} / ${state.total}`
    host.querySelector('.game-description')!.textContent = state.task.description
    host.querySelector('.game-result')!.textContent = state.result
    next.disabled = state.index === state.total - 1
    host.querySelector('.game-debug')!.textContent = JSON.stringify({ ...state, bindings, facts: latest }, null, 2)
  }
  next.onclick = () => { runtime.next(); render() }
  host.querySelector<HTMLButtonElement>('.game-reset')!.onclick = () => { runtime.reset(); render() }
  return subscribeRingFacts(facts => {
    latest = facts
    const signature = JSON.stringify(facts.ringIds)
    if (signature !== ringSignature) {
      ringSignature = signature
      runtime.reset()
      selects.forEach((select, slot) => {
        if (!facts.ringIds.includes(bindings[slot])) bindings[slot] = ''
        select.replaceChildren(new Option('选择圈 ID', ''), ...facts.ringIds.map(id => new Option(id, id)))
        select.value = bindings[slot] || ''
      })
    }
    render()
  })
}
