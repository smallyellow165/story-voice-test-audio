import test from 'node:test'
import assert from 'node:assert/strict'
import { selectGameInventory } from '../server/brick-game-selection.mjs'
import { loadBrickRules } from '../server/brick-rules.mjs'
import { buildDesignPrompt, designSchema, validateGeneratorInput, validateBrickDesign } from '../server/brick-generator.mjs'

// Isolated selection fixtures, never used by the application or an API request.
function review() {
  const items = [{ part_num: 'source-a', color_id: 10, quantity: 4 }, { part_num: 'source-b', color_id: 20, quantity: 3 }, { part_num: 'source-c', color_id: 30, quantity: 2 }]
  return { session: { items }, mapping: { rows: items.map((source, i) => ({ source,
    target: i === 2 ? null : { part: 'target', color: 'color' }, errors: i === 2 ? ['geometry unsupported'] : [] })) } }
}
test('mixed inventory retains exclusions and merges only explicitly selected quantities', () => {
  const value = review(), before = structuredClone(value)
  const selected = selectGameInventory(value, [{ ...value.session.items[0], quantity: 2 }, value.session.items[1]])
  assert.deepEqual(selected.inventory, [{ part: 'target', color: 'color', quantity: 5 }])
  assert.deepEqual(selected.excluded.map(r => r.quantity), [2, 2])
  assert.deepEqual(selected.excluded[1].reasons, ['geometry unsupported'])
  assert.deepEqual(value, before)
})
test('reject absent selection, unsupported rows, duplicates, foreign identities and excessive quantities', () => {
  const value = review(), item = value.session.items[0]
  for (const selection of [undefined, [], [value.session.items[2]], [item, item], [{ ...item, color_id: 999 }],
    [{ ...item, quantity: 5 }], [{ ...item, quantity: 0 }], [{ ...item, quantity: 1.5 }]])
    assert.throws(() => selectGameInventory(value, selection))
})
test('omitted usable items are explicit exclusions and source ordering is deterministic', () => {
  const value = review()
  const one = selectGameInventory(value, [value.session.items[1]])
  assert.match(one.excluded[0].reasons[0], /未选择/)
  assert.deepEqual(selectGameInventory(value, value.session.items.slice(0, 2)),
    selectGameInventory(value, value.session.items.slice(0, 2).reverse()))
})
test('shared dimensions drive prompt and geometry; request enum contains only selected inventory', async () => {
  const rules = await loadBrickRules(), part = rules.PARTS[0], color = rules.COLORS[0].code
  const inventory = [{ part: part.id, color, quantity: 2 }]
  const schema = designSchema(rules, inventory)
  assert.deepEqual(schema.properties.bricks.items.properties.part.enum, [part.id])
  assert.deepEqual(schema.properties.bricks.items.properties.color.enum, [color])
  for (const p of rules.PARTS) {
    assert.ok(buildDesignPrompt(rules).includes(JSON.stringify(p.geometry.bodySizeLdu)))
    assert.deepEqual(rules.dimensions(p.id, 0), { width: p.length, depth: p.depth })
    assert.deepEqual(rules.dimensions(p.id, 90), { width: p.depth, depth: p.length })
  }
  assert.throws(() => validateGeneratorInput({ description: 'test', inventory: [{ ...inventory[0], quantity: 1 }] }, rules))
  const bricks = [0, 1].map(layer => ({ id: 'b' + layer, part: part.id, color, x: 0, z: 0, layer, rotation: 0 }))
  const design = { name: 'test', bricks, steps: bricks.map(b => ({ brickId: b.id, instruction: 'place' })) }
  assert.equal(validateBrickDesign(design, inventory, rules).valid, true)
  assert.equal(validateBrickDesign(design, [{ ...inventory[0], quantity: 1 }], rules).valid, false)
})
