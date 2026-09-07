import type { RingInfraFacts } from '../ring-infra-state.ts'
export type Condition = { type: 'footInRing'; foot: 'left' | 'right'; ring: string }
  | { type: 'all'; conditions: Condition[] } | { type: 'feetInDifferentRings' }
export type GameDefinition = { id: string; name: string; ringSlots: string[];
  tasks: { id: string; description: string; condition: Condition }[] }
export function parseGame(value: unknown): GameDefinition {
  const g = value as GameDefinition
  const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0
  function valid(c: Condition, depth = 0): boolean {
    if (!c || depth > 10) return false
    if (c.type === 'footInRing') return ['left', 'right'].includes(c.foot) && g.ringSlots.includes(c.ring)
    if (c.type === 'all') return Array.isArray(c.conditions) && c.conditions.length > 0 && c.conditions.every(v => valid(v, depth + 1))
    return c.type === 'feetInDifferentRings'
  }
  if (!g || !text(g.id) || !text(g.name) || !Array.isArray(g.ringSlots) || !g.ringSlots.every(text)
    || new Set(g.ringSlots).size !== g.ringSlots.length || !Array.isArray(g.tasks) || !g.tasks.length
    || !g.tasks.every(t => t && text(t.id) && text(t.description) && valid(t.condition))
    || new Set(g.tasks.map(t => t.id)).size !== g.tasks.length) throw new Error('Invalid game definition')
  return g
}
export function evaluate(condition: Condition, facts: RingInfraFacts, bindings: Record<string, string>): 'NOT_YET' | 'SUCCESS' {
  const inside = (foot: 'left' | 'right') => facts[`${foot}FootStatus`] === 'IN'
    && facts[`${foot}FootRingId`] !== null && facts.ringIds.includes(facts[`${foot}FootRingId`]!)
  let success: boolean
  switch (condition.type) {
    case 'footInRing': success = inside(condition.foot) && !!bindings[condition.ring]
      && facts[`${condition.foot}FootRingId`] === bindings[condition.ring]; break
    case 'all': success = condition.conditions.every(c => evaluate(c, facts, bindings) === 'SUCCESS'); break
    case 'feetInDifferentRings': success = inside('left') && inside('right') && facts.leftFootRingId !== facts.rightFootRingId; break
  }
  return success ? 'SUCCESS' : 'NOT_YET'
}
export function createGameRuntime(definition: GameDefinition) {
  let index = 0
  return {
    reset() { index = 0 },
    next() { index = Math.min(index + 1, definition.tasks.length - 1) },
    read(facts: RingInfraFacts, bindings: Record<string, string>) {
      const task = definition.tasks[index]!
      return { gameId: definition.id, task, index, total: definition.tasks.length,
        result: evaluate(task.condition, facts, bindings) }
    },
  }
}
