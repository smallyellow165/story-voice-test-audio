import { setupTestCases } from './reading-test-cases.ts'
import { v2Defaults, v2Hints, requestV2 } from './reading-v2.ts'
import { v2Chars, v2Point, v2Details } from './reading-v2-view.ts'
import { ReadingWorkbench } from './reading-workbench.ts'
import { importLimitations } from './reading-tracker-import.ts'
import { eventReport } from './reading-tracker-report.ts'
import { defaults } from './reading-tracker.ts'
import type { Config, Strategy, TrackerState } from './reading-tracker.ts'
import { scenarios } from './reading-tracker-scenarios.ts'
import './reading-tracker-page.css'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<main class="workbench">
<section class="pane input-pane" aria-label="Input & Parameters">
<header><a href="./index.html">← Test Audio</a><h1>Matching Experiment Workbench</h1></header>
<h2>Input & Parameters</h2>
<label>测试场景<select id="scenario"></select></label>
<div class="controls"><button id="case-save" title="将当前编辑区的输入另存为新 JSON；不加载、不 Match">Save Case · 新建</button><button id="case-overwrite" disabled>覆盖当前 Case</button><button id="case-reload">重新读取 Case</button></div>
<details id="case-meta"><summary>Case 名称 / 来源说明 ⓘ</summary><label>名称<input id="case-name" maxlength="120" style="width:100%"></label><label title="请区分真实 Copy 导出、截图重建、人工构造；修改输入后请更新来源说明。">来源 / Note<textarea id="case-note" rows="2" maxlength="4000"></textarea></label></details>
<p id="case-message" class="muted" role="status"></p>
<label>Reference Text · 编辑值<textarea id="paste-reference" rows="2"></textarea></label>
<label>STT Sequence · 编辑值 <span id="format-hint" tabindex="0">ⓘ P/F 格式与限制</span><textarea id="paste-input" rows="7" spellcheck="false"></textarea></label>
<button id="load">Load STT Sequence</button><p id="load-error" role="alert"></p><p id="input-status" class="muted"></p>
<label>Strategy<select id="strategy"><option>B0</option><option>B1</option><option selected>V1</option><option>V2</option></select></label>
<h3><span id="parameter-heading">V1 Parameters</span> <small class="muted">名称 / 编辑值 / 默认值 · 悬停查看说明</small></h3>
<div id="parameters" class="parameter-grid"></div><div id="v2-parameters" class="parameter-grid" hidden></div>
<div id="v2-options" hidden><label title="规范化 Reference 索引，-1 表示尚未开始；仅作为搜索锚点。">初始 Cursor<input id="v2-cursor" type="number" value="-1" min="-1" step="1"></label><label title="Final 候选仅更新 Replay 搜索锚点，不是确认朗读位置。">Replay Anchor<select id="v2-mode"><option value="final_candidate">Final Candidate</option><option value="fixed">Fixed</option></select></label><small>仅 P/F 文本 Replay：Final 推导片段边界，不还原 Provider 的 segment/epoch；含 pause/restart 的场景不支持。参数由 Python 在 Match 时最终校验。</small></div>
<div class="controls"><button id="apply">Apply Parameters</button><button id="defaults">Reset Parameters</button></div>
<p id="error" role="alert"></p><p id="parameter-status" class="muted"></p>
<button id="match" class="primary">Match</button>
<details><summary>已加载输入 / 已应用参数</summary><pre id="loaded"></pre></details>
</section>
<section class="pane results-pane" aria-label="Matching Results">
<div class="controls"><h2>Matching Results</h2><button id="step">查看下一步</button><button id="play">自动查看</button><button id="reset">回到第一步</button>
<label>速度<select id="speed"><option value="1">1×</option><option value="4">4×</option><option value="0.5">0.5×</option></select></label></div>
<p id="status" role="status"></p><p id="snapshot" class="muted"></p>
<p><strong>本次结果 Reference：</strong><span id="reference"></span></p>
<h2>Matching Sequence <span id="progress" class="muted"></span></h2>
<table class="sequence"><colgroup><col class="step-col"><col class="input-col"><col class="match-col"><col class="skip-col"><col class="position-col"></colgroup><thead><tr><th>Step</th><th>STT Input</th><th>Match</th><th>Skip</th><th>Position / Decision</th></tr></thead><tbody id="history"></tbody></table>
<h2>Selected Step Details</h2><div id="current"></div>
<details class="debug"><summary>Debug · Actual / Expected / Pass-Fail / Alignment / JSON</summary>
<details><summary>当前步骤 · 契约与完整字符对照</summary><div id="selected-debug"></div></details>
<details><summary>B0 / B1 / V1 详细比较</summary><div id="comparison"></div></details>
<details><summary>JSON 导出 / 完整 Sequence Trace</summary><button id="export">导出对照 JSON</button><pre id="trace"></pre></details>
<details><summary>全部 22 场景 · 上次 Match 参数下的目标诊断</summary><table><thead><tr><th>场景</th><th>B0</th><th>B1</th><th>V1</th></tr></thead><tbody id="suite"></tbody></table></details>
</details></section></main>`
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const scenarioSelect = get<HTMLSelectElement>('scenario'), strategySelect = get<HTMLSelectElement>('strategy')
for (const item of scenarios) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.title; scenarioSelect.append(option) }
const hints: Record<keyof Config, string> = {
  lookBack: '从“上次 Final 已结算 Cursor 的下一字”向后搜索候选起点，不以当前 Partial 光标为基准。增大可查找更早的局部重读，也可能增加歧义；减小更偏向顺读，0 不搜索更早起点。重读仍需 repeatSupport 支持。',
  lookAhead: '从每个候选起点向前最多取多少个 Reference 字符；还受原文长度及 STT 长度 + maxGap 限制。整个 STT 规范化长度超过此值时直接不匹配。增大可容纳较长输入和候选，减小可能使长句停住；不会允许候选起点跳到已结算位置的下一字之后。',
  maxGap: '对每个含 Reference 删除的连续差异块，分别限制删除数和 STT 插入数（不是两者之和，也不是整句错字数）。如“眠→年”为删除 1、插入 1。增大可容纳较长缺口或替换，减小更严格；仍需 support 与覆盖率。纯插入由 maxExtra 限制；此值也限制候选长度不超过 STT 长度 + maxGap。',
  support: '跨过含 Reference 删除的差异块（漏字或替换）时，紧接着至少要连续匹配多少字，并且这些支持字须落在稳定证据范围内。Partial 使用与上一假设的公共前缀，Final 使用完整文本。例如“春眠不觉晓 / 春年不绝小”在“眠→年”后只有“不”1 字支持，默认 2 不接受该候选。增大更保守，减小更易推进但仍受覆盖率限制。',
  repeatSupport: '只对起点早于“上次 Final 已结算 Cursor 的下一字”的重读候选生效。候选开头必须连续匹配至少此数量，最长连续匹配及稳定证据长度也须达标；稳定证据为 Partial 公共前缀或 Final 全文。增大更难回退，减小更易接受短重读；普通顺读不要求此数量。',
  minCoverage: '候选中实际字面匹配数 ÷ 本次完整 STT 规范化字符数的最低比例。分母包含未匹配和额外 STT 字符；双方先做 NFKC 规范化、转小写，只保留字母和数字（含汉字），不计标点、空白。“春年不绝小”若匹配“春、不”，覆盖率为 2/5=0.4。增大更严格，减小更宽松；仍须通过其他规则。无合格候选时的精确前缀回退不受此比例限制。',
  maxExtra: '对不含 Reference 删除的纯 STT 插入块，限制该连续块的额外字符数；不是整句累计数，头部、内部和尾部都可能出现。候选“春眠”对 STT“春眠啊啊”有尾部插入 2 字。增大可容忍更多额外输入，减小更易拒绝候选；额外字仍计入覆盖率分母。替换块含 Reference 删除，改由 maxGap 限制。',
}
get('format-hint').title = importLimitations + ' 内置场景含 pause/restart 时显示完整事件；原样 Load 保留事件和 Expected，编辑后请改用 P/F 数组（无 Expected）。'
for (const [key, value] of Object.entries(defaults)) {
  const label = document.createElement('label')
  // Reuse native title tooltips: no overlay clipping inside the scrollable pane.
  const caption = document.createElement('span'); caption.textContent = `${key} ⓘ · 默认 ${value}`
  caption.title = hints[key as keyof Config]; caption.style.cursor = 'help'
  label.append(caption)
  const input = document.createElement('input'); input.type = 'number'; input.id = `param-${key}`; input.value = String(value); input.setAttribute('aria-description', hints[key as keyof Config]); input.min = '0'; input.max = '128'
  if (key === 'minCoverage') { input.min = '0.05'; input.max = '1'; input.step = '0.05' }
  label.append(input); get('parameters').append(label)
}
for (const [key,value] of Object.entries(v2Defaults)) {
 const label = document.createElement('label'), span = document.createElement('span')
 span.textContent = `${key} ⓘ · 默认 ${JSON.stringify(value)}`; span.title = v2Hints[key]; label.append(span)
 const input = document.createElement(Array.isArray(value) ? 'textarea' : 'input')
 input.id = `v2-${key}`; input.value = Array.isArray(value) ? JSON.stringify(value) : String(value)
 if (input instanceof HTMLInputElement) {input.type = 'number'; input.step = 'any'}
 else input.rows = 2
 label.append(input); get('v2-parameters').append(label)
}
const work = new ReadingWorkbench()
let selected = scenarios[0], results: ReturnType<typeof import('./reading-tracker-scenarios.ts').compare> = [], position = 0
let timer: number | undefined
const stop = () => { window.clearTimeout(timer); timer = undefined; get('play').textContent = '自动查看' }
function syncDraft() {
  work.draftReference = get<HTMLTextAreaElement>('paste-reference').value
  work.draftSequence = get<HTMLTextAreaElement>('paste-input').value
  work.strategy = strategySelect.value as Strategy | 'V2'
  work.draftParameters = Object.fromEntries(Object.keys(defaults).map(key => [key, Number(get<HTMLInputElement>(`param-${key}`).value)])) as unknown as Config
}
function syncV2() {
 work.draftV2 = Object.fromEntries(Object.entries(v2Defaults).map(([key,value]) => [key, Array.isArray(value) ? JSON.parse(get<HTMLTextAreaElement>(`v2-${key}`).value) : Number(get<HTMLInputElement>(`v2-${key}`).value)])) as typeof v2Defaults
 work.cursor = Number(get<HTMLInputElement>('v2-cursor').value)
 work.cursorMode = get<HTMLSelectElement>('v2-mode').value as 'fixed' | 'final_candidate'
}
function status() {
 const isV2 = work.strategy === 'V2'
 get('parameters').hidden = isV2; get('v2-parameters').hidden = !isV2; get('v2-options').hidden = !isV2
 get('parameter-heading').textContent = isV2 ? 'V2 Parameters' : 'V1 Parameters'
 get('match').textContent = work.loading ? 'Matching…（可再次 Match）' : 'Match' 
  get('input-status').textContent = work.inputPending ? '输入未加载 / 编辑值未加载' : `已加载 ${work.loaded!.scenario.steps.length} 条事件（未自动 Match）`
  get('parameter-status').textContent = work.parametersPending ? '参数编辑值未应用；Match 使用已应用参数。' : '参数已应用；仅点击 Match 计算。'
  get('status').textContent = !work.last ? '尚未 Match' : work.stale ? 'Stale / 需要重新 Match' : '结果与当前已加载输入、策略及已应用参数一致'
  get('status').className = work.stale ? 'stale' : ''
  get('loaded').textContent = JSON.stringify({ input: work.loaded, appliedParameters: work.strategy === 'V2' ? work.appliedV2 : work.applied }, null, 2)
  get<HTMLButtonElement>('match').disabled = !work.loaded || work.inputPending
}
function chooseScenario() {
  if (chooseSavedCase()) return
  work.select(scenarios.find(s => s.id === scenarioSelect.value)!)
  get<HTMLTextAreaElement>('paste-reference').value = work.draftReference
  get<HTMLTextAreaElement>('paste-input').value = work.draftSequence
  status()
}
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
  status()
  for (const id of ['step', 'play', 'reset', 'export']) get<HTMLButtonElement>(id).disabled = !work.last
  if (!work.last) return
  if (work.last.v2) { renderV2(); return }
  const result = results.find(r => r.strategy === work.last!.strategy)!
  const current = result.rows[position], state = current.state, event = current.event
  reference(state)
  get('snapshot').textContent = `上次 Match：${work.last.strategy} · ${JSON.stringify(work.last.config)} · Match/Skip 为累计状态`;
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
function renderV2() {
 const last = work.last!, replay = last.v2!, rows = replay.rows
 get('reference').textContent = replay.reference
 get('snapshot').textContent = `上次 Match：V2 · Cursor ${last.cursor} · ${last.cursorMode} · ${JSON.stringify(last.v2Config)}`
 get('progress').textContent = `· 选中 ${position+1} / ${rows.length}`
 get('history').replaceChildren()
 rows.forEach((entry,index) => {
  const row = document.createElement('tr'), m = entry.matching, button = document.createElement('button')
  row.className = index === position ? 'selected' : ''
  button.textContent = `${index+1} · ${m.stt_type === 'F' ? 'Final' : 'Partial'}`
  button.onclick = () => {stop(); position=index; render()}; row.insertCell().append(button)
  cell(row,m.stt_input || '（空假设）'); cell(row,`Exact: ${v2Chars(m,'exact')}；Phonetic: ${v2Chars(m,'phonetic')}`)
  cell(row,`Delete: ${v2Chars(m,'delete')}（候选）`)
  cell(row,`${v2Point(m)} · ${m.reason} · Cost ${m.cost}`)
  row.onclick = event => {if (!(event.target instanceof HTMLButtonElement)) button.click()}
  get('history').append(row)
 })
 get('current').innerHTML = v2Details(rows[position].matching)
 get('selected-debug').textContent = 'V2 返回 Python 实际路径；无 V1 Expected，Pass/Fail 不适用。'
 get('comparison').textContent = '切换 Strategy 后点击 Match，使用同一份已加载输入比较 V1 / V2；候选与已接受 Cursor 语义不同。'
 get('trace').textContent = JSON.stringify(replay,null,2)
 get<HTMLButtonElement>('step').disabled = position >= rows.length-1
 get<HTMLButtonElement>('play').disabled = position >= rows.length-1
}
function suite() {
  get('suite').replaceChildren()
  for (const { scenario: item, results: comparisons } of work.last?.suite ?? []) {
    const row = document.createElement('tr'), link = document.createElement('button'); link.textContent = item.title
    link.onclick = () => { scenarioSelect.value = item.id; chooseScenario() }
    row.insertCell().append(link)
    for (const result of comparisons) {
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
for (const id of ['paste-reference', 'paste-input', 'strategy', ...Object.keys(defaults).map(key => `param-${key}`)]) {
  get(id).addEventListener('input', () => { syncDraft(); status() })
}
get('load').onclick = () => {
  try { syncDraft(); work.load(); get('load-error').textContent = ''; status() }
  catch (error) { get('load-error').textContent = String(error); status() }
}
get('apply').onclick = () => {
  try { syncDraft(); if (work.strategy === 'V2') syncV2(); work.apply(); get('error').textContent = ''; status() }
  catch (error) { get('error').textContent = String(error); status() }
}
get('defaults').onclick = () => {
  work.resetParameters()
  for (const [key,value] of Object.entries(v2Defaults)) get<HTMLInputElement>(`v2-${key}`).value = Array.isArray(value) ? JSON.stringify(work.draftV2[key as keyof typeof v2Defaults]) : String(work.draftV2[key as keyof typeof v2Defaults])
  for (const [key, value] of Object.entries(work.draftParameters)) get<HTMLInputElement>(`param-${key}`).value = String(value)
  get('error').textContent = ''; status()
}
get('match').onclick = async () => {
  try {
    syncDraft();
    if (work.strategy === 'V2') { const pending = work.matchV2(requestV2); status(); if (!await pending) return }
    else work.match(scenarios); stop()
    selected = work.last!.input.scenario; results = work.last!.results; position = 0
    get('load-error').textContent = ''; render(); suite()
  } catch (error) { get('load-error').textContent = String(error); status() }
}
get('step').onclick = () => { stop(); next() }
get('play').onclick = () => { if (timer !== undefined) stop(); else { get('play').textContent = '暂停查看'; schedule() } }
get('reset').onclick = () => { stop(); position = 0; render() }
scenarioSelect.onchange = chooseScenario
get('export').onclick = () => {
  if (!work.last) return
  const url = URL.createObjectURL(new Blob([JSON.stringify({ ...work.last, eventReports: results.map(r => ({ strategy: r.strategy, rows: r.rows.map(row => eventReport(selected.id, row)) })) }, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = `reading-${selected.id}.json`; link.click(); URL.revokeObjectURL(url)
}
for (const id of [...Object.keys(v2Defaults).map(k => `v2-${k}`), 'v2-cursor','v2-mode']) get(id).addEventListener('input', () => { try {syncV2(); get('error').textContent=''} catch {get('error').textContent='近音对需要合法 JSON；尚未应用。'} status() })
window.addEventListener('pagehide', stop)
const chooseSavedCase = setupTestCases(scenarioSelect, (reference,sequence) => {
  work.template = undefined
  get<HTMLTextAreaElement>('paste-reference').value = reference
  get<HTMLTextAreaElement>('paste-input').value = sequence
  syncDraft(); status()
}, () => ({reference:get<HTMLTextAreaElement>('paste-reference').value, sequence:get<HTMLTextAreaElement>('paste-input').value}))
chooseScenario(); render()
