// Activity Contract v1. The envelope is independent of postMessage/RTVI/media.
export function createActivityBridge(
  onExit: () => void,
  getSnapshot: () => Record<string, unknown>,
  reset: () => void,
) {
  const params = new URLSearchParams(location.search)
  const instanceId = params.get('activityId'), origin = params.get('hostOrigin')
  const allowed = new Set(['http://localhost:3000', 'http://127.0.0.1:3000'])
  const enabled = window.parent !== window && !!origin && allowed.has(origin) && !!instanceId
  let closed = false
  const results = new Map<string, Record<string, unknown>>()
  function send(name: string, payload: Record<string, unknown> = {}) {
    if (!enabled || closed) return
    const snapshot = payload.snapshot || getSnapshot()
    window.parent.postMessage({ channel: 'activity-v1', v: 1, instanceId,
      id: crypto.randomUUID(), kind: name === 'command_result' ? 'result' : name === 'state' ? 'state' : 'event',
      name, payload: { ...payload, snapshot } }, origin!)
  }
  function receive(event: MessageEvent) {
    const data = event.data
    if (!enabled || event.source !== parent || event.origin !== origin || data?.channel !== 'activity-v1'
      || data.v !== 1 || data.instanceId !== instanceId || data.kind !== 'command'
      || typeof data.id !== 'string' || data.id.length > 128) return
    if (results.has(data.id)) { send('command_result', results.get(data.id)); return }
    if (data.name === 'get_snapshot') { send('state'); return }
    let status = 'applied', error: string | undefined
    try {
      if (data.name === 'reset') {
        if (data.payload?.expectedRunId !== getSnapshot().runId) throw new Error('stale_run')
        reset()
      } else if (data.name === 'exit') onExit()
      else throw new Error('unsupported_command')
    } catch (e) { status = 'rejected'; error = String(e) }
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
  window.addEventListener('message', receive)
  return { send, dispose() { closed = true; window.removeEventListener('message', receive) } }
}
