import gameJson from './game-1.json'
import { subscribeRingFacts, type RingInfraFacts } from '../ring-infra-state'
import { createGameRuntime, parseGame } from './game-runtime'

type GameEvent = 'task_changed' | 'task_succeeded' | 'game_finished' | 'state'

export function mountGamePanel(host: HTMLElement, onEvent?: (type: GameEvent, payload: Record<string, unknown>) => void, subscribe = subscribeRingFacts) {
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
  const succeededTasks = new Set<string>()
  let lastTask = ''
  let runId = crypto.randomUUID(), taskAttemptId = crypto.randomUUID()
  let revision = 0, signature = ''
  function describeTask(description: string) {
    return description.replace(/\{([^}]+)\}/g, (_, id: string) =>
      latest.ringNames?.[id] || `第${game.ringSlots.indexOf(id) + 1}个圈`)
  }
  function snapshot() {
    const state = runtime.read(latest, bindings)
    return { activityType: 'ringfeet', gameId: game.id, gameName: game.name, runId, taskAttemptId,
      revision, lifecycle: completed && state.index === state.total - 1 ? 'finished' : 'running',
      taskId: state.task.id, index: state.index, total: state.total,
      taskDescription: describeTask(state.task.description),
      taskStatus: completed ? 'succeeded' : 'not_yet', progress: { completed: succeededTasks.size, total: state.total },
      capabilities: ['get_snapshot', 'reset', 'exit'] }
  }
  function reset() {
    cancelAdvance(); succeededTasks.clear(); runId = crypto.randomUUID(); armed = false; runtime.reset(); lastTask = ''; render()
  }
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
    const events: GameEvent[] = []
    if (lastTask !== state.task.id) {
      lastTask = state.task.id
      taskAttemptId = crypto.randomUUID()
      events.push('task_changed')
    }
    if (!armed && state.result === 'NOT_YET') armed = true
    if (!completed && armed && state.result === 'SUCCESS') {
      completed = true
      succeededTasks.add(state.task.id)
      events.push('task_succeeded')
      if (state.index === state.total - 1) events.push('game_finished')
      if (state.index < state.total - 1) timer = setTimeout(advance, 900)
    }
    const current = snapshot()
    const nextSignature = JSON.stringify({ ...current, revision: 0 })
    if (nextSignature !== signature) {
      signature = nextSignature; revision++
      if (!events.length) events.push('state')
      for (const name of events) onEvent?.(name, { snapshot: snapshot() })
    }
    const displayedResult = completed ? 'SUCCESS' : 'NOT_YET'
    host.querySelector('.game-task')!.textContent = `Task ${state.index + 1} / ${state.total}`
    host.querySelector('.game-description')!.textContent = describeTask(state.task.description)
    host.querySelector('.game-result')!.textContent = displayedResult
    next.disabled = state.index === state.total - 1
    host.querySelector('.game-debug')!.textContent = JSON.stringify({ ...state, displayedResult, autoAdvance: { armed, completed, pending: timer !== undefined, delayMs: 900 }, bindings, facts: latest }, null, 2)
  }
  next.onclick = advance
  host.querySelector<HTMLButtonElement>('.game-reset')!.onclick = reset
  const unsubscribe = subscribe(facts => {
    latest = facts
    const signature = JSON.stringify(facts.ringIds)
    if (signature !== ringSignature) {
      ringSignature = signature
      cancelAdvance()
      armed = true
      succeededTasks.clear()
      runId = crypto.randomUUID()
      runtime.reset()
      lastTask = ''

    }
    render()
  })
  return Object.assign(() => { cancelAdvance(); unsubscribe() }, { snapshot, reset })
}
