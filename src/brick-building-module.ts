import type { BrickGameArtifact } from './brick-game-contract'
import { PARTS, COLORS } from './brick-test/catalog'
import { BrickViewer } from './brick-test/viewer'
import { createBrickBuilding } from './brick-building-core'
import { allowsGameAction, defaultGamePermissions, type GameAction } from './game-permissions'
import type { ScreenGameOptions } from './screen-game-module'
import type { ActivityMessage } from './activity-message'

export const brickArtifactVersion = 1

export function mount(host: HTMLElement, options: ScreenGameOptions & { libraryUrl?: string; artifact: BrickGameArtifact }) {
  const root = host.shadowRoot || host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = ':host{display:block;color:#18302f;font-family:system-ui,sans-serif}section{background:#fff;padding:18px;border-radius:12px}h3{font-size:26px}button{font:inherit;margin:6px;padding:12px;border-radius:8px;cursor:pointer}button:disabled{opacity:.5;cursor:default}.viewer{height:320px;min-height:240px;width:100%}.error{color:#a21b24;white-space:pre-wrap}'
  const panel = document.createElement('section')
  panel.innerHTML = '<h2>搭积木</h2><p class="progress"></p><h3 class="task" aria-live="polite"></h3><p class="target"></p><div class="viewer"></div><p class="error" role="alert"></p><div><button class="confirm">找到了</button><button class="repeat">再说一次</button><button class="reset">重新开始</button></div><p>按图寻找积木。由孩子或家长确认完成；本游戏不使用摄像头。</p>'
  root.replaceChildren(style, panel)
  const design = options.artifact.generation.design
  const byId = new Map(design.bricks.map(brick => [brick.id, brick]))
  panel.querySelector('h2')!.textContent = design.name
  let fatal = false
  let disposed = false, enabled = true, loading = true, error = '', visualKey = '', generation = 0
  let viewer: BrickViewer | undefined
  let game: ReturnType<typeof createBrickBuilding> | undefined
  const permissions = () => options.permissions?.() ?? defaultGamePermissions(enabled && (options.canInteract?.() ?? true), !enabled)
  function render() {
    if (!game || disposed) return
    const state = game.snapshot(), finished = state.lifecycle === 'finished'
    panel.querySelector('.progress')!.textContent = `已完成 ${state.progress.completed} / ${state.total}`
    panel.querySelector('.task')!.textContent = finished ? design.name + '完成啦！' : state.taskDescription
    const stepIndex = Math.floor(state.index / 2), target = byId.get(design.steps[stepIndex].brickId)!
    panel.querySelector('.target')!.textContent = `当前目标：${COLORS.find(c => c.code === target.color)?.label} · DUPLO ${target.part} · ${PARTS.find(p => p.id === target.part)?.label}`
    panel.querySelector('.error')!.textContent = error || (loading ? '正在加载真实 LDraw 模型…' : '')
    for (const [selector, action] of controls) {
      panel.querySelector<HTMLButtonElement>(selector)!.disabled = state.lifecycle === 'closed'
        || !allowsGameAction(permissions(), action) || (action !== 'reset' && finished)
        || (action === 'confirm_task' && (loading || !!error))
    }
    panel.querySelector('.confirm')!.textContent = state.index % 2 === 0 ? '找到了' : '做好了'
    const key = `${state.runId}:${state.index}`
    if (viewer && !fatal && key !== visualKey && state.lifecycle !== 'closed') {
      visualKey = key; loading = true; error = ''; const ticket = ++generation
      game.setModelError('模型正在加载，请稍等。')
      const bricks = state.index % 2 === 0
        ? [{ ...target, x: 0, z: 0, layer: 0 }]
        : design.steps.slice(0, stepIndex + 1).map(step => byId.get(step.brickId)!)
      void viewer.replace(bricks).then(applied => {
        if (!disposed && ticket === generation && applied) { loading = false; game!.setModelError('') }
      }).catch(reason => {
        if (disposed || ticket !== generation) return
        loading = false; error = `真实积木模型加载失败：${String(reason)}。请检查 LDraw 服务后重新开始。`
        game!.setModelError(error)
      })
    }
  }
  const controls: [string, GameAction][] = [['.confirm', 'confirm_task'], ['.repeat', 'repeat_task'], ['.reset', 'reset']]
  game = createBrickBuilding(options, render)
  try {
    viewer = new BrickViewer(panel.querySelector<HTMLElement>('.viewer')!, options.libraryUrl ?? '/ringfeet-api/story-voice-test-audio/brick-ldraw/', message => {
      fatal = true; ++generation; loading = false; error = message; game!.setModelError(message)
    })
  } catch (reason) {
    loading = false; error = `无法初始化 3D Viewer：${String(reason)}`; game.setModelError(error)
  }
  for (const [selector, action] of controls) {
    const button = panel.querySelector<HTMLButtonElement>(selector)!
    let pressed: ReturnType<typeof game.snapshot> | undefined, keyHeld = false
    button.onpointerdown = () => { keyHeld = false; pressed = game!.snapshot() }
    button.onpointercancel = () => { pressed = undefined }
    button.onkeydown = event => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { keyHeld = true; pressed = game!.snapshot() }
    }
    button.onkeyup = () => { keyHeld = false }
    button.onclick = event => {
      const state = pressed ?? game!.snapshot()
      if (!keyHeld) pressed = undefined
      if (event.detail > 1 || !allowsGameAction(permissions(), action)) return
      const taskReference = { instanceId: options.instanceId, runId: state.runId,
        taskAttemptId: state.taskAttemptId, revision: state.revision }
      // Host preserves the gesture's step and routes both input sources through
      // ActivitySession. No direct local advancement in V4.
      if (options.onAction) options.onAction(action, { taskReference })
      else {
        game!.receive({ v: 1, id: crypto.randomUUID(), kind: 'command', name: action, instanceId: options.instanceId,
          payload: { expectedRunId: state.runId, expectedTaskAttemptId: state.taskAttemptId, baseRevision: state.revision } })
      }
    }
  }
  render(); game.start()
  return {
    snapshot: game.snapshot,
    restore(value: Record<string, unknown>) { game!.restore(value) },
    setEnabled(value: boolean) { enabled = value; game!.setEnabled(value) },
    receive(message: ActivityMessage) { game!.receive(message) },
    unmount() {
      if (disposed) return
      if (!options.permissions || options.permissions().canAdminGame) {
        game!.receive({ v: 1, id: crypto.randomUUID(), instanceId: options.instanceId, kind: 'command', name: 'exit', payload: {} })
      }
      disposed = true; ++generation; game!.dispose(); viewer?.dispose(); root.replaceChildren()
    },
  }
}
