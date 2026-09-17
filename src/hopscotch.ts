import { CLASSIC_BOARD, createHopscotch } from './hopscotch-core'
import './hopscotch.css'

const board = CLASSIC_BOARD
const game = createHopscotch({ board })
document.querySelector<HTMLDivElement>('#hopscotch')!.innerHTML = `
  <header><a href="./">← Test Audio</a><h1>Hopscotch <span>跳格子 V1</span></h1>
    <p>听家长读出任务，跳过去后点击 Done。当前位置是家长确认的逻辑位置，不是摄像头检测结果。</p></header>
  <div class="layout">
    <section aria-label="经典跳房子棋盘" class="board-panel">
      <div class="legend"><span>● 当前位置</span><span>★ 当前目标</span><span>虚线框：合法目标</span></div>
      <div id="board"></div><p class="board-note">起点在下方 · 数字是格子标签，距离按 level 计算</p>
    </section>
    <section class="task-panel" aria-label="游戏控制">
      <p class="eyebrow">CURRENT TASK / 当前任务</p>
      <h2 id="task" aria-live="polite" aria-atomic="true"></h2>
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
const boardElement = element('board')
const levels = [...new Set(board.cells.map(cell => cell.level))].sort((a, b) => b - a)
for (const level of levels) {
  const row = document.createElement('div'); row.className = 'board-row'
  for (const cell of board.cells.filter(cell => cell.level === level)) {
    const tile = document.createElement('div')
    tile.className = `cell lane-${cell.lane}`; tile.dataset.cell = cell.id
    const label = document.createElement('strong'); label.textContent = cell.label
    const status = document.createElement('small')
    tile.append(label, status); row.append(tile)
  }
  boardElement.append(row)
}

function render() {
  const state = game.read()
  element('task').textContent = state.task?.text ?? '没有合法目标'
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
  element('debug').textContent = JSON.stringify({ currentCell: state.currentCell, targetCell: state.targetCell,
    legalTargets: state.legalTargets, ...state.config, completedCount: state.completedCount, skippedCount: state.skippedCount }, null, 2)
  element('history').replaceChildren(...state.history.slice(-50).reverse().map(entry => {
    const item = document.createElement('li'); item.textContent = `${entry.from} → ${entry.target} ${entry.outcome}`; return item
  }))
  if (!state.history.length) element('history').textContent = '还没有记录。'
  element('history').title = '最近 50 条，最新在前；Core 保留本轮全部记录'
  if (!state.task) element('feedback').textContent = '当前位置没有可跳目标。开启 Allow Backward，或点击 Reset 回到起点。'
}
element('done').onclick = () => { game.done(); element('feedback').textContent = '已确认到达，继续下一条任务。'; render() }
element('skip').onclick = () => { game.skip(); element('feedback').textContent = '已换题，当前位置保持不变；只有一个合法目标时会再次选中它。'; render() }
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
render()
