import { createGameRuntime, type GameDefinition } from './games/game-runtime.ts'
import { validateAssembly } from './brick-test/assembly.ts'
import type { BrickDesign } from './brick-test/design-types.ts'
import { createActivityBridge } from './activity-bridge.ts'
import type { ActivityMessage } from './activity-message.ts'
import type { ScreenGameOptions } from './screen-game-module.ts'

// Design and geometry have one owner: Test Audio. Interaction steps are smaller
// than assembly steps: finding a brick does not add it to the built structure.
export const BRICK_DESIGN: BrickDesign = {
  name: '红蓝小塔',
  bricks: [
    { id: 'red', part: '3437', color: '4', x: 0, z: 0, layer: 0, rotation: 0 },
    { id: 'blue', part: '3437', color: '1', x: 0, z: 0, layer: 1, rotation: 0 },
  ],
  steps: [
    { brickId: 'red', instruction: '把红色积木放在桌上。' },
    { brickId: 'blue', instruction: '把蓝色积木拼在红色积木正上方。' },
  ],
}
export const BRICK_GAME: GameDefinition = {
  id: 'duplo-two-bricks-v1', name: '搭积木 · 红蓝小塔', ringSlots: [],
  tasks: [
    { id: 'find-red', description: '瑞瑞，找一块红色的、上面有四个小圆点的积木。找到了告诉我。', condition: { type: 'manual' } },
    { id: 'place-red', description: '把红色积木放在桌上，小圆点朝上。放好了告诉我。', condition: { type: 'manual' } },
    { id: 'find-blue', description: '找一块蓝色的、上面有四个小圆点的积木。找到了告诉我。', condition: { type: 'manual' } },
    { id: 'stack-blue', description: '把蓝色积木放在红色积木正上方，轻轻按紧。做好了告诉我。', condition: { type: 'manual' } },
  ],
}

export function createBrickBuilding(options: ScreenGameOptions, changed: () => void = () => {}) {
  // Validate every assembly prefix using V2, never a second geometry algorithm.
  for (let n = 1; n <= BRICK_DESIGN.bricks.length; n++) {
    const result = validateAssembly(BRICK_DESIGN.bricks.slice(0, n))
    if (!result.valid) throw new Error(result.reason)
  }
  const runtime = createGameRuntime(BRICK_GAME)
  let completed = 0, revision = 1, closed = false, enabled = true
  let runId: string = crypto.randomUUID(), taskAttemptId: string = crypto.randomUUID()
  let modelError = '模型正在加载，请稍等。'
  const canWrite = () => enabled && !closed && (options.canInteract?.() ?? true)
  function snapshot() {
    const state = runtime.read()
    return { activityType: 'brick-building', gameId: BRICK_GAME.id, gameName: BRICK_GAME.name,
      runId, taskAttemptId, revision, index: state.index, total: BRICK_GAME.tasks.length,
      taskId: state.task.id, taskDescription: state.task.description,
      lifecycle: closed ? 'closed' : completed === 4 ? 'finished' : 'running',
      taskStatus: completed === 4 ? 'succeeded' : 'not_yet',
      progress: { completed, total: 4 }, capabilities: ['get_snapshot', 'reset', 'exit'],
      taskSequence: BRICK_GAME.tasks.map(task => task.id),
      succeededTaskIds: BRICK_GAME.tasks.slice(0, completed).map(task => task.id), skippedTaskIds: [],
    }
  }
  const bridge = createActivityBridge(() => { closed = true; changed() }, snapshot, () => {
    if (!canWrite()) throw new Error('not_game_authority')
    runtime.reset(); completed = 0; runId = crypto.randomUUID(); taskAttemptId = crypto.randomUUID(); revision++
    changed(); bridge.send('task_changed')
  }, { instanceId: options.instanceId, send: options.onMessage }, name => {
    if (!canWrite() || completed === 4) return false
    if (name === 'repeat_task') { bridge.send('task_repeated'); return true }
    if (name !== 'confirm_task') return false
    if (modelError) throw new Error(modelError)
    runtime.confirm()
    if (runtime.read().result !== 'SUCCESS') return false
    completed++
    if (completed < 4) runtime.next()
    revision++; taskAttemptId = crypto.randomUUID()
    changed(); bridge.send(completed === 4 ? 'game_finished' : 'task_changed')
    return true
  })
  return {
    snapshot,
    start() { bridge.send('task_changed'); bridge.send('ready') },
    setModelError(error: string) { modelError = error; changed() },
    setEnabled(value: boolean) { enabled = value; changed() },
    receive(message: ActivityMessage) {
      if (message.name !== 'get_snapshot' && !canWrite()) return
      // Every task input must be fenced. The bridge checks all three fields and
      // caches command IDs. Never silently bind an unversioned input to this task.
      if (['confirm_task', 'repeat_task'].includes(message.name) && message.payload?.expectedTaskAttemptId === undefined) {
        bridge.send('command_result', { replyTo: message.id, sessionEpoch: message.sessionEpoch,
          status: 'rejected', error: 'missing_task_reference' })
        return
      }
      bridge.receive(message)
    },
    restore(value: Record<string, any>) {
      const n = value.progress?.completed
      const sequence = BRICK_GAME.tasks.map(task => task.id)
      if (value.activityType !== 'brick-building' || value.gameId !== BRICK_GAME.id
        || !Number.isInteger(n) || n < 0 || n > 4 || value.total !== 4 || value.progress?.total !== 4
        || value.index !== Math.min(n, 3) || value.taskId !== sequence[value.index]
        || !Number.isInteger(value.revision) || value.revision < 0
        || ![value.runId, value.taskAttemptId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 128)
        || !['running', 'finished', 'closed'].includes(value.lifecycle)
        || (value.lifecycle !== 'closed' && (value.lifecycle === 'finished') !== (n === 4))
        || value.taskStatus !== (n === 4 ? 'succeeded' : 'not_yet')
        || JSON.stringify(value.taskSequence) !== JSON.stringify(sequence)
        || JSON.stringify(value.succeededTaskIds) !== JSON.stringify(sequence.slice(0, n))
        || JSON.stringify(value.skippedTaskIds) !== '[]') throw new Error('game_snapshot_mismatch')
      runtime.restore(value.index); completed = n; revision = value.revision
      runId = value.runId; taskAttemptId = value.taskAttemptId; closed = value.lifecycle === 'closed'
      changed() // Recovery is silent; never replay instructions or confirmations.
    },
    dispose() { closed = true; bridge.dispose() },
  }
}
