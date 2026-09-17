/** Pure game state. Positions are parent-confirmed logical cells, never detections. */
export type HopscotchColor = 'red' | 'yellow' | 'blue' | 'green' | 'orange'
export const HOPSCOTCH_COLOR_LABELS: Readonly<Record<HopscotchColor, string>> = Object.freeze({
  red: '红色', yellow: '黄色', blue: '蓝色', green: '绿色', orange: '橙色',
})
export type InstructionMode = 'number' | 'color' | 'mixed'
export type PresentationKind = Exclude<InstructionMode, 'mixed'>
export type HopscotchCell = Readonly<{
  id: string; label: string; level: number; lane: 'left' | 'center' | 'right'; color?: HopscotchColor
}>
export type HopscotchBoard = Readonly<{ initialCell: string; cells: readonly HopscotchCell[] }>
export type HopscotchConfig = Readonly<{ maxJumpSteps: 1 | 2; allowBackward: boolean }>
export type HopscotchTask = Readonly<{
  id: string; type: 'jump_to' | 'jump_to_and_clap' | 'jump_to_and_turn'; target: string
}>
export type HopscotchScript = Readonly<{ id: string; title: string; tasks: readonly HopscotchTask[] }>
export type HopscotchMode = 'random' | 'script'
export type HopscotchHistoryEntry = {
  from: string; target: string; outcome: 'DONE' | 'SKIP';
  taskId: string; type: HopscotchTask['type']; plannedTarget: string
}

export function formatHopscotchTask(task: HopscotchTask, board: HopscotchBoard, kind: PresentationKind = 'number'): string {
  const cell = board.cells.find(cell => cell.id === task.target)
  const destination = kind === 'color' && cell?.color ? HOPSCOTCH_COLOR_LABELS[cell.color] : ` ${cell?.label ?? task.target}`
  const suffix = { jump_to: '', jump_to_and_clap: '，然后拍拍手', jump_to_and_turn: '，然后转一圈' }
  return `跳到${destination}${suffix[task.type]}`
}

/** Deterministic presentation safety check; caller stores Mixed's requested kind per task. */
export function presentHopscotchTask(task: HopscotchTask, board: HopscotchBoard, legalTargets: readonly string[], requestedKind: PresentationKind) {
  const targetColor = board.cells.find(cell => cell.id === task.target)?.color ?? null
  const matches = board.cells.filter(cell => legalTargets.includes(cell.id) && cell.color === targetColor).length
  const presentationFallbackReason = requestedKind !== 'color' ? null
    : !targetColor ? 'missing_color' as const : matches !== 1 ? 'ambiguous_color' as const : null
  const presentationKind = presentationFallbackReason ? 'number' : requestedKind
  return { targetColor, presentationKind, presentationFallbackReason,
    displayText: formatHopscotchTask(task, board, presentationKind) }
}

function validateInstructionMode(mode: InstructionMode) {
  if (!['number', 'color', 'mixed'].includes(mode)) throw new Error('Invalid instruction mode')
}

function copyScript(script: HopscotchScript): HopscotchScript {
  if (!script.id || !script.title || !Array.isArray(script.tasks) || !script.tasks.length
    || new Set(script.tasks.map(task => task.id)).size !== script.tasks.length
    || script.tasks.some(task => !task.id || typeof task.target !== 'string' || !task.target
      || !['jump_to', 'jump_to_and_clap', 'jump_to_and_turn'].includes(task.type))) throw new Error('Invalid script')
  return structuredClone(script)
}

export const CLASSIC_BOARD: HopscotchBoard = Object.freeze({
  initialCell: '1',
  cells: Object.freeze([
    { id: '1', label: '1', level: 0, lane: 'center', color: 'green' },
    { id: '2', label: '2', level: 1, lane: 'left', color: 'blue' },
    { id: '3', label: '3', level: 1, lane: 'right', color: 'orange' },
    { id: '4', label: '4', level: 2, lane: 'center', color: 'yellow' },
    { id: '5', label: '5', level: 3, lane: 'left', color: 'red' },
    { id: '6', label: '6', level: 3, lane: 'right', color: 'green' },
    { id: '7', label: '7', level: 4, lane: 'center', color: 'blue' },
    { id: '8', label: '8', level: 5, lane: 'left', color: 'orange' },
    { id: '9', label: '9', level: 5, lane: 'right', color: 'yellow' },
    { id: '10', label: '10', level: 6, lane: 'center', color: 'red' },
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

export function createHopscotch(options: {
  board?: HopscotchBoard; config?: HopscotchConfig; random?: () => number;
  mode?: HopscotchMode; script?: HopscotchScript; instructionMode?: InstructionMode; presentationRandom?: () => number
} = {}) {
  const board = structuredClone(options.board ?? CLASSIC_BOARD)
  if (!board.cells.length || new Set(board.cells.map(cell => cell.id)).size !== board.cells.length
    || !board.cells.some(cell => cell.id === board.initialCell)
    || board.cells.some(cell => !cell.id || !cell.label || !Number.isInteger(cell.level)
      || !['left', 'center', 'right'].includes(cell.lane)
      || (cell.color !== undefined && !Object.hasOwn(HOPSCOTCH_COLOR_LABELS, cell.color)))) throw new Error('Invalid board')
  let config = { ...(options.config ?? DEFAULT_CONFIG) }
  validateConfig(config)
  const random = options.random ?? Math.random
  const presentationRandom = options.presentationRandom ?? Math.random
  let instructionMode = options.instructionMode ?? 'number'
  validateInstructionMode(instructionMode)
  let requestedKind: PresentationKind = 'number'
  function choosePresentation() {
    requestedKind = instructionMode === 'mixed' ? (presentationRandom() < 0.5 ? 'number' : 'color') : instructionMode
  }
  let mode = options.mode ?? 'random'
  let script = options.script ? copyScript(options.script) : null
  if (mode === 'script' && !script) throw new Error('Script required')
  let scriptTaskIndex = 0
  let currentCell = board.initialCell
  let active: HopscotchTask | null = null
  let previousTarget: string | null = null
  let history: HopscotchHistoryEntry[] = []
  const legalTargets = () => getLegalTargets(board, currentCell, config)
  const originalTask = () => mode === 'script' ? script!.tasks[scriptTaskIndex] ?? null : null
  const finished = () => mode === 'script' && scriptTaskIndex >= script!.tasks.length
  function chooseTarget(legal: string[]) {
    const alternatives = legal.filter(id => id !== previousTarget)
    const candidates = alternatives.length ? alternatives : legal
    return candidates.length === 0 ? null : candidates.length === 1 ? candidates[0]! : candidates[Math.floor(random() * candidates.length)]!
  }
  function resolve() {
    active = null
    if (finished()) return
    const legal = legalTargets()
    const planned = originalTask()
    const target = planned && legal.includes(planned.target) ? planned.target : chooseTarget(legal)
    if (target === null) return
    active = planned ? { ...planned, target } : { id: `random-${history.length + 1}`, type: 'jump_to', target }
    previousTarget = target
    choosePresentation()
  }
  function read() {
    const completedCount = history.filter(entry => entry.outcome === 'DONE').length
    const presentation = active ? presentHopscotchTask(active, board, legalTargets(), requestedKind)
      : { targetColor: null, presentationKind: null, presentationFallbackReason: null, displayText: null }
    return {
      instructionMode, ...presentation,
      mode, status: finished() ? 'finished' as const : active ? 'active' as const : 'blocked' as const,
      scriptId: mode === 'script' ? script!.id : null,
      scriptTaskIndex: mode === 'script' ? scriptTaskIndex : null,
      scriptTaskCount: mode === 'script' ? script!.tasks.length : 0,
      completedScriptTaskCount: mode === 'script' ? completedCount : 0,
      originalTask: originalTask() ? { ...originalTask()! } : null,
      resolvedTask: active ? { ...active } : null,
      currentCell, targetCell: active?.target ?? null, legalTargets: legalTargets(), config: { ...config },
      // Retain the V1 text/action convenience projection; structured task is authoritative.
      task: active ? { ...active, action: active.type, text: presentation.displayText! } : null,
      completedCount, skippedCount: history.filter(entry => entry.outcome === 'SKIP').length,
      history: history.map(entry => ({ ...entry })),
    }
  }
  function act(outcome: HopscotchHistoryEntry['outcome']) {
    if (!active) return read()
    history.push({ from: currentCell, target: active.target, outcome, taskId: active.id,
      type: active.type, plannedTarget: originalTask()?.target ?? active.target })
    if (outcome === 'DONE') currentCell = active.target
    if (mode === 'script') scriptTaskIndex++
    resolve()
    return read()
  }
  function reset() {
    currentCell = board.initialCell; active = null; previousTarget = null; history = []; scriptTaskIndex = 0
    resolve()
    return read()
  }
  resolve()
  return {
    read,
    done: () => act('DONE'),
    skip: () => act('SKIP'),
    repeat: read, // Never re-resolve, consume randomness, or alter history.
    reset,
    setMode(next: HopscotchMode) {
      if (!['random', 'script'].includes(next)) throw new Error('Invalid mode')
      if (next === 'script' && !script) throw new Error('Script required')
      if (mode === next) return read()
      mode = next
      return reset()
    },
    setScript(next: HopscotchScript) {
      script = copyScript(next); mode = 'script'
      return reset()
    },
    setInstructionMode(next: InstructionMode) {
      validateInstructionMode(next)
      if (instructionMode === next) return read()
      instructionMode = next
      if (active) choosePresentation()
      return read()
    },
    setConfig(next: HopscotchConfig) {
      validateConfig(next)
      config = { ...next }
      // A finished round stays finished, even when configuration restores legal moves.
      if (!finished() && (!active || !legalTargets().includes(active.target))) resolve()
      return read()
    },
  }
}
