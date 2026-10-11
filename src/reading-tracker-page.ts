import { createTracker, defaults } from './reading-tracker.ts'
import type { Config, Strategy, TrackerState } from './reading-tracker.ts'
import { compare, scenarios } from './reading-tracker-scenarios.ts'
import './reading-tracker-page.css'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<header><a href="./index.html">← Test Audio</a><p class="muted">纯文本模拟 · 无麦克风 / 无在线模型调用</p><h1>Reading Position Tracker</h1><p>用同一组 STT 事件比较 B0、B1、V1。蓝色为可撤销的暂定位置；Final 也不等于孩子读对。</p></header>
<main><section><div class="controls">
<label>测试场景<select id="scenario"></select></label><label>观察策略<select id="strategy"><option>B0</option><option>B1</option><option selected>V1</option></select></label>
<label>回放速度<select id="speed"><option value="1">1×</option><option value="4">4×</option><option value="0.5">0.5×</option></select></label>
<button id="step" class="primary">下一步</button><button id="play">自动回放</button><button id="reset">重置回放</button><button id="export">导出对照 JSON</button></div>
<details><summary>V1 实验参数（改变后重新回放；不是最优值）</summary><div id="parameters" class="controls"></div><button id="apply">应用参数</button></details><p id="error" role="alert"></p></section>
<section><h2>Reference Text</h2><div class="legend"><span class="matched">已确认匹配</span><span class="tentative">Partial 暂定</span><span class="skipped">跳过，未确认读对</span><span class="uncertain">识别不一致，非判错</span><span class="cursor">当前光标</span></div>
<div id="reference" class="reference"></div><div id="stats" class="stats" aria-live="polite"></div><p class="muted">位置为去标点后的字符索引，从 0 开始；-1 表示尚未定位。最远进度只记录已结算位置。历史匹配着色与当前光标独立。</p></section>
<div class="grid"><section><h2>当前输入与决策</h2><p id="progress"></p><div id="event" class="event"></div><p id="decision" aria-live="polite"></p><p id="note" class="muted"></p><details><summary>完整状态 / 原文索引映射</summary><pre id="state"></pre></details></section>
<section><h2>三策略 · 当前步骤</h2><div class="overflow"><table><thead><tr><th>策略</th><th>cursor / confirmed</th><th>动作与原因</th><th>对照目标</th></tr></thead><tbody id="comparison"></tbody></table></div><p class="muted">“目标偏差”是合成场景的实验结果，不等同于程序异常，也不是儿童语音准确率。</p></section></div>
<section><h2>已回放事件 · 所选策略</h2><div class="overflow"><table><thead><tr><th>步骤 / ms</th><th>STT 输入</th><th>cursor / confirmed</th><th>matched / skipped / uncertain</th><th>决策 / 目标偏差</th></tr></thead><tbody id="history"></tbody></table></div></section>
<section><h2>所有场景 · 对照结果</h2><p class="muted">每格为逐事件目标满足数 / 总数，同时检查 cursor、confirmed 与三组字符索引。点击场景查看失败步骤。</p><div class="overflow"><table><thead><tr><th>场景</th><th>B0</th><th>B1</th><th>V1</th></tr></thead><tbody id="suite"></tbody></table></div></section></main>`
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const scenarioSelect = get<HTMLSelectElement>('scenario'), strategySelect = get<HTMLSelectElement>('strategy')
for (const item of scenarios) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.title; scenarioSelect.append(option) }
for (const [key, value] of Object.entries(defaults)) {
  const label = document.createElement('label'); label.textContent = key
  const input = document.createElement('input'); input.type = 'number'; input.id = `param-${key}`; input.value = String(value); input.min = '0'; input.max = '128'
  if (key === 'minCoverage') { input.min = '0.05'; input.max = '1'; input.step = '0.05' }
  label.append(input); get('parameters').append(label)
}
let config: Config = { ...defaults }, selected = scenarios[0], results = compare(selected, config), position = -1
let timer: number | undefined
const stop = () => { window.clearTimeout(timer); timer = undefined; get('play').textContent = '自动回放' }
function cell(row: HTMLTableRowElement, value: string, className = '') { const td = row.insertCell(); td.textContent = value; td.className = className; return td }
function reference(state: TrackerState) {
  const container = get('reference'); container.replaceChildren()
  let offset = 0
  for (const char of state.reference) {
    const tokenIndices = state.tokens.flatMap((token, i) => token.start === offset ? [i] : [])
    const span = document.createElement('span'); span.textContent = char
    if (tokenIndices.length) {
      const matches = (values: number[]) => tokenIndices.some(i => values.includes(i))
      span.className = 'char'
      if (matches(state.matched)) span.classList.add('matched')
      if (matches(state.skipped)) span.classList.add('skipped')
      if (matches(state.uncertain)) span.classList.add('uncertain')
      if (matches(state.tentativeIndices)) span.classList.add('tentative')
      if (tokenIndices.includes(state.cursor)) span.classList.add('cursor')
      span.title = `token ${tokenIndices.join(',')} · UTF-16 ${offset}`
    }
    container.append(span); offset += char.length
  }
}
function render() {
  const strategy = strategySelect.value as Strategy
  const rows = results.find(r => r.strategy === strategy)!.rows
  const current = rows[position], state = current?.state ?? createTracker(selected.reference, strategy, config)
  reference(state)
  get('stats').textContent = `cursor ${state.cursor}  ·  confirmed ${state.confirmed}  ·  furthest ${state.furthest}  ·  ${state.tentative ? '暂定' : '无暂定'}  ·  ${state.complete ? '已结算到末尾（非全部读对）' : '未完成'}`
  get('progress').textContent = `步骤 ${position + 1} / ${rows.length} · epoch ${state.epoch}`
  get('event').textContent = current ? JSON.stringify(current.event) : '点击下一步，观察第一条识别事件。'
  get('decision').textContent = `${state.decision.action} · ${state.decision.reason} · ${state.decision.from} → ${state.decision.to}`
  get('note').textContent = current?.note || ''
  get('state').textContent = JSON.stringify(state, null, 2)
  get('comparison').replaceChildren()
  for (const result of results) {
    const row = document.createElement('tr'), now = result.rows[position]
    cell(row, result.strategy); cell(row, now ? `${now.state.cursor} / ${now.state.confirmed}` : '-1 / -1')
    cell(row, now ? `${now.state.decision.action} · ${now.state.decision.reason}` : 'ready')
    cell(row, now ? now.differences.join('; ') || '满足' : '待开始', now?.differences.length ? 'fail' : 'pass')
    get('comparison').append(row)
  }
  get('history').replaceChildren()
  for (const entry of rows.slice(0, position + 1)) {
    const row = document.createElement('tr'), s = entry.state, e = entry.event
    cell(row, `${entry.index + 1} / ${e.at}`)
    cell(row, e.type === 'stt' ? `${e.final ? 'Final' : 'Partial'} ${e.segment} #${e.seq}: ${JSON.stringify(e.text)}` : e.type)
    cell(row, `${s.cursor} / ${s.confirmed}`); cell(row, `[${s.matched}] / [${s.skipped}] / [${s.uncertain}]`)
    cell(row, `${s.decision.action} · ${s.decision.reason}\n${entry.differences.join('; ')}`, entry.differences.length ? 'fail' : 'pass')
    get('history').append(row)
  }
  get<HTMLButtonElement>('step').disabled = position >= rows.length - 1
  get<HTMLButtonElement>('play').disabled = position >= rows.length - 1
}
function reset() { stop(); selected = scenarios.find(s => s.id === scenarioSelect.value)!; results = compare(selected, config); position = -1; render() }
function suite() {
  get('suite').replaceChildren()
  for (const item of scenarios) {
    const row = document.createElement('tr'), link = document.createElement('button'); link.textContent = item.title
    link.onclick = () => { scenarioSelect.value = item.id; reset(); window.scrollTo({ top: 0, behavior: 'smooth' }) }
    row.insertCell().append(link)
    for (const result of compare(item, config)) {
      const passed = result.rows.filter(r => !r.differences.length).length
      cell(row, `${passed} / ${result.rows.length}`, passed === result.rows.length ? 'pass' : 'fail')
    }
    get('suite').append(row)
  }
}
function next() { if (position < selected.steps.length - 1) position++; render() }
function schedule() {
  if (position >= selected.steps.length - 1) { stop(); return }
  const before = position < 0 ? 0 : selected.steps[position].event.at
  const delay = Math.max(30, selected.steps[position + 1].event.at - before) / Number(get<HTMLSelectElement>('speed').value)
  timer = window.setTimeout(() => { next(); schedule() }, delay)
}
get('step').onclick = () => { stop(); next() }
get('play').onclick = () => { if (timer !== undefined) stop(); else { get('play').textContent = '暂停回放'; schedule() } }
get('reset').onclick = reset; scenarioSelect.onchange = reset; strategySelect.onchange = render
get('apply').onclick = () => {
  try {
    const candidate = Object.fromEntries(Object.keys(defaults).map(key => [key, Number(get<HTMLInputElement>(`param-${key}`).value)])) as unknown as Config
    createTracker(selected.reference, 'V1', candidate)
    config = candidate; get('error').textContent = ''; reset(); suite()
  } catch (error) { get('error').textContent = String(error) }
}
get('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ scenario: selected.id, config, results }, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = `reading-${selected.id}.json`; link.click(); URL.revokeObjectURL(url)
}
window.addEventListener('pagehide', stop)
suite(); render()
