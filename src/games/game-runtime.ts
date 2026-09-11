import type { RingInfraFacts } from '../ring-infra-state.ts'
export type ColorTarget = 'red' | 'blue' | 'yellow'
export type GameFacts = RingInfraFacts | { selectedTargets: readonly ColorTarget[] } | { confirmed: boolean }
export type Condition = { type: 'footInRing'; foot: 'left' | 'right'; ring: string }
  | { type: 'manual' }
  | { type: 'selectSequence'; targets: ColorTarget[] }
  | { type: 'all'; conditions: Condition[] } | { type: 'feetInDifferentRings' }
export type GameDefinition = { id: string; name: string; ringSlots: string[];
  tasks: { id: string; description: string; condition: Condition }[] }
export function parseGame(value: unknown): GameDefinition {
  const g = value as GameDefinition
  const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0
  function valid(c: Condition, depth = 0): boolean {
    if (!c || depth > 10) return false
    if (c.type === 'manual') return depth === 0
    if (c.type === 'footInRing') return ['left', 'right'].includes(c.foot) && g.ringSlots.includes(c.ring)
    if (c.type === 'selectSequence') return depth === 0 && Array.isArray(c.targets) && c.targets.length > 0 && c.targets.length <= 8 && c.targets.every(t => ['red', 'blue', 'yellow'].includes(t))
    if (c.type === 'all') return Array.isArray(c.conditions) && c.conditions.length > 0 && c.conditions.every(v => valid(v, depth + 1))
    return c.type === 'feetInDifferentRings'
  }
  if (!g || !text(g.id) || !text(g.name) || !Array.isArray(g.ringSlots) || !g.ringSlots.every(text)
    || new Set(g.ringSlots).size !== g.ringSlots.length || !Array.isArray(g.tasks) || !g.tasks.length
    || !g.tasks.every(t => t && text(t.id) && text(t.description) && valid(t.condition))
    || new Set(g.tasks.map(t => t.id)).size !== g.tasks.length) throw new Error('Invalid game definition')
  return g
}
export function evaluate(condition: Condition, facts: GameFacts, bindings: Record<string, string>): 'NOT_YET' | 'SUCCESS' {
  if (condition.type === 'manual') return 'confirmed' in facts && facts.confirmed ? 'SUCCESS' : 'NOT_YET'
  if (condition.type === 'selectSequence') return 'selectedTargets' in facts && condition.targets.length === facts.selectedTargets.length && condition.targets.every((t, i) => t === facts.selectedTargets[i]) ? 'SUCCESS' : 'NOT_YET'
  if (!('ringIds' in facts)) return 'NOT_YET'
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
  let confirmed = false
  let selected: ColorTarget[] = []
  return {
    reset() { index = 0; selected = []; confirmed = false },
    next() { index = Math.min(index + 1, definition.tasks.length - 1); selected = []; confirmed = false },
    restore(position: number, targets: ColorTarget[] = []) {
      if (!Number.isInteger(position) || position < 0 || position >= definition.tasks.length) throw new Error('invalid_task_index')
      const condition = definition.tasks[position]!.condition
      if (targets.length && (condition.type !== 'selectSequence' || targets.length > condition.targets.length
        || targets.some((target, i) => target !== condition.targets[i]))) throw new Error('invalid_selection')
      index = position; selected = [...targets]; confirmed = false
    },
    confirm() { if (definition.tasks[index]!.condition.type === 'manual') confirmed = true },
    // A discrete target selection can later come from a zone/feet input adapter.
    select(target: ColorTarget) {
      const condition = definition.tasks[index]!.condition
      if (condition.type !== 'selectSequence' || selected.length === condition.targets.length) return
      if (target === condition.targets[selected.length]) selected.push(target)
      else selected = target === condition.targets[0] ? [target] : []
    },
    read(facts: GameFacts = { selectedTargets: [] }, bindings: Record<string, string> = {}) {
      const task = definition.tasks[index]!
      return { gameId: definition.id, task, index, total: definition.tasks.length,
        selectedTargets: [...selected],
        result: evaluate(task.condition, task.condition.type === 'manual' ? { confirmed } : task.condition.type === 'selectSequence' ? { selectedTargets: selected } : facts, bindings) }
    },
  }
}
