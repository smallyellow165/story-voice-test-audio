// Activity Contract v1. The envelope is independent of postMessage/RTVI/media.
export function createActivityBridge(
  onExit: () => void,
  getSnapshot: () => Record<string, unknown>,
  reset: () => void,
  endpoint?: { instanceId: string; send: (message: any) => void },
) {
  const params = new URLSearchParams(location.search)
  const instanceId = endpoint?.instanceId || params.get('activityId'), origin = params.get('hostOrigin')
  const allowed = new Set(['http://localhost:3000', 'http://127.0.0.1:3000'])
  const enabled = !!endpoint || window.parent !== window && !!origin && allowed.has(origin) && !!instanceId
  let closed = false
  const results = new Map<string, Record<string, unknown>>()
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
  if (!endpoint) window.addEventListener('message', receive)
  return { send, receive: receiveCommand, dispose() { closed = true; window.removeEventListener('message', receive) } }
}
