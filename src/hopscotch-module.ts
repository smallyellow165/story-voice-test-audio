import { CLASSIC_BOARD, HOPSCOTCH_COLOR_LABELS, createHopscotch, type HopscotchCheckpoint } from './hopscotch-core'
import { HOPSCOTCH_SCRIPTS } from './hopscotch-scripts'
import { createActivityBridge } from './activity-bridge'
import { allowsGameAction, defaultGamePermissions, type GameAction } from './game-permissions'
import type { ScreenGameOptions } from './screen-game-module'
import type { ActivityMessage } from './activity-message'
import css from './hopscotch.css?inline'

// Product adapter only: the shared Core owns every move, fallback and wording decision.
export function mount(host: HTMLElement, options: ScreenGameOptions) {
  const script = HOPSCOTCH_SCRIPTS.find(script => script.id === 'mixed')!
  const core = createHopscotch({ mode: 'script', script, instructionMode: 'mixed', config: { maxJumpSteps: 1, allowBackward: true } })
  const root = host.shadowRoot || host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = css + '\n:host {display:block;color:#18302f;font-family:system-ui,sans-serif} .product {background:#fff;padding:18px;border-radius:12px} #board {margin-top:18px} #task {font-size:28px}'
  const panel = document.createElement('section'); panel.className = 'product'
  panel.innerHTML = '<h2>跳格子 · Hopscotch</h2><p id="progress"></p><h3 id="task" aria-live="polite"></h3><p id="position"></p><div class="controls"><button class="hop-confirm">做好了</button><button class="hop-repeat">再说一次</button><button class="hop-skip">换一个</button><button class="game-reset">再来一轮</button></div><div id="board" aria-label="跳格子棋盘"></div>'
  root.replaceChildren(style, panel)
  const board = panel.querySelector('#board')!
  for (const level of [...new Set(CLASSIC_BOARD.cells.map(cell => cell.level))].sort((a, b) => b - a)) {
    const row = document.createElement('div'); row.className = 'board-row'
    for (const cell of CLASSIC_BOARD.cells.filter(cell => cell.level === level)) {
      const tile = document.createElement('div'); tile.className = `cell lane-${cell.lane}`
      tile.dataset.cell = cell.id; tile.dataset.color = cell.color
      const label = document.createElement('strong'); label.textContent = cell.label
      const color = document.createElement('span'); color.className = 'cell-color'; color.textContent = HOPSCOTCH_COLOR_LABELS[cell.color!]
      tile.append(label, color, document.createElement('small')); row.append(tile)
    }
    board.append(row)
  }
  let enabled = true, closed = false, disposed = false
  let runId: string = crypto.randomUUID(), taskAttemptId: string = crypto.randomUUID()
  let revision = 1
  let finalStatus = 'succeeded'
  const canWrite = () => !closed && enabled && (options.canInteract?.() ?? true)
  const permissions = () => options.permissions?.() ?? defaultGamePermissions(canWrite(), !canWrite())
  function snapshot() {
    const state = core.read(), index = Math.min(state.scriptTaskIndex!, script.tasks.length - 1)
    return { activityType: 'hopscotch', gameId: 'hopscotch-mixed-v1', gameName: '跳格子 · Hopscotch',
      runId, taskAttemptId, revision, index, total: script.tasks.length, taskId: script.tasks[index]!.id,
      taskDescription: state.displayText ?? (state.status === 'finished' ? '这一轮完成啦！' : ''),
      lifecycle: closed ? 'closed' : state.status === 'finished' ? 'finished' : 'running',
      taskStatus: state.status === 'finished' ? finalStatus : 'not_yet',
      progress: { completed: state.scriptTaskIndex!, total: script.tasks.length },
      capabilities: ['get_snapshot', 'reset', 'exit'], hopscotch: core.checkpoint() }
  }
  function render() {
    const state = core.read()
    panel.querySelector('#task')!.textContent = state.displayText ?? '这一轮完成啦！'
    panel.querySelector('#progress')!.textContent = `Task ${Math.min(state.scriptTaskIndex! + 1, script.tasks.length)} / ${script.tasks.length} · 完成 ${state.completedCount} · 跳过 ${state.skippedCount}`
    panel.querySelector('#position')!.textContent = `家长确认的位置：${state.currentCell}`
    for (const tile of board.querySelectorAll<HTMLElement>('.cell')) {
      const current = tile.dataset.cell === state.currentCell, target = tile.dataset.cell === state.targetCell
      tile.classList.toggle('current', current); tile.classList.toggle('target', target)
      tile.querySelector('small')!.textContent = current ? '● 当前' : target ? '★ 目标' : ''
    }
    for (const [selector, action] of controls) {
      panel.querySelector<HTMLButtonElement>(selector)!.disabled = closed || !allowsGameAction(permissions(), action)
        || (action !== 'reset' && state.status !== 'active')
    }
  }
  function reset() {
    if (!canWrite()) throw new Error('not_game_authority')
    core.reset(); runId = crypto.randomUUID(); taskAttemptId = crypto.randomUUID(); revision++; finalStatus = 'succeeded'
    render(); bridge.send('task_changed')
  }
  function applyAction(name: GameAction) {
    if (!canWrite() || core.read().status !== 'active') return false
    if (name === 'repeat_task') { core.repeat(); bridge.send('task_repeated'); return true }
    if (name !== 'confirm_task' && name !== 'skip_task') return false
    const state = name === 'confirm_task' ? core.done() : core.skip()
    finalStatus = name === 'confirm_task' ? 'succeeded' : 'skipped'
    revision++; taskAttemptId = crypto.randomUUID()
    render()
    // Core transitions atomically. Publish the resulting task, not a stale completion snapshot.
    bridge.send(state.status === 'finished' ? 'game_finished' : 'task_changed')
    return true
  }
  const bridge = createActivityBridge(() => { closed = true; render() }, snapshot, reset,
    { instanceId: options.instanceId, send: options.onMessage }, applyAction)
  const controls: [string, GameAction][] = [['.hop-confirm', 'confirm_task'], ['.hop-repeat', 'repeat_task'], ['.hop-skip', 'skip_task'], ['.game-reset', 'reset']]
  for (const [selector, action] of controls) panel.querySelector<HTMLButtonElement>(selector)!.onclick = () => {
    if (!allowsGameAction(permissions(), action)) return
    if (options.onAction) options.onAction(action, {})
    else if (action === 'reset') reset()
    else applyAction(action)
  }
  render(); bridge.send('task_changed'); bridge.send('ready')
  return {
    snapshot,
    restore(value: Record<string, any>) {
      if (value.activityType !== 'hopscotch' || value.gameId !== 'hopscotch-mixed-v1'
        || !Number.isInteger(value.revision) || value.revision < 0 || typeof value.runId !== 'string' || typeof value.taskAttemptId !== 'string'
        || !value.hopscotch || value.index !== Math.min(value.hopscotch.scriptTaskIndex, script.tasks.length - 1)
        || value.taskId !== script.tasks[value.index]?.id) throw new Error('game_snapshot_mismatch')
      core.restore(value.hopscotch as HopscotchCheckpoint)
      runId = value.runId; taskAttemptId = value.taskAttemptId; revision = value.revision
      finalStatus = value.taskStatus; closed = value.lifecycle === 'closed'
      render() // Silent: no events, random choices or advance timers on recovery.
    },
    setEnabled(value: boolean) { enabled = value; render() },
    receive(message: ActivityMessage) {
      if (message.name !== 'get_snapshot' && !canWrite()) return
      bridge.receive(message)
    },
    unmount() {
      if (disposed) return
      disposed = true
      if (!options.permissions || options.permissions().canAdminGame) {
        bridge.receive({ v: 1, id: crypto.randomUUID(), instanceId: options.instanceId, kind: 'command', name: 'exit', payload: {} })
      }
      bridge.dispose(); root.replaceChildren()
    },
  }
}
