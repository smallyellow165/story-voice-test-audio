import test from 'node:test'
import assert from 'node:assert/strict'
import { parseExplorerScene, resolveSceneHistory, selectSceneModel, buildExplorerSceneLink } from '../src/brick-inventory/explorer-scene.mjs'

const id = '0474c775-ae2f-40d7-87d2-dd0e2b4ee3fa'
const base = 'http://localhost:5173/story-voice-test-audio/brick-inventory.html'
const models = [{ provider: 'gemini', id: 'gemini-default' }, { provider: 'openai', id: 'openai-default' }, { provider: 'openai', id: 'openai-other' }]

test('parses independent strategy, image, model and record parameters', () => {
  const scene = parseExplorerScene(base + '?strategy=assembled&imageSource=server&image=camel.jpg&provider=openai&model=openai-other&analysisId=' + id)
  assert.deepEqual(scene, { strategy: 'geometry_only', imageSource: 'server_library', image: 'camel.jpg',
    provider: 'openai', model: 'openai-other', analysisId: id, warnings: [] })
})

test('invalid fields do not erase other valid fields or allow prototype/path values', () => {
  const scene = parseExplorerScene(base + '?strategy=constructor&imageSource=toString&image=..%2Fsecret.png&analysisId=bad&model=openai-other')
  assert.equal(scene.strategy, undefined)
  assert.equal(scene.imageSource, undefined)
  assert.equal(scene.image, undefined)
  assert.equal(scene.analysisId, undefined)
  assert.equal(scene.model, 'openai-other')
  assert.equal(scene.warnings.length, 4)
})

test('upload cannot encode local file access and missing params retain defaults', () => {
  const scene = parseExplorerScene(base + '?imageSource=upload&image=camel.jpg')
  assert.ok(scene.warnings.some(w => w.includes('Upload')))
  assert.equal(scene.analysisId, undefined)
  assert.deepEqual(parseExplorerScene(base).warnings, [])
})

test('history type determines strategy only when strategy was not provided', () => {
  const scene = parseExplorerScene(base + '?analysisId=' + id)
  assert.deepEqual(resolveSceneHistory(scene, [], [{ id, analysis_mode: 'geometry_only' }]), { strategy: 'geometry_only', analysisId: id, warning: '' })
  assert.equal(resolveSceneHistory(scene, [{ id }], []).strategy, 'loose')
})

test('cross-strategy and ambiguous records never produce an auto-load ID', () => {
  const scene = parseExplorerScene(base + '?strategy=loose&analysisId=' + id)
  assert.equal(resolveSceneHistory(scene, [], [{ id, analysis_mode: 'geometry_only' }]).analysisId, undefined)
  assert.match(resolveSceneHistory(scene, [], [{ id, analysis_mode: 'geometry_only' }]).warning, /不兼容/)
  assert.equal(resolveSceneHistory(scene, [{ id }], [{ id, analysis_mode: 'geometry_only' }]).analysisId, undefined)
  assert.equal(resolveSceneHistory(scene, [], []).analysisId, undefined)
})

test('URL model wins over valid persisted/default selection without changing that input', () => {
  const persisted = 'gemini-default'
  assert.equal(selectSceneModel(models, persisted, { provider: 'openai', model: 'openai-other' }).id, 'openai-other')
  assert.equal(selectSceneModel(models, persisted, { provider: 'openai' }).id, 'openai-default')
  assert.equal(selectSceneModel(models, persisted, { provider: 'openai-other' }).id, 'openai-other')
  assert.equal(selectSceneModel(models, persisted).id, persisted)
  assert.equal(persisted, 'gemini-default')
})

test('unavailable model falls back; invalid provider does not erase a valid independent model', () => {
  assert.equal(selectSceneModel(models, 'gemini-default', { model: 'retired' }).id, 'gemini-default')
  assert.ok(selectSceneModel(models, 'gemini-default', { model: 'retired' }).warning)
  assert.equal(selectSceneModel(models, 'gemini-default', { provider: 'bad', model: 'openai-other' }).id, 'openai-other')
})

test('copy keeps base path and unrelated params while replacing managed values', () => {
  const href = buildExplorerSceneLink(base + '?other=keep&strategy=loose&image=old.jpg&token=secret#section', {
    strategy: 'geometry_only', imageSource: 'server_library', image: 'camel.jpg', provider: 'openai', model: 'openai-other', analysisId: id,
  })
  const url = new URL(href)
  assert.equal(url.pathname, '/story-voice-test-audio/brick-inventory.html')
  assert.equal(url.hash, '#section')
  assert.equal(url.searchParams.get('other'), 'keep')
  assert.equal(url.searchParams.has('token'), false)
  const roundTrip = parseExplorerScene(href)
  assert.equal(roundTrip.strategy, 'geometry_only')
  assert.equal(roundTrip.image, 'camel.jpg')
  assert.equal(roundTrip.analysisId, id)
})

test('a control-only scene omits an unloaded history ID and local upload filename', () => {
  const url = new URL(buildExplorerSceneLink(base + '?analysisId=' + id + '&image=old.jpg', {
    strategy: 'loose', imageSource: 'upload', image: 'local.jpg', model: 'gemini-default', provider: 'gemini',
  }))
  assert.equal(url.searchParams.has('analysisId'), false)
  assert.equal(url.searchParams.has('image'), false)
})
