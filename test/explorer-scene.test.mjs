import test from 'node:test'
import assert from 'node:assert/strict'
import { parseExplorerScene, resolveSceneHistory, selectSceneModel, buildExplorerSceneLink, replaceExplorerScene } from '../src/brick-inventory/explorer-scene.mjs'

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


function browserAt(href) {
  const calls = []
  const browser = { location: { href }, history: { state: { existing: 'router-state' },
    replaceState(state, title, url) { calls.push({ state, title, url }); browser.location.href = url },
    pushState() { throw new Error('Scene updates must not add history entries') },
  } }
  return { browser, calls }
}

test('initial defaults and inactive panels cannot overwrite URL before restore is settled', () => {
  const href = base + '?strategy=assembled&image=camel.jpg&analysisId=' + id
  const { browser, calls } = browserAt(href)
  assert.equal(replaceExplorerScene(browser, { strategy: 'loose' }, false), false)
  assert.equal(browser.location.href, href)
  assert.equal(calls.length, 0)
  replaceExplorerScene(browser, { strategy: 'geometry_only', imageSource: 'server_library', image: 'camel.jpg', analysisId: id }, true)
  assert.equal(parseExplorerScene(browser.location.href).analysisId, id)
  replaceExplorerScene(browser, { strategy: 'loose' }, false)
  assert.equal(parseExplorerScene(browser.location.href).strategy, 'geometry_only')
})

test('replace preserves pathname, hash, unrelated parameters and browser history state; identical snapshots are no-ops', () => {
  const { browser, calls } = browserAt(base + '?theme=dark#review')
  const scene = { strategy: 'loose', imageSource: 'server_library', image: 'parts.jpg', provider: 'openai', model: 'openai-other' }
  assert.equal(replaceExplorerScene(browser, scene, true), true)
  const url = new URL(browser.location.href)
  assert.equal(url.pathname, new URL(base).pathname)
  assert.equal(url.hash, '#review')
  assert.equal(url.searchParams.get('theme'), 'dark')
  assert.equal(calls[0].state, browser.history.state)
  assert.equal(replaceExplorerScene(browser, { ...scene }, true), false)
  assert.equal(calls.length, 1)
  assert.equal(buildExplorerSceneLink(browser.location.href, scene), browser.location.href)
})

test('loaded record changes and clearing a result replace or remove analysisId without encoding draft fields', () => {
  const { browser } = browserAt(base)
  const loaded = { strategy: 'geometry_only', analysisId: id }
  replaceExplorerScene(browser, loaded, true)
  // A dropdown selection is not a loaded record and never enters the scene snapshot.
  const selectedHistoryId = '11111111-1111-1111-1111-111111111111'
  assert.equal(replaceExplorerScene(browser, loaded, true), false)
  assert.equal(parseExplorerScene(browser.location.href).analysisId, id)
  replaceExplorerScene(browser, { ...loaded, analysisId: selectedHistoryId }, true)
  assert.equal(parseExplorerScene(browser.location.href).analysisId, selectedHistoryId)
  replaceExplorerScene(browser, { strategy: 'loose', imageSource: 'upload', image: 'private.jpg', analysisId: undefined }, true)
  const params = new URL(browser.location.href).searchParams
  assert.equal(params.has('analysisId'), false)
  assert.equal(params.has('image'), false)
})

test('rapid complete snapshots end at latest controls and do not retain previous model or image', () => {
  const { browser } = browserAt(base)
  replaceExplorerScene(browser, { strategy: 'loose', imageSource: 'server_library', image: 'a.jpg', provider: 'openai', model: 'openai-other' }, true)
  replaceExplorerScene(browser, { strategy: 'geometry_only', imageSource: 'server_library', image: 'b.png', provider: 'gemini', model: 'gemini-default' }, true)
  replaceExplorerScene(browser, { strategy: 'geometry_only', imageSource: 'upload' }, true)
  const scene = parseExplorerScene(browser.location.href)
  assert.equal(scene.strategy, 'geometry_only')
  assert.equal(scene.imageSource, 'upload')
  assert.equal(scene.image, undefined)
  assert.equal(scene.model, undefined)
  assert.equal(scene.provider, undefined)
})
