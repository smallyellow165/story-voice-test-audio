export type ActivityEvent = 'ready' | 'task_changed' | 'task_succeeded' | 'ended'
export function createActivityBridge(onExit: () => void) {
  const params = new URLSearchParams(location.search)
  const instanceId = params.get('activityId'), origin = params.get('hostOrigin')
  const allowed = new Set(['http://localhost:3000', 'http://127.0.0.1:3000'])
  let sequence = 0, closed = false
  const seen = new Set<string>()
  const enabled = window.parent !== window && !!origin && allowed.has(origin) && !!instanceId
  function send(type: ActivityEvent, payload: Record<string, unknown> = {}) {
    if (enabled && !closed) window.parent.postMessage({ channel: 'ringfeet-activity-v1', instanceId,
      eventId: `${instanceId}:${++sequence}`, type, payload }, origin!)
  }
  function receive(event: MessageEvent) {
    const data = event.data
    if (!enabled || event.source !== parent || event.origin !== origin || data?.channel !== 'ringfeet-activity-v1'
      || data.instanceId !== instanceId || typeof data.commandId !== 'string' || seen.has(data.commandId)) return
    if (data.type !== 'exit' && data.type !== 'hello') return
    seen.add(data.commandId)
    if (data.type === 'hello') { send('ready'); return }
    onExit()
    send('ended', { reason: 'closed', cameraReleased: true })
    closed = true
  }
  window.addEventListener('message', receive)
  return { send, dispose() { closed = true; window.removeEventListener('message', receive) } }
}
