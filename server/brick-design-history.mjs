import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadBrickRules } from './brick-rules.mjs'
import { validateBrickDesign } from '../src/brick-design-validation.mjs'
import { assessDesignDisplay } from '../src/brick-design-display.mjs'
const directory = fileURLToPath(new URL('../generated/brick-design-traces/', import.meta.url))
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
// Existing trace files are the only store. Restoration is read-only and calls no model.
export async function listDesignTraces(root = directory) {
  const files = await readdir(root).catch(e => { if (e.code === 'ENOENT') return []; throw e })
  const items = []
  for (const file of files.filter(f => f.endsWith('.json') && uuid.test(f.slice(0, -5)))) {
    try {
      const r = JSON.parse(await readFile(path.join(root, file), 'utf8'))
      if (r.task === 'design' && r.id === file.slice(0, -5) && Number.isFinite(r.elapsedMs)) items.push({ id: r.id, createdAt: r.createdAt, model: r.model, valid: r.ok === true, name: typeof r.design?.name === 'string' ? r.design.name : '' })
    } catch { /* An incomplete/corrupt file is not a loadable history record. */ }
  }
  return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id))
}
export async function loadDesignTrace(id, root = directory, loadRules = loadBrickRules) {
  if (!uuid.test(id || '')) throw Object.assign(new Error('无效生成记录 ID'), { statusCode: 400 })
  const r = JSON.parse(await readFile(path.join(root, id + '.json'), 'utf8'))
  if (r.task !== 'design' || r.id !== id || !Number.isFinite(r.elapsedMs)) throw new Error('生成记录尚未完成或无效')
  const rules = await loadRules()
  const recheck = candidate => {
    const result = { ...candidate, recordedValidation: candidate.validation, recordedOk: candidate.ok }
    // Parse the preserved model output, never infer or repair placements on load.
    try {
      result.design = JSON.parse(candidate.rawOutput)
      result.display = assessDesignDisplay(result.design, rules)
      result.validation = validateBrickDesign(result.design, candidate.requestInput?.inventory || [], rules)
      result.ok = candidate.ok === true && result.validation.valid
    } catch { result.display = { renderable: false, issues: ['模型输出无法解析；保留原始诊断。'] }; result.ok = false }
    return result
  }
  return { ...recheck(r), priorAttempts: (r.priorAttempts || []).map(recheck) }
}
