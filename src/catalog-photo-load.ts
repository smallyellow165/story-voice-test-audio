export type CatalogImageState = 'loading' | 'loaded' | 'failed'

type ImageElement = Pick<HTMLImageElement,
  'complete' | 'naturalWidth' | 'addEventListener' | 'removeEventListener'>
type Clock = {
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void
}

// Tracks one mounted image, not a cache. The browser remains responsible for
// fetching/reusing bytes; callers dispose this observer on URL change/unmount.
export function observeCatalogImage(
  image: ImageElement,
  onState: (state: CatalogImageState) => void,
  clock: Clock = {
    // Native browser timers require the Window receiver, not this clock object.
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: timer => globalThis.clearTimeout(timer),
  },
): () => void {
  let active = true
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const clearTimer = () => {
    if (timer !== undefined) clock.clearTimeout(timer)
    timer = undefined
  }
  const settle = (state: 'loaded' | 'failed') => {
    if (!active || settled) return
    settled = true
    clearTimer()
    onState(state)
  }
  const inspect = () => {
    if (image.complete) settle(image.naturalWidth > 0 ? 'loaded' : 'failed')
  }
  const onLoad = () => settle(image.naturalWidth > 0 ? 'loaded' : 'failed')
  const onError = () => settle('failed')
  image.addEventListener('load', onLoad)
  image.addEventListener('error', onError)
  onState('loading')
  inspect()
  if (!settled) {
    timer = clock.setTimeout(() => {
      // Completion can precede delivery of the load event. A queued timeout
      // must not turn an already decoded cached image into a failure.
      inspect()
      if (!settled) settle('failed')
    }, 20000)
  }
  return () => {
    active = false
    clearTimer()
    image.removeEventListener('load', onLoad)
    image.removeEventListener('error', onError)
  }
}
