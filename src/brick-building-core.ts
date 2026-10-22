import { createGameRuntime, type GameDefinition } from './games/game-runtime.ts'
import { validateAssembly, footprint } from './brick-test/assembly.ts'
import type { BrickGameArtifact } from './brick-game-contract.ts'
import { PARTS, COLORS, validPosition } from './brick-test/catalog.ts'
import { validateBrickDesign } from './brick-design-validation.mjs'
import { createActivityBridge } from './activity-bridge.ts'
import type { ActivityMessage } from './activity-message.ts'
import type { ScreenGameOptions } from './screen-game-module.ts'

export function createBrickBuilding(options: ScreenGameOptions & { artifact: BrickGameArtifact }, changed: () => void = () => {}) {
  const artifact = options.artifact
  if (!artifact || artifact.schemaVersion !== 1 || !artifact.generation?.ok || !artifact.review?.mapping.valid) throw new Error('validated_design_required')
  const design = artifact.generation.design
  const report = validateBrickDesign(design, artifact.generatorInput.inventory, { PARTS, COLORS, validPosition, validateAssembly, footprint })
  if (!report.valid) throw new Error('design_validation_failed: ' + report.issues.map((i: { message: string }) => i.message).join('; '))
  const byId = new Map(design.bricks.map(brick => [brick.id, brick]))
  const tasks = design.steps.flatMap(step => {
    const brick = byId.get(step.brickId)!
    const part = PARTS.find(p => p.id === brick.part)!, color = COLORS.find(c => c.code === brick.color)!
    return [
      { id: 'find-' + brick.id, description: '找一块' + color.label + '的 ' + part.label + ' 积木。找到了告诉我。', condition: { type: 'manual' as const } },
      { id: 'place-' + brick.id, description: step.instruction, condition: { type: 'manual' as const } },
    ]
  })
  const definition: GameDefinition = { id: 'brick:' + artifact.id, name: design.name, ringSlots: [], tasks }
  const total = tasks.length
  const runtime = createGameRuntime(definition)
  let completed = 0, revision = 1, closed = false, enabled = true
  let runId: string = crypto.randomUUID(), taskAttemptId: string = crypto.randomUUID()
  let modelError = '模型正在加载，请稍等。'
  const canWrite = () => enabled && !closed && (options.canInteract?.() ?? true)
  function snapshot() {
    const state = runtime.read()
    return { activityType: 'brick-building', gameId: definition.id, gameName: definition.name,
      brickBuilding: { artifactId: artifact.id, designHash: artifact.designHash,
        brickId: design.steps[Math.floor(state.index / 2)].brickId, phase: state.index % 2 === 0 ? 'find' : 'place' },
      runId, taskAttemptId, revision, index: state.index, total: definition.tasks.length,
      taskId: state.task.id, taskDescription: state.task.description,
      lifecycle: closed ? 'closed' : completed === total ? 'finished' : 'running',
      taskStatus: completed === total ? 'succeeded' : 'not_yet',
      progress: { completed, total }, capabilities: ['get_snapshot', 'reset', 'exit'],
      taskSequence: definition.tasks.map(task => task.id),
      succeededTaskIds: definition.tasks.slice(0, completed).map(task => task.id), skippedTaskIds: [],
    }
  }
  const bridge = createActivityBridge(() => { closed = true; changed() }, snapshot, () => {
    if (!canWrite()) throw new Error('not_game_authority')
    runtime.reset(); completed = 0; runId = crypto.randomUUID(); taskAttemptId = crypto.randomUUID(); revision++
    changed(); bridge.send('task_changed')
  }, { instanceId: options.instanceId, send: options.onMessage }, name => {
    if (!canWrite() || completed === total) return false
    if (name === 'repeat_task') { bridge.send('task_repeated'); return true }
    if (name !== 'confirm_task') return false
    if (modelError) throw new Error(modelError)
    runtime.confirm()
    if (runtime.read().result !== 'SUCCESS') return false
    completed++
    if (completed < total) runtime.next()
    revision++; taskAttemptId = crypto.randomUUID()
    changed(); bridge.send(completed === total ? 'game_finished' : 'task_changed')
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
      const sequence = definition.tasks.map(task => task.id)
      if (value.brickBuilding?.artifactId !== artifact.id || value.brickBuilding?.designHash !== artifact.designHash
        || value.brickBuilding?.brickId !== design.steps[Math.floor(Math.min(n, total - 1) / 2)]?.brickId
        || value.brickBuilding?.phase !== (Math.min(n, total - 1) % 2 === 0 ? 'find' : 'place')
        || value.activityType !== 'brick-building' || value.gameId !== definition.id
        || !Number.isInteger(n) || n < 0 || n > total || value.total !== total || value.progress?.total !== total
        || value.index !== Math.min(n, total - 1) || value.taskId !== sequence[value.index]
        || !Number.isInteger(value.revision) || value.revision < 0
        || ![value.runId, value.taskAttemptId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 128)
        || !['running', 'finished', 'closed'].includes(value.lifecycle)
        || (value.lifecycle !== 'closed' && (value.lifecycle === 'finished') !== (n === total))
        || value.taskStatus !== (n === total ? 'succeeded' : 'not_yet')
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
