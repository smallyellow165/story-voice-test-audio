/** Pure game state. Positions are parent-confirmed logical cells, never detections. */
export type HopscotchCell = Readonly<{
  id: string; label: string; level: number; lane: 'left' | 'center' | 'right'
}>
export type HopscotchBoard = Readonly<{ initialCell: string; cells: readonly HopscotchCell[] }>
export type HopscotchConfig = Readonly<{ maxJumpSteps: 1 | 2; allowBackward: boolean }>
export type HopscotchHistoryEntry = { from: string; target: string; outcome: 'DONE' | 'SKIP' }

export const CLASSIC_BOARD: HopscotchBoard = Object.freeze({
  initialCell: '1',
  cells: Object.freeze([
    { id: '1', label: '1', level: 0, lane: 'center' },
    { id: '2', label: '2', level: 1, lane: 'left' },
    { id: '3', label: '3', level: 1, lane: 'right' },
    { id: '4', label: '4', level: 2, lane: 'center' },
    { id: '5', label: '5', level: 3, lane: 'left' },
    { id: '6', label: '6', level: 3, lane: 'right' },
    { id: '7', label: '7', level: 4, lane: 'center' },
    { id: '8', label: '8', level: 5, lane: 'left' },
    { id: '9', label: '9', level: 5, lane: 'right' },
    { id: '10', label: '10', level: 6, lane: 'center' },
  ].map(cell => Object.freeze(cell as HopscotchCell))),
})
export const DEFAULT_CONFIG: HopscotchConfig = Object.freeze({ maxJumpSteps: 1, allowBackward: true })

function validateConfig(config: HopscotchConfig) {
  if (![1, 2].includes(config.maxJumpSteps) || typeof config.allowBackward !== 'boolean') throw new Error('Invalid jump config')
}

export function getLegalTargets(board: HopscotchBoard, currentCell: string, config: HopscotchConfig): string[] {
  validateConfig(config)
  const current = board.cells.find(cell => cell.id === currentCell)
  if (!current) throw new Error('Unknown current cell')
  return board.cells.filter(cell => {
    const delta = cell.level - current.level
    return cell.id !== currentCell && Math.abs(delta) >= 1 && Math.abs(delta) <= config.maxJumpSteps
      && (config.allowBackward || delta > 0)
  }).map(cell => cell.id)
}

export function createHopscotch(options: { board?: HopscotchBoard; config?: HopscotchConfig; random?: () => number } = {}) {
  const board = structuredClone(options.board ?? CLASSIC_BOARD)
  if (!board.cells.length || new Set(board.cells.map(cell => cell.id)).size !== board.cells.length
    || !board.cells.some(cell => cell.id === board.initialCell)
    || board.cells.some(cell => !cell.id || !cell.label || !Number.isInteger(cell.level)
      || !['left', 'center', 'right'].includes(cell.lane))) throw new Error('Invalid board')
  let config = { ...(options.config ?? DEFAULT_CONFIG) }
  validateConfig(config)
  const random = options.random ?? Math.random
  let currentCell = board.initialCell
  let targetCell: string | null = null
  let previousTarget: string | null = null
  let history: HopscotchHistoryEntry[] = []
  const legalTargets = () => getLegalTargets(board, currentCell, config)
  function chooseTarget() {
    const legal = legalTargets()
    const alternatives = legal.filter(id => id !== previousTarget)
    const candidates = alternatives.length ? alternatives : legal
    targetCell = candidates.length === 0 ? null : candidates.length === 1 ? candidates[0]! : candidates[Math.floor(random() * candidates.length)]!
    if (targetCell !== null) previousTarget = targetCell
  }
  function read() {
    const target = board.cells.find(cell => cell.id === targetCell)
    return {
      currentCell, targetCell, legalTargets: legalTargets(), config: { ...config },
      task: target ? { action: 'jump_to' as const, target: target.id, text: `跳到 ${target.label}` } : null,
      completedCount: history.filter(entry => entry.outcome === 'DONE').length,
      skippedCount: history.filter(entry => entry.outcome === 'SKIP').length,
      history: history.map(entry => ({ ...entry })),
    }
  }
  function act(outcome: HopscotchHistoryEntry['outcome']) {
    if (targetCell === null) return read()
    history.push({ from: currentCell, target: targetCell, outcome })
    if (outcome === 'DONE') currentCell = targetCell
    chooseTarget()
    return read()
  }
  chooseTarget()
  return {
    read,
    done: () => act('DONE'),
    skip: () => act('SKIP'),
    repeat: read, // No event/history/progression mutation; presentation may emphasize the task.
    reset() {
      currentCell = board.initialCell; targetCell = previousTarget = null; history = []
      chooseTarget()
      return read()
    },
    setConfig(next: HopscotchConfig) {
      validateConfig(next)
      config = { ...next }
      // Keep a still-legal instruction; never retain an invalid target after a config change.
      if (targetCell === null || !legalTargets().includes(targetCell)) chooseTarget()
      return read()
    },
  }
}
