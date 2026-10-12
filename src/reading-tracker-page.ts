import { importSequence } from './reading-tracker-import.ts'
import { eventReport } from './reading-tracker-report.ts'
import { createTracker, defaults } from './reading-tracker.ts'
import type { Config, Strategy, TrackerState } from './reading-tracker.ts'
import { compare, scenarios } from './reading-tracker-scenarios.ts'
import './reading-tracker-page.css'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<header><a href="./index.html">← Test Audio</a><h1>Reading Position Tracker</h1><span class="muted">离线 Replay · 点击任意步骤查看实际结果</span></header>
<main><section><div class="controls">
<label>测试场景<select id="scenario"></select></label><label>观察策略<select id="strategy"><option>B0</option><option>B1</option><option selected>V1</option></select></label>
<label>回放速度<select id="speed"><option value="1">1×</option><option value="4">4×</option><option value="0.5">0.5×</option></select></label>
<button id="step" class="primary">下一步</button><button id="play">自动回放</button><button id="reset">重置回放</button></div>
</section>
<section><details id="paste-panel"><summary>Paste STT Sequence</summary>
<p class="muted">粘贴 V4 的 P/F 二维数组。Reference 默认使用当前场景，可编辑；加载后可在 Debug → V1 实验参数调整 maxGap。</p>
<label>原始 STT 输入<textarea id="paste-input" rows="6" placeholder='[["P","床"],["F","床前"]]'></textarea></label>
<label>Replay Reference<textarea id="paste-reference" rows="2"></textarea></label>
<button id="load">Load Replay</button><p id="load-error" role="alert"></p>
</details><p id="source" class="muted" role="status"></p></section>
<section class="reference-panel"><h2>Reference Text</h2><div id="reference" class="reference"></div></section>
<div class="workspace">
<section><h2>Matching Sequence <span id="progress" class="muted"></span></h2>
<p class="muted">全部事件预览 · Match / Skip 为该步累计实际状态，包含当前暂定；并非本次新增字符。</p>
<table class="sequence"><colgroup><col class="step-col"><col class="input-col"><col class="match-col"><col class="skip-col"><col class="position-col"></colgroup><thead><tr><th>Step</th><th>STT Input</th><th>Match</th><th>Skip</th><th>Position / Decision</th></tr></thead><tbody id="history"></tbody></table></section>
<section class="selected-panel"><h2>Selected Step Details</h2><div id="current" aria-live="polite"></div></section>
</div>
<details class="debug"><summary>Debug Details · Actual / Expected / Pass-Fail / Alignment / 参数 / JSON</summary>
<details><summary>当前步骤 · 契约与完整字符对照</summary><div id="selected-debug"></div></details>
<details><summary>B0 / B1 / V1 详细比较</summary><div id="comparison"></div></details>
<details><summary>V1 实验参数（改变后重新回放；不是最优值）</summary><div id="parameters" class="controls"></div><button id="apply">应用参数</button><p id="error" role="alert"></p></details>
<details><summary>JSON 导出 / 完整 Sequence Trace</summary><button id="export">导出对照 JSON</button><pre id="trace"></pre></details>
<details><summary>全部 22 场景 · 理想跟读目标对照（不是策略契约测试）</summary><table><thead><tr><th>场景</th><th>B0</th><th>B1</th><th>V1</th></tr></thead><tbody id="suite"></tbody></table></details>
</details></main>`
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const scenarioSelect = get<HTMLSelectElement>('scenario'), strategySelect = get<HTMLSelectElement>('strategy')
for (const item of scenarios) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.title; scenarioSelect.append(option) }
for (const [key, value] of Object.entries(defaults)) {
  const label = document.createElement('label'); label.textContent = key
  const input = document.createElement('input'); input.type = 'number'; input.id = `param-${key}`; input.value = String(value); input.min = '0'; input.max = '128'
  if (key === 'minCoverage') { input.min = '0.05'; input.max = '1'; input.step = '0.05' }
  label.append(input); get('parameters').append(label)
}
let config: Config = { ...defaults }, selected = scenarios[0], results = compare(selected, config), position = 0
let imported: ReturnType<typeof importSequence> | undefined
let timer: number | undefined
const stop = () => { window.clearTimeout(timer); timer = undefined; get('play').textContent = '自动回放' }
function cell(row: HTMLTableRowElement, value: string, className = '') { const td = row.insertCell(); td.textContent = value; td.className = className; return td }
function reference(state: TrackerState) {
  get('reference').textContent = state.reference.replace(/\s*\n\s*/g, '')
}
const characters = (state: TrackerState, indices: number[]) =>
  indices.map(i => state.tokens[i].text).join('、') || '无'
const point = (state: TrackerState, index: number) => index < 0 ? '尚未定位' : state.tokens[index]?.text ?? '—'
const phase = (state: TrackerState) => state.cursor < 0 ? '' : state.tentative ? '暂定' : '确认'
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
function eventCard(result: typeof results[number], index: number) {
  const row = result.rows[index], view = eventReport(selected.id, row), state = row.state, event = row.event
  const point = (position: number) => position < 0 ? '尚未定位' : state.tokens[position]?.text ?? '—'
  const strip = (chars: typeof view.actualCharacters, actual: boolean) => chars.map(c =>
    `<span class="result-char ${c.status.toLowerCase()} ${actual && state.tentativeIndices.includes(c.index) ? 'tentative' : ''} ${c.index === (actual ? state.cursor : view.expected?.cursor ?? -1) ? 'cursor' : ''}"><b>${escape(c.text)}</b><small>${c.status}</small></span>`).join('')
  const comparison = view.displayComparison
  return `<article class="event-card">
    <h3>#${index + 1} · ${result.strategy} · ${event.type === 'stt' ? event.final ? 'Final' : 'Partial' : escape(event.type)}
    <span class="${view.verdict === 'Pass' ? 'pass' : 'fail'}">${view.verdict}</span></h3>
    <p><strong>STT Input：</strong>${event.type === 'stt' ? escape(event.text || '（空假设）') : '无新 STT 文本'}</p>
    <p class="muted">底层候选 Alignment：不可用（核心未暴露路径）。以下为独立 jsdiff 规范化字符对照（略去标点），仅用于观察；不代表候选、接受位置或儿童读错。重复文本可能对应不同位置。</p>
    ${comparison.length ? `<div class="alignment">${comparison.map(c => `<div class="alignment-pair"><div>Ref <b>${escape(c.reference)}</b></div><div>STT <b>${escape(c.input)}</b></div><small>${escape(c.relation)}</small></div>`).join('')}</div>` : ''}
    <h4>Actual Output · 累计接受状态（含本次暂定）</h4>
    <div class="character-row">${strip(view.actualCharacters, true)}</div>
    <p>当前读到「${escape(point(state.cursor))}」 · 已结算到「${escape(point(state.confirmed))}」</p>
    ${view.expected ? `<h4>Expected Output · 自动化测试契约</h4>
    <div class="character-row">${strip(view.expectedCharacters, false)}</div>
    <p>预期读到「${escape(point(view.expected?.cursor ?? -1))}」 · 预期结算到「${escape(point(view.expected?.confirmed ?? -1))}」</p>
    <p>${view.verdict === 'N/A' ? '自定义 V1 参数：默认参数测试契约不适用，仍列出默认期望供参考。' : `${view.verdict}：比较 cursor、confirmed、matched、skipped、uncertain、action、reason。`}</p>
    ` : '<p>Expected / Pass-Fail：N/A（导入数据无测试期望）</p>'}
    ${view.differences.length ? `<details><summary>契约差异</summary><pre>${escape(view.differences.join('\n'))}</pre></details>` : ''}
    ${row.goal ? `<p class="${row.differences.length ? 'fail' : 'pass'}">理想跟读目标：${row.differences.length ? '未达到（与契约 Pass 可同时存在）' : '达到'}</p>` : ''}
    <details><summary>索引 / Decision Reason / 目标差异 / JSON / 完整 Debug</summary>
      <pre>${escape(JSON.stringify({ input: event, actual: state, expected: view.expected, expectedDecision: view.expectedDecision, target: row.goal, targetDifferences: row.differences, note: row.note }, null, 2))}</pre>
    </details>
  </article>`
}

function render() {
  const result = results.find(r => r.strategy === strategySelect.value as Strategy)!
  const current = result.rows[position], state = current.state, event = current.event
  reference(state)
  get('source').textContent = selected.id === 'imported-stt' ? `${imported!.limitations} ${imported!.warning}` : ''
  get('progress').textContent = `· 选中 ${position + 1} / ${result.rows.length}`
  get('history').replaceChildren()
  for (const entry of result.rows) {
    const row = document.createElement('tr'), s = entry.state, e = entry.event
    row.className = entry.index === position ? 'selected' : ''
    const button = document.createElement('button')
    button.textContent = `${entry.index + 1} · ${e.type === 'stt' ? e.final ? 'Final' : 'Partial' : e.type}`
    button.setAttribute('aria-current', String(entry.index === position))
    button.onclick = () => { stop(); position = entry.index; render() }
    row.insertCell().append(button)
    cell(row, e.type === 'stt' ? e.text || '（空假设）' : '无新 STT')
    cell(row, characters(s, s.matched), 'match-text')
    cell(row, characters(s, s.skipped), 'skip-text')
    cell(row, `${point(s, s.cursor)}${phase(s) ? `（${phase(s)}）` : ''} · ${s.decision.action}`)
    row.onclick = event => { if (!(event.target instanceof HTMLButtonElement)) button.click() }
    get('history').append(row)
  }
  const view = eventReport(selected.id, current)
  get('current').innerHTML = `<h3>#${position + 1} · ${event.type === 'stt' ? event.final ? 'Final' : 'Partial' : escape(event.type)}</h3>
    <p><strong>STT：</strong>${event.type === 'stt' ? escape(event.text || '（空假设）') : '无新 STT'}</p>
    <div class="character-row">${view.actualCharacters.map(c => `<span class="result-char ${c.status.toLowerCase()} ${state.tentativeIndices.includes(c.index) ? 'tentative' : ''} ${c.index === state.cursor ? 'cursor' : ''}"><b>${escape(c.text)}</b><small>${c.status}</small></span>`).join('')}</div>
    <dl><dt>Match</dt><dd>${escape(characters(state, state.matched))}</dd>
    <dt>Skip</dt><dd>${escape(characters(state, state.skipped))}</dd>
    <dt>Uncertain</dt><dd>${escape(characters(state, state.uncertain))}</dd>
    <dt>Unread</dt><dd>${escape(characters(state, view.actualCharacters.filter(c => c.status === 'Unread').map(c => c.index)))}</dd>
    <dt>Cursor</dt><dd>${escape(point(state, state.decision.from))} → ${escape(point(state, state.cursor))}（${phase(state) || '未定位'}）</dd>
    <dt>已结算</dt><dd>${escape(point(state, state.confirmed))}</dd>
    <dt>Decision</dt><dd><strong>${state.decision.action}</strong> · ${escape(state.decision.reason)}</dd></dl>
    <p class="muted">蓝色虚线为暂定；确认仅表示 STT 已结算。Skip 未读对，Uncertain 不判孩子读错。字符按 Reference 顺序展示；内部候选路径未暴露。</p>`
  get('selected-debug').innerHTML = eventCard(result, position)
  get('comparison').innerHTML = results.map(r => `<details><summary>${r.strategy} · ${eventReport(selected.id, r.rows[position]).verdict}</summary>${eventCard(r, position)}</details>`).join('')
  get('trace').textContent = JSON.stringify(result.rows, null, 2)
  get<HTMLButtonElement>('step').disabled = position >= result.rows.length - 1
  get<HTMLButtonElement>('play').disabled = position >= result.rows.length - 1
}
function reset() { stop(); selected = scenarioSelect.value === 'imported-stt' ? imported!.scenario : scenarios.find(s => s.id === scenarioSelect.value)!; get<HTMLTextAreaElement>('paste-reference').value = selected.reference; results = compare(selected, config); position = 0; render() }
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
get<HTMLTextAreaElement>('paste-reference').value = selected.reference
get('load').onclick = () => {
  try {
    const nextImport = importSequence(get<HTMLTextAreaElement>('paste-input').value, get<HTMLTextAreaElement>('paste-reference').value)
    imported = nextImport
    if (!Array.from(scenarioSelect.options).some(option => option.value === 'imported-stt')) {
      scenarioSelect.add(new Option('粘贴的 STT Sequence', 'imported-stt'))
    }
    scenarioSelect.value = 'imported-stt'; get('load-error').textContent = ''; reset()
  } catch (error) { get('load-error').textContent = String(error) }
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
  const url = URL.createObjectURL(new Blob([JSON.stringify({ scenario: selected.id, reference: selected.reference, importedInput: selected.id === 'imported-stt' ? imported : undefined, config, results, eventReports: results.map(r => ({ strategy: r.strategy, rows: r.rows.map(row => eventReport(selected.id, row)) })) }, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = `reading-${selected.id}.json`; link.click(); URL.revokeObjectURL(url)
}
window.addEventListener('pagehide', stop)
suite(); render()
