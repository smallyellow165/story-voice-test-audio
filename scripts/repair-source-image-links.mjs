// Offline, explicit-ID operation only. Never imported by server/UI runtime.
import { readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateImage } from '../server/brick-image-validation.mjs'
import { createSourceImageStore } from '../server/brick-source-images.mjs'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
export async function snapshot(root) {
  const files = {}
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(file)
      else if (entry.isFile()) files[path.relative(root, file)] = sha(await readFile(file))
    }
  }
  for (const e of await readdir(root, { withFileTypes: true })) if (e.isDirectory() && e.name.startsWith('brick-')) await walk(path.join(root, e.name))
  return files
}
export async function planRepair(root, ids) {
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !uuid.test(id))) throw Error('Explicit unique Analysis UUIDs required')
  const before = await snapshot(root), actions = []
  const jsons = []
  for (const file of Object.keys(before).filter(f => f.endsWith('.json'))) {
    const bytes = await readFile(path.join(root, file), 'utf8')
    jsons.push({ file, bytes, record: JSON.parse(bytes) })
  }
  for (const id of ids) {
    const file = 'brick-reverse/' + id + '.json', entry = jsons.find(e => e.file === file)
    if (!entry || entry.record.id !== id || entry.record.kind !== 'reverse-analysis' || entry.record.sourceImageId !== undefined) throw Error('Not an unlinked Analysis: ' + id)
    const r = entry.record, original = validateImage(r.originalImage), wire = validateImage(r.image)
    if (r.originalImage.sha256 !== undefined && r.originalImage.sha256 !== original.sha256) throw Error('Original hash mismatch: ' + id)
    if (r.image.sha256 !== wire.sha256 || r.image_reference?.sha256 !== wire.sha256) throw Error('Wire image evidence mismatch: ' + id)
    const hashes = [before[file], sha(JSON.stringify(r))]
    const consumers = jsons.filter(e => e.file !== file && hashes.some(h => e.bytes.includes(h)))
    if (consumers.length) throw Error('Whole-record hash dependencies; repair refused: ' + id + ' → ' + consumers.map(e => e.file).join(', '))
    if (r.guidance) {
      const parent = jsons.find(e => e.record.id === r.guidance.sourceAnalysisId && e.record.kind === 'reverse-analysis')?.record
      if (!parent || sha(JSON.stringify(parent.analysis)) !== r.guidance.sourceAnalysisHash || validateImage(parent.originalImage).sha256 !== original.sha256) throw Error('Guided parent evidence mismatch: ' + id)
    }
    const spatialEvidence = jsons.filter(e => e.record.task === 'spatial-planning' && e.record.requestInput?.provenance?.analysisId === id)
    for (const e of spatialEvidence) {
      const hash = e.record.requestInput.imageProvenance?.originalImageSha256
      if (hash !== undefined && hash !== null && hash !== original.sha256) throw Error('Spatial original hash mismatch: ' + e.file)
    }
    const sourceImageId = 'sha256:' + original.sha256
    const after = JSON.stringify({ ...r, sourceImageId })
    actions.push({ id, file, beforeSha256: before[file], afterSha256: sha(after), sourceImageId,
      evidence: { originalSha256: original.sha256, originalBytes: original.bytes, wireSha256: wire.sha256, spatialFiles: spatialEvidence.map(e => e.file) } })
  }
  return { schemaVersion: 1, operation: 'source-image-link-repair-v1', actions, before }
}
export async function applyRepair(root, plan, auditDirectory) {
  if (plan.operation !== 'source-image-link-repair-v1' || plan.schemaVersion !== 1) throw Error('Unsupported repair plan')
  const fresh = await planRepair(root, plan.actions.map(a => a.id))
  if (JSON.stringify(fresh) !== JSON.stringify(plan)) throw Error('Data changed since plan; no writes performed')
  await mkdir(auditDirectory, { recursive: false })
  await writeFile(path.join(auditDirectory, 'plan.json'), JSON.stringify(plan, null, 2), { flag: 'wx', mode: 0o600 })
  for (const a of plan.actions) await writeFile(path.join(auditDirectory, a.id + '.before.json'), await readFile(path.join(root, a.file)), { flag: 'wx', mode: 0o600 })
  const store = createSourceImageStore(path.join(root, 'brick-source-images')), changed = []
  try {
    for (const a of plan.actions) {
      const file = path.join(root, a.file), bytes = await readFile(file)
      if (sha(bytes) !== a.beforeSha256) throw Error('Concurrent edit: ' + a.id)
      const original = JSON.parse(bytes), source = await store.put(original.originalImage)
      if (source.imageId !== a.sourceImageId) throw Error('Source identity changed')
      const record = { ...original, sourceImageId: source.imageId }, updated = JSON.stringify(record)
      if (sha(updated) !== a.afterSha256) throw Error('Repair differs from approved plan')
      const temp = file + '.' + randomUUID() + '.tmp'
      await writeFile(temp, updated, { flag: 'wx', mode: 0o600 })
      if (sha(await readFile(file)) !== a.beforeSha256) throw Error('Concurrent edit: ' + a.id)
      await rename(temp, file); changed.push(a.id)
      await store.verifyAnalysis(record)
    }
    const after = await snapshot(root), allowed = new Set(plan.actions.map(a => a.file))
    for (const [file, hash] of Object.entries(plan.before)) if (!allowed.has(file) && after[file] !== hash) throw Error('Protected file changed: ' + file)
    for (const a of plan.actions) if (after[a.file] !== a.afterSha256) throw Error('Repaired file changed: ' + a.file)
    const result = { status: 'complete', changed, after, protectedFilesVerified: Object.keys(plan.before).length - allowed.size }
    await writeFile(path.join(auditDirectory, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 })
    return result
  } catch (error) {
    await writeFile(path.join(auditDirectory, 'failure.json'), JSON.stringify({ changed, error: error.message }, null, 2), { flag: 'wx', mode: 0o600 })
    throw error
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode, root, ...args] = process.argv.slice(2)
  if (mode === 'plan') console.log(JSON.stringify(await planRepair(path.resolve(root), args), null, 2))
  else if (mode === 'apply' && args.length === 2) console.log(JSON.stringify(await applyRepair(path.resolve(root), JSON.parse(await readFile(args[0], 'utf8')), path.resolve(args[1])), null, 2))
  else throw Error('Usage: plan <generated-dir> <explicit analysis IDs...> | apply <generated-dir> <plan.json> <new audit-directory>')
}
