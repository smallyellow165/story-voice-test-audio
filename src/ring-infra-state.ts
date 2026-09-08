import type { FootRingState } from './ring-feet-state'

export type RingInfraFacts = {
  ringNames?: Record<string, string>
  ringIds: string[]
  leftFootRingId: string | null
  rightFootRingId: string | null
  leftFootStatus: FootRingState['status']
  rightFootStatus: FootRingState['status']
}
export function createRingFacts() {
let current: RingInfraFacts = { ringIds: [], leftFootRingId: null, rightFootRingId: null,
  leftFootStatus: 'UNKNOWN', rightFootStatus: 'UNKNOWN' }
const listeners = new Set<(facts: RingInfraFacts) => void>()
function publishRingFacts(facts: RingInfraFacts) {
  current = structuredClone(facts)
  listeners.forEach(listener => listener(structuredClone(current)))
}
function subscribeRingFacts(listener: (facts: RingInfraFacts) => void) {
  listeners.add(listener)
  listener(structuredClone(current))
  return () => { listeners.delete(listener) }
}

return { publishRingFacts, subscribeRingFacts }
}
export const { publishRingFacts, subscribeRingFacts } = createRingFacts()
