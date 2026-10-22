import type { GameAction } from './game-permissions'

// Activity Contract v1. The envelope is independent of postMessage/RTVI/media.
export function createActivityBridge(
  onExit: () => void,
  getSnapshot: () => Record<string, unknown>,
  reset: () => void,
  endpoint?: { instanceId: string; send: (message: any) => void },
  applyAction?: (name: GameAction, args: Record<string, unknown>) => boolean | Promise<boolean>,
) {
  const params = new URLSearchParams(location.search)
  const instanceId = endpoint?.instanceId || params.get('activityId'), origin = params.get('hostOrigin')
  const allowed = new Set(['http://localhost:3000', 'http://127.0.0.1:3000'])
  const enabled = !!endpoint || window.parent !== window && !!origin && allowed.has(origin) && !!instanceId
  let closed = false
  const results = new Map<string, Record<string, unknown>>()
  const pending = new Set<string>()
  function send(name: string, payload: Record<string, unknown> = {}) {
    if (!enabled || closed) return
    const snapshot = payload.snapshot || getSnapshot()
    const message = { channel: 'activity-v1', v: 1, instanceId,
      id: crypto.randomUUID(), kind: name === 'command_result' ? 'result' : name === 'state' ? 'state' : 'event',
      name, payload: { ...payload, snapshot } }
    if (endpoint) endpoint.send(message)
    else window.parent.postMessage(message, origin!)
  }
  function receive(event: MessageEvent) {
    if (event.source !== parent || event.origin !== origin || event.data?.channel !== 'activity-v1') return
    receiveCommand(event.data)
  }
  function receiveCommand(data: any) {
    if (!enabled || closed || data?.v !== 1 || data.instanceId !== instanceId || data.kind !== 'command'
      || typeof data.id !== 'string' || data.id.length > 128) return
    if (results.has(data.id)) { send('command_result', results.get(data.id)); return }
    if (pending.has(data.id)) return // An in-flight async command must never execute twice.
    if (data.name === 'get_snapshot') { send('state'); return }
    pending.add(data.id)
    let status = 'applied', error: string | undefined
    const finish = () => {
      pending.delete(data.id)
      const snapshot = getSnapshot()
      const result = { replyTo: data.id, sessionEpoch: data.sessionEpoch, status, error,
        snapshot: data.name === 'exit' && status === 'applied'
          ? { ...snapshot, revision: Number(snapshot.revision) + 1, lifecycle: 'closed' } : snapshot }
      results.set(data.id, result)
      if (results.size > 128) results.delete(results.keys().next().value!)
      send('command_result', result)
      if (data.name === 'exit' && status === 'applied') {
        send('activity_closed', { snapshot: result.snapshot }); closed = true
      }
    }
    try {
      const current = getSnapshot()
      if (data.payload?.expectedTaskAttemptId !== undefined && (
        data.payload.expectedRunId !== current.runId || data.payload.baseRevision !== current.revision
        || data.payload.expectedTaskAttemptId !== current.taskAttemptId)) throw new Error('stale_game_input')
      if (data.name === 'reset') {
        if (data.payload?.expectedRunId !== getSnapshot().runId) throw new Error('stale_run')
        reset()
      } else if (data.name === 'exit') onExit()
      else {
        const applied = applyAction?.(data.name, data.payload?.args || {})
        if (applied instanceof Promise) {
          void applied.then(ok => {
            if (!ok) { status = 'rejected'; error = 'unsupported_or_unavailable_action' }
          }).catch(reason => { status = 'rejected'; error = String(reason) }).then(finish)
          return
        }
        if (!applied) throw new Error('unsupported_or_unavailable_action')
      }
    } catch (e) { status = 'rejected'; error = String(e) }
    finish()
  }
  if (!endpoint) window.addEventListener('message', receive)
  return { send, receive: receiveCommand, dispose() { closed = true; window.removeEventListener('message', receive) } }
}
