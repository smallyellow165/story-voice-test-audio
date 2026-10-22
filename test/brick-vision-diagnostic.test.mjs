import test from 'node:test'
import assert from 'node:assert/strict'
import { buildVisionDiagnostic } from '../server/brick-vision-diagnostic.mjs'
import { visionSchema } from '../server/brick-vision.mjs'

const source = () => ({ mode: 'inventory', request: { model: 'same-record-model',
  contents: [{ role: 'user', parts: [{ text: 'original input' }, { inlineData: { mimeType: 'image/jpeg', data: 'source-image' } }] }],
  config: { systemInstruction: 'original instruction', responseMimeType: 'application/json', responseSchema: visionSchema,
    maxOutputTokens: 32768, thinkingConfig: { thinkingLevel: 'MEDIUM' },
    httpOptions: { timeout: 180000, retryOptions: { attempts: 1 } } } } })

test('diagnostic stages preserve source and change only the intended configuration', () => {
  const record = source(), before = structuredClone(record)
  for (const stage of ['json', 'schema', 'budget', 'full', 'inventory-schema']) {
    const request = buildVisionDiagnostic(record, stage)
    assert.equal(request.model, record.request.model)
    assert.deepEqual(request.contents, record.request.contents)
    assert.equal(request.config.systemInstruction, record.request.config.systemInstruction)
    assert.deepEqual(request.config.httpOptions, record.request.config.httpOptions)
  }
  assert.deepEqual(record, before)
  assert.deepEqual(buildVisionDiagnostic(record, 'full'), record.request)
  assert.deepEqual(Object.keys(buildVisionDiagnostic(record, 'json').config.responseSchema.properties), ['description'])
  assert.deepEqual(buildVisionDiagnostic(record, 'schema').config.responseSchema, visionSchema)
  const budget = buildVisionDiagnostic(record, 'budget')
  assert.equal(budget.config.maxOutputTokens, 32768)
  assert.equal(budget.config.thinkingConfig, undefined)
  const inventory = buildVisionDiagnostic(record, 'inventory-schema')
  assert.deepEqual(inventory.config.responseSchema.properties.observations, visionSchema.properties.observations)
  assert.deepEqual(Object.keys(inventory.config.responseSchema.properties), ['observations'])
  inventory.config.responseSchema = record.request.config.responseSchema
  assert.deepEqual(inventory, record.request)
})

test('minimal image contains only the same model, original JPEG and requested sentence', () => {
  const record = source()
  const data = Buffer.from([255, 216, 255, 224, 255, 217]).toString('base64')
  record.request.contents[0].parts[1].inlineData.data = data
  const before = structuredClone(record)
  assert.deepEqual(buildVisionDiagnostic(record, 'image'), { model: record.request.model,
    contents: [{ inlineData: { mimeType: 'image/jpeg', data } },
      { text: '请描述图片中的积木，包括数量、颜色和形状。' }] })
  assert.deepEqual(record, before)
  delete record.request.config
  assert.equal(buildVisionDiagnostic(record, 'image').config, undefined)
  record.request.contents[0].parts[1].inlineData.data = `data:image/jpeg;base64,${data}`
  assert.throws(() => buildVisionDiagnostic(record, 'image'), /Base64/)
  record.request.contents[0].parts[1].inlineData.data = Buffer.from('not jpeg').toString('base64')
  assert.throws(() => buildVisionDiagnostic(record, 'image'), /JPEG/)
  record.request.contents[0].parts[1].inlineData = { mimeType: 'image/png', data }
  assert.throws(() => buildVisionDiagnostic(record, 'image'), /JPEG/)
})

test('invalid stages, missing images, wrong mode and retries are rejected', () => {
  assert.throws(() => buildVisionDiagnostic(source(), 'all'))
  assert.throws(() => buildVisionDiagnostic({ request: {} }, 'image'))
  assert.throws(() => buildVisionDiagnostic({ ...source(), mode: 'step' }, 'inventory-schema'))
  const record = source()
  record.request.config.httpOptions.retryOptions.attempts = 2
  assert.throws(() => buildVisionDiagnostic(record, 'full'))
})
