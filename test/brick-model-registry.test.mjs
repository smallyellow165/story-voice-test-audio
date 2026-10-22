import test from 'node:test'
import assert from 'node:assert/strict'
import { modelOptions, resolveModel, modelSettings } from '../server/brick-model-registry.mjs'
import { brickGeneratorStatus, buildDesignRequest, designSchema, buildDesignPrompt } from '../server/brick-generator.mjs'
import { visionStatus, visionPrompt, visionSchema } from '../server/brick-vision.mjs'
import { buildOpenaiVisionRequest } from '../server/brick-vision-openai.mjs'
import { callBrickModel } from '../server/brick-model-call.mjs'
import { loadBrickRules } from '../server/brick-rules.mjs'

test('both task menus use one registry and unknown/task-ineligible models fail closed', () => {
  assert.deepEqual(brickGeneratorStatus().models, visionStatus().models)
  assert.equal(modelOptions('design').length, 6)
  assert.throws(() => resolveModel('unknown', 'design'))
  for (const m of modelOptions('inventory')) {
    assert.equal(resolveModel(m.id, 'design').provider, m.provider)
    if (m.provider === 'openai') assert.throws(() => resolveModel(m.id, 'step'))
  }
})
test('request adapters preserve business prompts, schemas and input inventory', async () => {
  const rules = await loadBrickRules()
  const input = { description: 'test', inventory: [{ part: rules.PARTS[0].id, color: rules.COLORS[0].code, quantity: 2 }] }
  for (const m of modelOptions('design')) {
    const r = buildDesignRequest(m.id, input, rules)
    assert.equal(r.model, m.id)
    if (m.provider === 'gemini') {
      assert.equal(r.config.systemInstruction, buildDesignPrompt(rules, input.inventory))
      assert.deepEqual(r.config.responseSchema, designSchema(rules, input.inventory))
      assert.deepEqual(JSON.parse(r.contents[0].parts[0].text), input)
    } else {
      assert.equal(r.text.format.type, 'json_object')
      assert.ok(r.instructions.startsWith(buildDesignPrompt(rules, input.inventory)))
      assert.ok(r.instructions.endsWith(JSON.stringify(designSchema(rules, input.inventory))))
      assert.match(r.input[0].content[0].text, /JSON object/)
      assert.ok(r.input[0].content[0].text.endsWith(JSON.stringify(input)))
      assert.equal(r.input[0].content.length, 1)
      assert.equal(r.config, undefined)
      assert.deepEqual(r.reasoning, modelSettings(m.id, 'design').reasoning)
      const vision = buildOpenaiVisionRequest({ model: m.id, image: { mimeType: 'image/jpeg', imageBase64: 'test' }, colors: [], prompt: visionPrompt, schema: visionSchema })
      assert.equal(vision.input[0].content[1].image_url, 'data:image/jpeg;base64,test')
      assert.equal(vision.instructions.split('Return a JSON object')[0], visionPrompt + '\n')
    }
  }
})
test('selected registry provider dispatches exactly once, without calling the other adapter', async () => {
  for (const model of modelOptions('design')) {
    const record = {}, calls = []
    await callBrickModel({ model: model.id, task: 'design', request: { model: model.id }, record,
      createClient: () => ({ models: { generateContent: async () => { calls.push('gemini'); return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }] } } } }),
      requestOpenai: async () => { calls.push('openai') },
    })
    assert.deepEqual(calls, [model.provider])
    assert.equal(record.provider, model.provider)
    assert.equal(record.model, model.id)
  }
})
