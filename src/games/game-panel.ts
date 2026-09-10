import gameJson from './game-1.json'
import { subscribeRingFacts, type RingInfraFacts } from '../ring-infra-state'
import { createGameRuntime, parseGame, type GameDefinition, type ColorTarget } from './game-runtime'

type GameEvent = 'task_changed' | 'task_succeeded' | 'game_finished' | 'state'

export function mountGamePanel(host: HTMLElement, onEvent?: (type: GameEvent, payload: Record<string, unknown>) => void, subscribe = subscribeRingFacts, options: { definition?: GameDefinition; touch?: boolean; canInteract?: () => boolean } = {}) {
  const game = parseGame(options.definition || gameJson), runtime = createGameRuntime(game)
  host.innerHTML = `<hr><h2></h2><p class="game-task"></p>
    <p class="game-description"></p><strong class="game-result"></strong>
    <p><button class="game-next">Next Task</button><button class="game-reset">Reset Game</button></p>
    <p>SUCCESS 显示 900ms 后自动前进。新任务若已满足，请先离开再重新站入；Next 手动切换，Reset 回到 Task 1。</p>
    <details><summary>Game Debug</summary><pre class="game-debug"></pre></details>`
  host.querySelector('h2')!.textContent = game.name
  let enabled = true
  const canInteract = () => enabled && (options.canInteract?.() ?? true)
  if (options.touch) {
    host.querySelector('.game-next')!.setAttribute('hidden', '')
    host.querySelector('.game-reset')!.parentElement!.nextElementSibling!.textContent = '点错没关系，再试一次！顺序点错后从头尝试。答对后会自动进入下一题。'
    const targets = document.createElement('div'); targets.className = 'color-targets'
    for (const [color, label] of [['red', '红色'], ['blue', '蓝色'], ['yellow', '黄色']] as const) {
      const button = document.createElement('button'); button.className = `color-target ${color}`
      button.textContent = label; button.dataset.target = color
      button.onclick = () => select(color)
      targets.append(button)
    }
    host.querySelector('.game-result')!.after(targets)
    const progress = document.createElement('p'); progress.className = 'selection-progress'; progress.setAttribute('aria-live', 'polite'); targets.after(progress)
  }
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
    return { activityType: options.touch ? 'touch-color' : 'ringfeet', gameId: game.id, gameName: game.name, runId, taskAttemptId,
      revision, lifecycle: completed && state.index === state.total - 1 ? 'finished' : 'running',
      taskId: state.task.id, index: state.index, total: state.total,
      taskDescription: describeTask(state.task.description),
      taskStatus: completed ? 'succeeded' : 'not_yet', progress: { completed: succeededTasks.size, total: state.total },
      capabilities: ['get_snapshot', 'reset', 'exit'] }
  }
  function reset() {
    if (!canInteract()) throw new Error('not_game_authority')
    cancelAdvance(); succeededTasks.clear(); runId = crypto.randomUUID(); armed = false; runtime.reset(); lastTask = ''; render()
  }
  function cancelAdvance() {
    clearTimeout(timer)
    timer = undefined
    completed = false
  }
  function advance() {
    if (!canInteract()) return
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
    if (canInteract() && !completed && armed && state.result === 'SUCCESS') {
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
    next.disabled = !canInteract() || state.index === state.total - 1
    host.querySelector<HTMLButtonElement>('.game-reset')!.disabled = !canInteract()
    for (const button of host.querySelectorAll<HTMLButtonElement>('.color-target')) button.disabled = !canInteract() || completed
    const progress = host.querySelector('.selection-progress')
    if (progress) progress.textContent = !canInteract() ? '当前为观看模式，请先取得 Game Authority。' : current.lifecycle === 'finished' ? '太棒啦，这一轮完成啦！' : `完成 ${current.progress.completed} / ${state.total} 题 · 当前顺序 ${state.selectedTargets.length} / ${state.task.condition.type === 'selectSequence' ? state.task.condition.targets.length : 0}`
    host.querySelector('.game-debug')!.textContent = JSON.stringify({ ...state, displayedResult, autoAdvance: { armed, completed, pending: timer !== undefined, delayMs: 900 }, bindings, facts: latest }, null, 2)
  }
  function select(target: ColorTarget) {
    if (!canInteract() || completed) return false
    runtime.select(target); render(); return true
  }
  function setEnabled(value: boolean) {
    if (enabled === value) return
    enabled = value
    clearTimeout(timer); timer = undefined
    if (canInteract() && completed && runtime.read(latest, bindings).index < game.tasks.length - 1) timer = setTimeout(advance, 900)
    // Permission changes are not gameplay events and must not reevaluate a held input.
    render()
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
  return Object.assign(() => { cancelAdvance(); unsubscribe() }, { snapshot, reset, select, setEnabled })
}
