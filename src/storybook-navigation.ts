/** Navigation only: opaque Story/section references, no narration or media fields. */
export type PageReference = { storyId: string; sectionId: string; pageNumber: number }
export type MarkerMapping = Record<string, PageReference>
export type NavigationConfig = { confirmAfterMs: number; lostAfterMs: number }
export const DEFAULT_NAVIGATION_CONFIG: NavigationConfig = { confirmAfterMs: 300, lostAfterMs: 800 }
export function loadMarkerMapping(value: unknown): MarkerMapping {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid marker mapping')
  const mapping: MarkerMapping = {}
  for (const [marker, ref] of Object.entries(value)) {
    if (!/^(0|[1-9]\d*)$/.test(marker) || !Number.isSafeInteger(Number(marker)) || !ref
      || typeof ref.storyId !== 'string' || !ref.storyId.trim() || typeof ref.sectionId !== 'string' || !ref.sectionId.trim()
      || !Number.isInteger(ref.pageNumber) || ref.pageNumber < 1) throw new Error('Invalid marker reference')
    mapping[marker] = { storyId: ref.storyId, sectionId: ref.sectionId, pageNumber: ref.pageNumber }
  }
  return mapping
}
const same = (a: PageReference | null, b: PageReference | null) => !!a && !!b && a.storyId === b.storyId && a.sectionId === b.sectionId && a.pageNumber === b.pageNumber
export function createMarkerNavigation(input: MarkerMapping, config: NavigationConfig = DEFAULT_NAVIGATION_CONFIG) {
  const mapping = loadMarkerMapping(input), settings = { ...config }
  if (![settings.confirmAfterMs, settings.lostAfterMs].every(n => Number.isFinite(n) && n >= 0)) throw new Error('Invalid navigation timing')
  let currentPage: PageReference | null = null, candidatePage: PageReference | null = null
  let candidateSince = 0, lastSeen = -Infinity, lastTime = -Infinity, pageChangeCount = 0
  let stableDetection = false, markerIds: number[] = []
  function read() {
    return { markerIds: [...markerIds], markerId: markerIds.length === 1 ? markerIds[0]! : null,
      candidatePage: candidatePage ? { ...candidatePage } : null, currentPage: currentPage ? { ...currentPage } : null,
      currentSection: currentPage?.sectionId ?? null, stableDetection, pageChangeCount, ...settings }
  }
  return {
    read,
    update(detectedMarkerIds: readonly number[], nowMs: number) {
      if (!Number.isFinite(nowMs) || nowMs < lastTime) throw new Error('Use monotonic timestamps')
      if (!detectedMarkerIds.every(id => Number.isSafeInteger(id) && id >= 0)) throw new Error('Invalid marker ID')
      lastTime = nowMs; markerIds = [...new Set(detectedMarkerIds)]
      // Multiple distinct markers are ambiguous for V1; no arbitrary page selection.
      const page = markerIds.length === 1 ? mapping[String(markerIds[0])] ?? null : null
      let transition: PageReference | null = null
      if (same(page, currentPage)) {
        lastSeen = nowMs; stableDetection = true; candidatePage = null
      } else if (page) {
        if (!same(page, candidatePage)) { candidatePage = page; candidateSince = nowMs }
        if (nowMs - candidateSince >= settings.confirmAfterMs) {
          currentPage = page; candidatePage = null; lastSeen = nowMs; stableDetection = true
          pageChangeCount++; transition = { ...page }
        }
      } else candidatePage = null
      if (nowMs - lastSeen >= settings.lostAfterMs && !same(page, currentPage)) stableDetection = false
      return { ...read(), transition }
    },
    reset() {
      currentPage = candidatePage = null; candidateSince = 0; lastSeen = lastTime = -Infinity
      pageChangeCount = 0; stableDetection = false; markerIds = []; return read()
    },
  }
}
