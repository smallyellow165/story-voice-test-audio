import type { FootRingState } from './ring-feet-state'

export type RingInfraFacts = {
  ringNames?: Record<string, string>
  ringIds: string[]
  leftFootRingId: string | null
  rightFootRingId: string | null
  leftFootStatus: FootRingState['status']
  rightFootStatus: FootRingState['status']
}
let current: RingInfraFacts = { ringIds: [], leftFootRingId: null, rightFootRingId: null,
  leftFootStatus: 'UNKNOWN', rightFootStatus: 'UNKNOWN' }
const listeners = new Set<(facts: RingInfraFacts) => void>()
export function publishRingFacts(facts: RingInfraFacts) {
  current = structuredClone(facts)
  listeners.forEach(listener => listener(structuredClone(current)))
}
export function subscribeRingFacts(listener: (facts: RingInfraFacts) => void) {
  listeners.add(listener)
  listener(structuredClone(current))
  return () => { listeners.delete(listener) }
}
