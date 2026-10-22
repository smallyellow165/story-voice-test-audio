import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createGeminiClient } from '../server/gemini-client.mjs'
import { visionErrorDiagnostic } from '../server/brick-vision.mjs'
import { buildVisionDiagnostic } from '../server/brick-vision-diagnostic.mjs'

// Explicit opt-in only: no invocation from server/UI, no batches or retries.
// node --env-file-if-exists=.env scripts/diagnose-brick-vision.mjs <vision-id> <stage> [--send]
const [id, stage, consent, ...extra] = process.argv.slice(2)
if (!/^[a-f0-9-]{36}$/.test(id || '') || (consent && consent !== '--send') || extra.length) {
  throw new Error('Usage: diagnose-brick-vision.mjs <vision-id> <stage> [--send]. Without --send: inspect only, no API call.')
}
const root = fileURLToPath(new URL('../', import.meta.url))
const source = JSON.parse(await readFile(path.join(root, 'generated/brick-vision', `${id}.json`), 'utf8'))
const request = buildVisionDiagnostic(source, stage)
const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex')
const directory = path.join(root, 'generated/brick-vision-diagnostics')
const destination = path.join(directory, `${id}-${stage}-${fingerprint}.json`)
console.log(JSON.stringify({ sourceId: id, stage, model: request.model, image: source.image,
  configKeys: Object.keys(request.config || {}), fingerprint, destination, willCallModel: consent === '--send' }, null, 2))
if (consent === '--send') {
  const ai = createGeminiClient()
  await mkdir(directory, { recursive: true })
  const result = { sourceId: id, stage, fingerprint, createdAt: new Date().toISOString(),
    status: 'processing', request }
  // Existing record (including an interrupted attempt) blocks a duplicate paid call.
  await writeFile(destination, JSON.stringify(result), { flag: 'wx', mode: 0o600 })
  // Standalone process only: observe the SDK's real fetch without substituting
  // a response. Capture wire body/status, never authentication headers or URL
  // query parameters. Restore immediately after the one SDK call.
  const realFetch = globalThis.fetch
  let fetchCount = 0
  globalThis.fetch = async (input, init) => {
    if (++fetchCount > 1) throw new Error('Diagnostic blocked an additional HTTP request')
    const url = new URL(input instanceof Request ? input.url : String(input))
    result.http = { endpoint: url.origin + url.pathname, method: init?.method || 'GET',
      requestBody: typeof init?.body === 'string' ? init.body : null }
    const response = await realFetch(input, init)
    result.httpStatus = response.status
    result.http.status = response.status
    result.http.statusText = response.statusText
    try { result.http.responseBody = await response.clone().text() }
    catch (error) { result.http.responseReadError = String(error) }
    return response
  }
  const start = performance.now()
  try {
    const response = await ai.models.generateContent(request)
    result.response = response
    result.status = 'response_received'
    result.modelVersion = response.modelVersion ?? null
    result.finishReason = response.candidates?.[0]?.finishReason ?? null
    result.promptFeedback = response.promptFeedback ?? null
    result.usageMetadata = response.usageMetadata ?? null
    result.rawOutput = response.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('') || ''
    // API acceptance alone is NOT recognition, Mapping, or game success.
  } catch (error) {
    result.status = 'failed'
    result.error = visionErrorDiagnostic(error, 'Vision API diagnostic')
    result.httpStatus ??= result.error.httpStatus
  } finally {
    globalThis.fetch = realFetch
  }
  result.elapsedMs = Math.round(performance.now() - start)
  await writeFile(`${destination}.tmp`, JSON.stringify(result), { mode: 0o600 })
  await rename(`${destination}.tmp`, destination)
  console.log(JSON.stringify({ status: result.status, httpStatus: result.httpStatus, finishReason: result.finishReason, rawOutput: result.rawOutput,
    error: result.error, elapsedMs: result.elapsedMs, destination }, null, 2))
}
