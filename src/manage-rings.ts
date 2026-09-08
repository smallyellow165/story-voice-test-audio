import { createBottomSheet } from './ui/bottom-sheet'
export type ManagedRings = { historyId: string | null; ringIds: string[]; names: Record<string, string> }
export function mountManageRings(button: HTMLButtonElement, getState: () => ManagedRings,
  onSaved: (id: string, names: Record<string, string>) => void, root: Document | ShadowRoot = document, apiBase = '') {
  const lifetime = new AbortController()
  const content = document.createElement('div'), footer = document.createElement('div')
  const save = document.createElement('button'), status = document.createElement('p')
  save.textContent = '保存名字'; status.setAttribute('role', 'status'); footer.append(save, status)
  const sheet = createBottomSheet({ title: 'Manage Rings', content, footer, root })
  let inputs = new Map<string, HTMLInputElement>(), snapshot: ManagedRings, generation = 0
  button.onclick = () => {
    generation++
    snapshot = getState(); inputs = new Map(); content.replaceChildren(); status.textContent = ''
    save.disabled = !snapshot.historyId || !snapshot.ringIds.length
    if (!snapshot.ringIds.length) content.textContent = '当前没有 Rings。请先 Detect Ring 或 Load History。'
    else {
      if (!snapshot.historyId) status.textContent = '当前结果没有服务端 History，暂不能保存名字。请使用已保存的 Gemini 检测结果。'
      for (const id of snapshot.ringIds) {
        const row = document.createElement('p'), label = document.createElement('label'), input = document.createElement('input')
        label.textContent = `${id} → `; input.value = snapshot.names[id] || ''; input.maxLength = 80
        input.placeholder = 'Ring Name'; input.setAttribute('aria-label', `Ring Name ${id}`)
        label.append(input); row.append(label); content.append(row); inputs.set(id, input)
      }
    }
    sheet.open()
  }
  save.onclick = async () => {
    if (!snapshot.historyId) return
    const id = snapshot.historyId, request = generation
    save.disabled = true; status.textContent = '保存中…'
    try {
      const ringNames = Object.fromEntries([...inputs].map(([key, input]) => [key, input.value]))
      const response = await fetch(`${apiBase}/api/ring-feet/history/${id}/names`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ringNames }), signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(15000)]),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
      if (lifetime.signal.aborted) return
      onSaved(id, data.ringNames)
      if (request === generation) status.textContent = '已保存到 History。'
    } catch (error) { if (request === generation) status.textContent = `保存失败：${String(error)}` }
    finally { if (request === generation) save.disabled = false }
  }
  return () => { lifetime.abort(); button.onclick = null; sheet.destroy() }
}
