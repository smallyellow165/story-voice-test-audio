import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assessDesignDisplay, selectDisplayCandidate } from '../src/brick-design-display.mjs'
import { loadBrickRules } from '../server/brick-rules.mjs'
import { generateBrickDesign, validateBrickDesign } from '../server/brick-generator.mjs'
import { listDesignTraces, loadDesignTrace } from '../server/brick-design-history.mjs'
const input = { description: 'display regression', inventory: [{ part: '3437', color: '14', quantity: 2 }] }
const fixture = () => ({ name: 'collision', bricks: [0, 1].map(i => ({ id: 'b' + i, part: '3437', color: '14', x: 0, z: 0, layer: 0, rotation: 0 })), steps: [{ brickId: 'b0', instruction: 'place' }, { brickId: 'b1', instruction: 'place' }] })
const reply = text => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] })

test('display accepts illegal assemblies without changing placements or granting validity', async () => {
  const rules = await loadBrickRules()
  for (const mutate of [d => {}, d => { d.steps.reverse() }, d => { d.bricks[1].layer = 3 }, d => { d.bricks[0].color = '4' }, d => { d.steps = [] }]) {
    const design = fixture(); mutate(design); const before = structuredClone(design)
    assert.equal(assessDesignDisplay(design, rules).renderable, true)
    assert.equal(validateBrickDesign(design, input.inventory, rules).valid, false)
    assert.deepEqual(design, before)
  }
  const valid = fixture(); valid.bricks[1].layer = 1
  assert.equal(assessDesignDisplay(valid, rules).renderable, true)
  assert.equal(validateBrickDesign(valid, input.inventory, rules).valid, true)
})

test('unusable IDs, parts, coordinates and rotations are rejected for display', async () => {
  const rules = await loadBrickRules()
  for (const mutate of [d => { delete d.bricks[0].x }, d => { d.bricks[0].x = NaN }, d => { d.bricks[0].layer = -1 }, d => { d.bricks[0].rotation = 45 }, d => { d.bricks[0].part = 'missing' }, d => { d.bricks[1].id = 'b0' }, d => { d.bricks = [] }]) {
    const design = fixture(); mutate(design)
    assert.equal(assessDesignDisplay(design, rules).renderable, false)
  }
  assert.equal(assessDesignDisplay(null, rules).renderable, false)
})

test('invalid generation survives failed repair, persistence and read-only restoration', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'design-display-')); t.after(() => rm(root, { recursive: true, force: true }))
  let calls = 0
  const result = await generateBrickDesign({ ...input, maxRepairAttempts: 1 }, { traceDirectory: root, model: 'gemini-3.6-flash',
    createClient: () => ({ models: { generateContent: async () => reply(++calls === 1 ? JSON.stringify(fixture()) : 'not-json') } }) })
  assert.equal(calls, 2)
  assert.equal(result.body.ok, false)
  assert.equal(result.body.error.code, 'INVALID_JSON')
  const selected = selectDisplayCandidate(result.body)
  assert.equal(selected.ok, false)
  assert.equal(selected.validation.valid, false)
  assert.deepEqual(selected.design, fixture())
  assert.notEqual(selected.id, result.body.id)
  const before = await readFile(result.body.tracePath, 'utf8')
  assert.equal((await listDesignTraces(root)).length, 2)
  const restored = await loadDesignTrace(result.body.id, root)
  assert.deepEqual(selectDisplayCandidate(restored).design, fixture())
  assert.equal(selectDisplayCandidate(restored).validation.valid, false)
  assert.equal(await readFile(result.body.tracePath, 'utf8'), before)
  assert.equal(calls, 2)
  await assert.rejects(loadDesignTrace('../outside', root), /无效/)
})

test('a renderable repair becomes the displayed candidate but stays Invalid', () => {
  const first = { ok: false, design: fixture(), display: { renderable: true, issues: [] } }
  const second = { ...first, id: 'second', priorAttempts: [first] }
  assert.equal(selectDisplayCandidate(second), second)
  assert.equal(selectDisplayCandidate({ ok: false }), null)
})


test('repair transport failure keeps the original inspectable design and independent error trace', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'design-repair-error-')); t.after(() => rm(root, { recursive: true, force: true }))
  let calls = 0
  const result = await generateBrickDesign({ ...input, maxRepairAttempts: 1 }, { traceDirectory: root, model: 'gemini-3.6-flash',
    createClient: () => ({ models: { generateContent: async () => { if (++calls === 2) throw new Error('offline'); return reply(JSON.stringify(fixture())) } } }) })
  assert.equal(calls, 2)
  assert.equal(result.body.error.code, 'PROVIDER_REQUEST')
  assert.deepEqual(selectDisplayCandidate(result.body).design, fixture())
  assert.equal((await listDesignTraces(root)).length, 2)
  const restored = await loadDesignTrace(result.body.id, root)
  assert.equal(restored.ok, false)
  assert.deepEqual(selectDisplayCandidate(restored).design, fixture())
})
