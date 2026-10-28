import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { readFile } from 'node:fs/promises'
import { uiModuleUrl } from './ui-module.mjs'

const reverseUrl = new URL('../src/brick-test/ReverseAssemblyPanel.tsx', import.meta.url)
const inventoryUrl = new URL('../src/brick-vision/InventoryImagePanel.tsx', import.meta.url)
// Execute actual panel handlers with controlled UI/network dependencies, without
// starting a model or writing canonical data. DOM/visual acceptance remains manual.
async function handler(url, name, context) {
  const source = await readFile(url, 'utf8'), ast = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit) }
  visit(ast); assert.ok(found)
  const js = ts.transpileModule(found.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return Function(...Object.keys(context), js + `; return ${name}`)(...Object.values(context))
}
const ids = ['abf0baf5-f2f6-472b-af31-0c3c51231ef1','80a0ad1a-db21-4f5d-ba3b-96215e1aed83','1b9a8805-4228-43fb-9437-265cfb316606','ed37d020-0a2c-4dd4-bb29-8c3aa93cbb68']
function reverseContext({ dirty = false, confirm = () => true } = {}) {
  const state = {}, calls = []
  const ctx = { gate: { current: false }, dirty, window: { confirm }, initialScene: undefined,
    action: async (_, work) => work(),
    requestJson: async url => { calls.push(url); const id = decodeURIComponent(url.split('/').at(-1)); return { analysis: { id, kind: 'reverse-analysis', status: 'complete', analysis_mode: 'geometry_only', model: 'fixture', originalImage: { name: id + '.png' } }, rows: { [id]: { part: id } }, hiddenParts: [id], manualRelations: [id], updatedAt: id, artifact: null, generationStatus: 'none', warnings: [] } },
    acceptAnalysis: async (analysis, rows) => { state.analysis = analysis; state.rows = rows },
  }
  for (const key of ['HiddenParts','ManualRelations','Image','RestoredSelection','SavedAt','Artifact','GenerationSubmitted','RestoreWarning']) ctx['set' + key] = value => { state[key] = value }
  ctx.onRestoreModel = value => { state.model = value }
  return { ctx, state, calls }
}
test('four Penguin IDs restore their own Analysis, image reference and Review using GET only', async () => {
  const { ctx, state, calls } = reverseContext(), load = await handler(reverseUrl, 'loadHistory', ctx)
  for (const id of ids) {
    await load(id)
    assert.equal(state.analysis.id, id); assert.ok(state.rows[id]); assert.equal(state.RestoredSelection.name, id + '.png')
    assert.deepEqual(state.HiddenParts, [id]); assert.deepEqual(state.ManualRelations, [id]); assert.equal(state.SavedAt, id)
  }
  assert.equal(calls.length, 4); assert.ok(calls.every(url => url.startsWith('/api/brick-reverse/restore/')))
})
test('cancelled dirty Review switch performs no request and no state replacement; confirmed switch restores', async () => {
  let confirmed = false, prompts = 0
  const { ctx, state, calls } = reverseContext({ dirty: true, confirm: () => { prompts++; return confirmed } })
  const load = await handler(reverseUrl, 'loadHistory', ctx)
  await load(ids[0]); assert.equal(prompts, 1); assert.deepEqual(state, {}); assert.deepEqual(calls, [])
  confirmed = true; await load(ids[1]); assert.equal(state.analysis.id, ids[1]); assert.equal(prompts, 2)
})
test('failed history read keeps previously loaded content; busy and empty events do nothing', async () => {
  const { ctx, state, calls } = reverseContext()
  state.analysis = { id: ids[0] }
  ctx.requestJson = async () => { throw Error('strict source identity rejected') }
  const load = await handler(reverseUrl, 'loadHistory', ctx)
  await assert.rejects(load(ids[1]), /identity rejected/); assert.equal(state.analysis.id, ids[0])
  ctx.gate.current = true; await load(ids[1]); await load(''); assert.deepEqual(calls, [])
})
test('inventory dirty Review cancellation also protects its browser draft', async () => {
  const load = await handler(inventoryUrl, 'loadHistory', { lock: { current: false }, result: { id: ids[0] }, reviewSaved: false, window: { confirm: () => false } })
  // Any attempted request or mutation would access an unprovided dependency and fail.
  await load(ids[1])
})
test('both History dropdowns invoke restore directly, with no load or refresh button', async () => {
  for (const url of [reverseUrl, inventoryUrl]) {
    const source = await readFile(url, 'utf8')
    assert.match(source, /onChange=\{e => \{ if \(e.target.value\) void loadHistory\(e.target.value\) \}\}/)
    assert.doesNotMatch(source, />加载识别结果<|>刷新<|>刷新选择状态</)
  }
})
test('Info Hint exposes a focusable, touch-clickable native popover with matching controls', async () => {
  const React = await import('react'), { renderToStaticMarkup } = await import('react-dom/server')
  const { InfoHint } = await import(await uiModuleUrl(new URL('../src/brick-vision/InfoHint.tsx', import.meta.url)))
  const html = renderToStaticMarkup(React.createElement(InfoHint, { label: '用户 Hint' }, '待核对的假设'))
  assert.match(html, /type="button"/); assert.match(html, /aria-label="用户 Hint说明"/); assert.match(html, /popover="auto"/)
  const controls = html.match(/aria-controls="([^"]+)"/)[1]; assert.ok(html.includes(`id="${controls}"`))
  const source = await readFile(new URL('../src/brick-vision/InfoHint.tsx', import.meta.url), 'utf8')
  assert.match(source, /onMouseEnter=\{show\}/); assert.match(source, /onFocus=\{show\}/); assert.match(source, /onClick=/)
})
