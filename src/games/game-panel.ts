import gameJson from './game-1.json'
import { subscribeRingFacts, type RingInfraFacts } from '../ring-infra-state'
import { createGameRuntime, parseGame } from './game-runtime'

export function mountGamePanel(host: HTMLElement) {
  const game = parseGame(gameJson), runtime = createGameRuntime(game)
  host.innerHTML = `<hr><h2></h2><p class="game-task"></p>
    <p class="game-description"></p><strong class="game-result"></strong>
    <p><button class="game-next">Next Task</button><button class="game-reset">Reset Game</button></p>
    <p>结果实时更新；站位改变后会重新判断。Next 手动切换，Reset 回到 Task 1，无需跳跃。</p>
    <details><summary>Game Debug</summary><pre class="game-debug"></pre></details>`
  host.querySelector('h2')!.textContent = game.name
  // Identity mapping keeps evaluator rules unchanged: JSON references actual IDs.
  const bindings = Object.fromEntries(game.ringSlots.map(id => [id, id]))
  let latest: RingInfraFacts, ringSignature = ''
  const next = host.querySelector<HTMLButtonElement>('.game-next')!
  function render() {
    const state = runtime.read(latest, bindings)
    host.querySelector('.game-task')!.textContent = `Task ${state.index + 1} / ${state.total}`
    host.querySelector('.game-description')!.textContent = state.task.description.replace(/\{([^}]+)\}/g, (_, id: string) => latest.ringNames?.[id] || id)
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

    }
    render()
  })
}
