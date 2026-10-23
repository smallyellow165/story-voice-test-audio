import test from 'node:test'
import assert from 'node:assert/strict'
import { observeCatalogImage } from '../src/catalog-photo-load.ts'

// Small DOM-boundary fixture: no API, download, React renderer or shared cache.
class ImageFixture extends EventTarget {
  complete = false
  naturalWidth = 0
  decode() { this.complete = true; this.naturalWidth = 120 }
  load() { this.decode(); this.dispatchEvent(new Event('load')) }
  fail() { this.complete = true; this.dispatchEvent(new Event('error')) }
}
function fixture(image = new ImageFixture()) {
  const states = []
  const pending = new Set()
  const queued = []
  const clock = {
    setTimeout(fn, delay) {
      assert.equal(delay, 20000)
      pending.add(fn); queued.push(fn); return fn
    },
    clearTimeout(fn) { pending.delete(fn) },
  }
  const dispose = observeCatalogImage(image, state => states.push(state), clock)
  return { image, states, pending, queued, dispose }
}

test('first uncached load succeeds and cancels timeout', () => {
  const f = fixture()
  assert.deepEqual(f.states, ['loading'])
  f.image.load()
  assert.deepEqual(f.states, ['loading', 'loaded'])
  assert.equal(f.pending.size, 0)
  f.dispose()
})

test('second and third searches remount the same cached URL without needing load events', () => {
  const first = fixture()
  first.image.load(); first.dispose()
  for (let search = 2; search <= 3; search++) {
    const image = new ImageFixture()
    image.decode() // Browser memory cache completed before observer attachment.
    const f = fixture(image)
    assert.deepEqual(f.states, ['loading', 'loaded'])
    assert.equal(f.pending.size, 0)
    f.dispose()
  }
})

test('reusing a mounted image across metadata refresh or hidden tabs stays loaded', () => {
  const f = fixture()
  f.image.load()
  // Same URL does not recreate the observer; even a previously queued timer
  // cannot undo success after refreshed metadata or tab visibility changes.
  f.queued[0]()
  assert.deepEqual(f.states, ['loading', 'loaded'])
  f.dispose()
})

test('pagination remount and Strict Mode effect replay inspect cached completion', () => {
  const image = new ImageFixture()
  const previous = fixture(image)
  previous.dispose()
  image.decode()
  const next = fixture(image)
  previous.queued[0]()
  assert.deepEqual(previous.states, ['loading'])
  assert.deepEqual(next.states, ['loading', 'loaded'])
  next.dispose()
})

test('timeout observes decoded image even before load event is delivered', () => {
  const f = fixture()
  f.image.decode()
  f.queued[0]()
  f.image.dispatchEvent(new Event('load'))
  assert.deepEqual(f.states, ['loading', 'loaded'])
  f.dispose()
})

test('real load errors and cached broken images report failure', () => {
  const f = fixture()
  f.image.fail()
  assert.deepEqual(f.states, ['loading', 'failed'])
  assert.equal(f.pending.size, 0)
  f.dispose()
  const image = new ImageFixture()
  image.complete = true // complete alone also includes failed images.
  const broken = fixture(image)
  assert.deepEqual(broken.states, ['loading', 'failed'])
  broken.dispose()
})

test('a stalled image fails once; late events cannot override terminal state', () => {
  const f = fixture()
  f.queued[0]()
  f.image.load()
  assert.deepEqual(f.states, ['loading', 'failed'])
  f.dispose()
})

test('URL replacement/unmount cancels old events and queued timeout callbacks', () => {
  const old = fixture()
  old.dispose()
  const next = fixture()
  old.image.fail(); old.image.load(); old.queued[0]()
  assert.deepEqual(old.states, ['loading'])
  assert.deepEqual(next.states, ['loading'])
  next.image.load()
  assert.deepEqual(next.states, ['loading', 'loaded'])
  next.dispose()
})

test('explicit retry starts a fresh observer without changing URL parameters', () => {
  const failed = fixture()
  failed.image.fail(); failed.dispose()
  const retry = fixture()
  retry.image.load()
  assert.deepEqual(retry.states, ['loading', 'loaded'])
  retry.dispose()
})
