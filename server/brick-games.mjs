import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { parseSession } from '../src/brick-inventory/inventory.ts'
import { loadBrickRules, geometrySnapshot } from './brick-rules.mjs'
import { generateBrickDesign, validateBrickDesign, validateGeneratorInput, resolveBrickModel } from './brick-generator.mjs'
import { selectGameInventory } from './brick-game-selection.mjs'
import { resolveInventoryMapping } from './brick-mapping.mjs'
import { requestJson } from '../src/brick-inventory/api.mjs'

const uuid = /^[a-f0-9-]{36}$/
const hashDesign = design => createHash('sha256').update(JSON.stringify(design)).digest('hex')
function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }) }

export async function catalog(route, params) {
  const url = new URL(process.env.APPLICATION_SERVER_URL || 'http://127.0.0.1:8001')
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') fail('Application Server 地址配置无效。', 503)
  url.pathname = `/rebrickable-catalog/${route}`; url.search = new URLSearchParams(params).toString()
  return requestJson(url, { signal: AbortSignal.timeout(25000), redirect: 'error', headers: { Accept: 'application/json' } },
    `My-Good-GYM /rebrickable-catalog/${route}`, fetch, true)
}

export function createBrickGames(directory, { loadRules = loadBrickRules, getMetadata = catalog, generate = generateBrickDesign } = {}) {
  const inFlight = new Set()
  async function write(folder, id, value) {
    const dir = path.join(directory, folder); await mkdir(dir, { recursive: true })
    const temp = path.join(dir, `${id}.${randomUUID()}.tmp`)
    try { await writeFile(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await rename(temp, path.join(dir, `${id}.json`)) }
    finally { await rm(temp, { force: true }) }
  }
  async function read(folder, id) {
    if (!uuid.test(id || '')) fail('无效记录 ID。')
    try { return JSON.parse(await readFile(path.join(directory, folder, `${id}.json`), 'utf8')) }
    catch (e) { if (e.code === 'ENOENT') fail('记录不存在。', 404); throw e }
  }
  async function artifact(id) {
    const value = await read('designs', id), rules = await loadRules()
    if (value.schemaVersion !== 1 || value.id !== id || !value.generation?.ok
      || !value.review?.mapping?.valid
      || JSON.stringify(value.review.mapping.inventory) !== JSON.stringify(value.generatorInput?.inventory)
      || JSON.stringify(value.generation.requestInput?.inventory) !== JSON.stringify(value.generatorInput?.inventory)
      || value.generation.requestInput?.description !== value.generatorInput?.description
      || hashDesign(value.generation.design) !== value.designHash) fail('设计记录完整性校验失败。', 422)
    const confirmed = value.review.confirmation
    if (!confirmed || confirmed.accepted !== true || confirmed.reviewId !== value.review.id) fail('缺少库存子集确认记录。', 422)
    const selected = selectGameInventory(value.review, confirmed.items)
    if (JSON.stringify(selected.inventory) !== JSON.stringify(value.generatorInput.inventory)
      || JSON.stringify(selected.excluded) !== JSON.stringify(confirmed.excluded)) fail('库存子集证据不一致。', 422)
    if (JSON.stringify(value.geometrySnapshot) !== JSON.stringify(geometrySnapshot(rules, value.generatorInput.inventory)))
      fail('设计几何能力快照与当前规则不一致，请重新检查并生成。', 422)
    const report = validateBrickDesign(value.generation.design, value.generatorInput.inventory, rules)
    if (!report.valid) fail('设计已不满足当前 Validator，不能启动。', 422)
    return value
  }
  return {
    artifact,
    async review(body) {
      let session
      try { session = parseSession(body?.session) }
      catch (error) { fail(`Inventory Review / 库存输入：${error.message}`) }
      let rules
      try { rules = await loadRules() }
      catch { fail('Inventory Review / Validator 加载：无法加载现有 V2 规则，请检查 Test Audio 服务端依赖和源码。', 503) }
      if (!session.items.length) fail('所选库存为空。')
      const metadata = { parts: {}, colors: {} }
      // On-demand only, one lookup per distinct ID; the Application Server caches
      // official metadata and applies the same rate limit as image requests.
      for (const row of session.items) {
        for (const [kind, id, route, params] of [
          ['parts', row.part_num, 'mapping-part', { part_num: row.part_num }],
          ['colors', row.color_id, 'mapping-color', { color_id: String(row.color_id) }],
        ]) if (!metadata[kind][id]) {
          try { metadata[kind][id] = await getMetadata(route, params) }
          catch (error) { metadata[kind][id] = { status: 'metadata_request_failed',
            stage: error.stage || `My-Good-GYM /rebrickable-catalog/${route}`,
            httpStatus: error.httpStatus ?? null,
            message: error.statusCode ? error.message : 'Application Server 无法连接或响应超时。' } }
        }
      }
      const mapping = await resolveInventoryMapping(session, metadata, rules)
      // Resource failures affect only their source row, never the saved inventory.
      let codes = null
      try {
        const root = process.env.LDRAW_LIBRARY_PATH || '/home/umi/Documents/pg/gaming/lego-brick/complete/ldraw'
        const config = await readFile(path.join(root, 'LDConfig.ldr'), 'utf8')
        codes = new Set([...config.matchAll(/\bCODE\s+(\d+)\b/g)].map(match => match[1]))
      } catch { /* Explicit per-row exclusion below. */ }
      for (const row of mapping.rows) if (row.target && (!codes || !codes.has(row.target.color))) {
        row.errors.push(codes ? '本地 LDConfig.ldr 缺少颜色 ' + row.target.color : '本地 LDConfig.ldr 无法读取。')
        row.target = null
      }
      mapping.valid = mapping.rows.some(row => row.target && !row.errors.length)
      mapping.inventory = [] // Not generation inventory until explicit confirmation.
      mapping.issues = mapping.valid
        ? ['请检查不可用项目，并明确选择本次生成子集；完整库存不会改变。']
        : ['没有可用于游戏的库存项目，请查看各行原因。']
      const review = { schemaVersion: 1, id: randomUUID(), session, mapping }
      try { await write('reviews', review.id, review) }
      catch (error) {
        const code = ['EACCES', 'EPERM', 'ENOSPC', 'EROFS'].includes(error.code) ? error.code : 'WRITE_FAILED'
        fail(`Inventory Review / 保存检查记录：${code}；未保存成功，不能继续生成。`, 500)
      }
      return review
    },
    async generate(body) {
      let review = await read('reviews', body.reviewId)
      if (!review.mapping.valid) fail('库存映射未通过，不能生成。')
      if (body.confirmSelection !== true) fail('请明确确认本次生成库存子集。')
      let selected
      try { selected = selectGameInventory(review, body.selection) } catch (error) { fail(error.message) }
      if (inFlight.has(review.id)) fail('该库存检查已有生成请求正在进行。', 409)
      // One completed attempt per review: a timed-out browser never silently
      // sends a second LLM request. A deliberate new review permits a new attempt.
      try {
        const saved = await read('attempts', review.id)
        if (JSON.stringify(saved.confirmation.items) !== JSON.stringify(selected.items) || saved.generatorInput.description !== body.description || saved.generatorInput.model !== resolveBrickModel(body.model)) {
          fail('此检查记录已有另一生成请求；修改描述或模型后请重新检查库存。', 409)
        }
        return saved
      }
      catch (e) { if (e.statusCode !== 404) throw e }
      const rules = await loadRules()
      const input = { ...validateGeneratorInput({ description: body.description, inventory: selected.inventory }, rules), model: resolveBrickModel(body.model) }
      const geometry = geometrySnapshot(rules, input.inventory)
      for (const item of selected.items) {
        const row = review.mapping.rows.find(r => r.source.part_num === item.part_num && r.source.color_id === item.color_id)
        const checked = row.partCandidateChecks.find(c => c.part === row.target.part)?.capability?.geometry
        if (JSON.stringify(checked) !== JSON.stringify(rules.geometrySupport(row.target.part).geometry))
          fail('Review 的几何能力已改变，请重新检查库存。', 409)
      }
      inFlight.add(review.id)
      let lock
      try {
        await mkdir(path.join(directory, 'attempts'), { recursive: true })
        lock = path.join(directory, 'attempts', `${review.id}.lock`)
        try { await writeFile(lock, JSON.stringify({ input, startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 }) }
        catch (e) { if (e.code === 'EEXIST') fail('生成请求已提交或结果未知；请检查原请求，未再次调用模型。', 409); throw e }
        const confirmation = { accepted: true, reviewId: review.id, confirmedAt: new Date().toISOString(),
          items: selected.items, excluded: selected.excluded }
        review = { ...review, mapping: { ...review.mapping, inventory: input.inventory }, confirmation }
        await write('reviews', review.id, review)
        const result = await generate(input)
        let record = null
        if (result.body.ok) {
          const validation = validateBrickDesign(result.body.design, input.inventory, rules)
          if (!validation.valid) fail('生成结果复核失败。', 422)
          record = { schemaVersion: 1, id: randomUUID(), createdAt: new Date().toISOString(), review,
            generatorInput: input, geometrySnapshot: geometry, generation: result.body, designHash: hashDesign(result.body.design) }
          await write('designs', record.id, record)
        }
        const attempt = { reviewId: review.id, confirmation, geometrySnapshot: geometry, generatorInput: input, generation: result.body, artifact: record }
        await write('attempts', review.id, attempt)
        return attempt
      } finally { inFlight.delete(review.id) }
    },
    async list() {
      const files = await readdir(path.join(directory, 'designs')).catch(e => { if (e.code === 'ENOENT') return []; throw e })
      const result = []
      for (const file of files.filter(name => uuid.test(name.slice(0, -5)) && name.endsWith('.json'))) {
        const value = await read('designs', file.slice(0, -5))
        result.push({ id: value.id, name: value.generation.design.name, sessionName: value.review.session.name,
          sessionId: value.review.session.id, createdAt: value.createdAt, designHash: value.designHash })
      }
      return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
  }
}
