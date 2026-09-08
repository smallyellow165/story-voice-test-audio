import gameJson from './game-1.json'
import { subscribeRingFacts, type RingInfraFacts } from '../ring-infra-state'
import { createGameRuntime, parseGame } from './game-runtime'

export function mountGamePanel(host: HTMLElement) {
  const game = parseGame(gameJson), runtime = createGameRuntime(game)
  host.innerHTML = `<hr><h2></h2><p class="game-task"></p>
    <p class="game-description"></p><strong class="game-result"></strong>
    <p><button class="game-next">Next Task</button><button class="game-reset">Reset Game</button></p>
    <p>SUCCESS 显示 900ms 后自动前进。新任务若已满足，请先离开再重新站入；Next 手动切换，Reset 回到 Task 1。</p>
    <details><summary>Game Debug</summary><pre class="game-debug"></pre></details>`
  host.querySelector('h2')!.textContent = game.name
  // Identity mapping keeps evaluator rules unchanged: JSON references actual IDs.
  const bindings = Object.fromEntries(game.ringSlots.map(id => [id, id]))
  let latest: RingInfraFacts, ringSignature = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  let completed = false, armed = true
  function cancelAdvance() {
    clearTimeout(timer)
    timer = undefined
    completed = false
  }
  function advance() {
    cancelAdvance()
    runtime.next()
    // A held pose must not complete multiple consecutive tasks.
    armed = runtime.read(latest, bindings).result !== 'SUCCESS'
    render()
  }
  const next = host.querySelector<HTMLButtonElement>('.game-next')!
  function render() {
    const state = runtime.read(latest, bindings)
    if (!armed && state.result === 'NOT_YET') armed = true
    if (!completed && armed && state.result === 'SUCCESS') {
      completed = true
      if (state.index < state.total - 1) timer = setTimeout(advance, 900)
    }
    const displayedResult = completed ? 'SUCCESS' : 'NOT_YET'
    host.querySelector('.game-task')!.textContent = `Task ${state.index + 1} / ${state.total}`
    host.querySelector('.game-description')!.textContent = state.task.description.replace(/\{([^}]+)\}/g, (_, id: string) => latest.ringNames?.[id] || id)
    host.querySelector('.game-result')!.textContent = displayedResult
    next.disabled = state.index === state.total - 1
    host.querySelector('.game-debug')!.textContent = JSON.stringify({ ...state, displayedResult, autoAdvance: { armed, completed, pending: timer !== undefined, delayMs: 900 }, bindings, facts: latest }, null, 2)
  }
  next.onclick = advance
  host.querySelector<HTMLButtonElement>('.game-reset')!.onclick = () => { cancelAdvance(); armed = true; runtime.reset(); render() }
  const unsubscribe = subscribeRingFacts(facts => {
    latest = facts
    const signature = JSON.stringify(facts.ringIds)
    if (signature !== ringSignature) {
      ringSignature = signature
      cancelAdvance()
      armed = true
      runtime.reset()

    }
    render()
  })
  return () => { cancelAdvance(); unsubscribe() }
}
