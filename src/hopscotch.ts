import { CLASSIC_BOARD, createHopscotch, HOPSCOTCH_COLOR_LABELS, type InstructionMode } from './hopscotch-core'
import { HOPSCOTCH_SCRIPTS } from './hopscotch-scripts'
import './hopscotch.css'

const board = CLASSIC_BOARD
const game = createHopscotch({ board, script: HOPSCOTCH_SCRIPTS[0] })
document.querySelector<HTMLDivElement>('#hopscotch')!.innerHTML = `
  <header><a href="./">← Test Audio</a><h1>Hopscotch <span>跳格子 V2</span></h1>
    <p>听家长读出任务，跳过去后点击 Done。当前位置是家长确认的逻辑位置，不是摄像头检测结果。</p></header>
  <div class="layout">
    <section aria-label="经典跳房子棋盘" class="board-panel">
      <div class="legend"><span>● 当前位置</span><span>★ 当前目标</span><span>虚线框：合法目标</span></div>
      <div id="board"></div><p class="board-note">起点在下方 · 数字是格子标签，距离按 level 计算</p>
    </section>
    <section class="task-panel" aria-label="游戏控制">
      <label>Game Mode <select id="mode"><option value="random">Random Mode</option><option value="script">Script Mode</option></select></label>
      <label id="script-picker" hidden>Script <select id="script"></select></label>
      <label>Instruction Mode <select id="instruction"><option value="number">Number · 数字</option><option value="color">Color · 颜色</option><option value="mixed">Mixed · 混合</option></select></label>
      <p class="eyebrow">CURRENT TASK / 当前任务</p>
      <h2 id="task" aria-live="polite" aria-atomic="true"></h2>
      <p id="progress"></p>
      <p id="position"></p><p id="feedback" role="status"></p>
      <div class="controls"><button id="done">Done · 做好了</button><button id="repeat">Repeat · 再看一次</button>
        <button id="skip">Skip · 换一个</button><button id="reset">Reset · 重新开始</button></div>
      <fieldset><legend>跳跃配置</legend>
        <label>Max Jump Steps <select id="steps"><option value="1">1 · 相邻层</option><option value="2">2 · 最多两层</option></select></label>
        <label><input id="backward" type="checkbox" checked> Allow Backward · 允许往回跳</label>
      </fieldset>
      <h3>Debug</h3><pre id="debug"></pre>
      <h3>History</h3><ol id="history" aria-label="任务历史"></ol>
    </section>
  </div>`

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
for (const script of HOPSCOTCH_SCRIPTS) {
  const option = document.createElement('option'); option.value = script.id; option.textContent = script.title
  element('script').append(option)
}
const boardElement = element('board')
const levels = [...new Set(board.cells.map(cell => cell.level))].sort((a, b) => b - a)
for (const level of levels) {
  const row = document.createElement('div'); row.className = 'board-row'
  for (const cell of board.cells.filter(cell => cell.level === level)) {
    const tile = document.createElement('div')
    tile.className = `cell lane-${cell.lane}`; tile.dataset.cell = cell.id
    if (cell.color) tile.dataset.color = cell.color
    const label = document.createElement('strong'); label.textContent = cell.label
    const colorLabel = document.createElement('span'); colorLabel.className = 'cell-color'
    colorLabel.textContent = cell.color ? HOPSCOTCH_COLOR_LABELS[cell.color] : ''
    const status = document.createElement('small')
    tile.append(label, colorLabel, status); row.append(tile)
  }
  boardElement.append(row)
}

function render() {
  const state = game.read()
  element('task').textContent = state.status === 'finished' ? '这一轮完成啦！' : state.task?.text ?? '没有合法目标'
  element('script-picker').hidden = state.mode !== 'script'
  element<HTMLSelectElement>('mode').value = state.mode
  element<HTMLSelectElement>('instruction').value = state.instructionMode
  if (state.scriptId) element<HTMLSelectElement>('script').value = state.scriptId
  element('progress').textContent = state.mode === 'script'
    ? `${state.status === 'finished' ? '已结束' : `Task ${state.scriptTaskIndex! + 1}`} / ${state.scriptTaskCount} · 已完成 ${state.completedScriptTaskCount} · 已跳过 ${state.skippedCount}` : 'Random · 无限随机任务'
  element('reset').textContent = state.mode === 'script' ? 'Reset · 再来一轮' : 'Reset · 重新开始'
  element('position').textContent = `当前位置：${board.cells.find(cell => cell.id === state.currentCell)!.label} · 完成 ${state.completedCount} · 跳过 ${state.skippedCount}`
  for (const cell of boardElement.querySelectorAll<HTMLElement>('.cell')) {
    const id = cell.dataset.cell!
    const current = id === state.currentCell, target = id === state.targetCell, legal = state.legalTargets.includes(id)
    cell.classList.toggle('current', current); cell.classList.toggle('target', target); cell.classList.toggle('legal', legal)
    cell.querySelector('small')!.textContent = current ? '● 当前' : target ? '★ 目标' : legal ? '可跳' : ' '
  }
  for (const id of ['done', 'repeat', 'skip']) element<HTMLButtonElement>(id).disabled = state.targetCell === null
  element<HTMLSelectElement>('steps').value = String(state.config.maxJumpSteps)
  element<HTMLInputElement>('backward').checked = state.config.allowBackward
  element('debug').textContent = JSON.stringify({ mode: state.mode, status: state.status, scriptId: state.scriptId,
    instructionMode: state.instructionMode, targetColor: state.targetColor, presentationKind: state.presentationKind,
    presentationFallbackReason: state.presentationFallbackReason, displayText: state.displayText,
    scriptTaskIndex: state.scriptTaskIndex, scriptTaskCount: state.scriptTaskCount,
    originalTask: state.originalTask, resolvedTask: state.resolvedTask,
    currentCell: state.currentCell, targetCell: state.targetCell,
    legalTargets: state.legalTargets, ...state.config, completedCount: state.completedCount, skippedCount: state.skippedCount }, null, 2)
  element('history').replaceChildren(...state.history.slice(-50).reverse().map(entry => {
    const item = document.createElement('li'); item.textContent = `${entry.from} → ${entry.target} ${entry.outcome} ${entry.type}`
      + (entry.plannedTarget !== entry.target ? ` (planned ${entry.plannedTarget} → resolved ${entry.target})` : '')
    return item
  }))
  if (!state.history.length) element('history').textContent = '还没有记录。'
  element('history').title = '最近 50 条，最新在前；Core 保留本轮全部记录'
  if (state.status === 'blocked') element('feedback').textContent = '当前位置没有可跳目标。开启 Allow Backward，或点击 Reset 回到起点。'
  if (state.status === 'finished') element('feedback').textContent = '本轮已结束。点击“再来一轮”重玩当前 Script。'
}
element('done').onclick = () => { game.done(); element('feedback').textContent = '已确认到达，继续下一条任务。'; render() }
element('skip').onclick = () => { const state = game.skip(); element('feedback').textContent = state.mode === 'script' ? '已跳过该项，位置保持不变；下一项已按当前位置校验。' : '已换题，当前位置保持不变；只有一个合法目标时会再次选中它。'; render() }
element('reset').onclick = () => { game.reset(); element('feedback').textContent = '已回到起点，历史已清空；保留当前跳跃配置。'; render() }
element('repeat').onclick = () => {
  const state = game.repeat()
  element('feedback').textContent = `再看一次：${state.task?.text ?? ''}`
  element('task').animate([{ backgroundColor: '#fff1a8' }, { backgroundColor: 'transparent' }], { duration: 600 })
}
function configure() {
  game.setConfig({ maxJumpSteps: Number(element<HTMLSelectElement>('steps').value) as 1 | 2,
    allowBackward: element<HTMLInputElement>('backward').checked })
  element('feedback').textContent = '配置已更新；保留仍然合法的当前任务。'
  render()
}
element('steps').onchange = configure
element('backward').onchange = configure
element('instruction').onchange = () => {
  game.setInstructionMode(element<HTMLSelectElement>('instruction').value as InstructionMode)
  element('feedback').textContent = '指令表达已更新，位置、目标和任务进度不变。'; render()
}
element('mode').onchange = () => {
  game.setMode(element<HTMLSelectElement>('mode').value as 'random' | 'script')
  element('feedback').textContent = '已切换模式，从起点开始新一轮。'; render()
}
element('script').onchange = () => {
  game.setScript(HOPSCOTCH_SCRIPTS.find(script => script.id === element<HTMLSelectElement>('script').value)!)
  element('feedback').textContent = '已切换 Script，从第一项开始。'; render()
}
render()
