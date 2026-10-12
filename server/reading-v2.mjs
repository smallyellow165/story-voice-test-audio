import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../story-voice-pipecat-poc-v4/server/', import.meta.url))
export function runV2(payload, { python = `${root}.venv-reading-v2/bin/python`, cwd = root, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-B', '-m', 'src.reading_tracker_v2'], { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = '', done = false
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(value) }
    const timer = setTimeout(() => { child.kill(); finish(new Error('V2 CLI 超时')) }, timeout)
    child.on('error', e => finish(new Error(`V2 Python 不可用：${e.message}`)))
    child.stdin.on('error', () => {})
    child.stdout.on('data', data => { out += data; if (out.length > 16000000) { child.kill(); finish(new Error('V2 输出过大')) } })
    child.stderr.on('data', data => { err = (err + data).slice(-8000) })
    child.on('close', code => {
      if (code !== 0) return finish(new Error(`V2 CLI (${code}): ${err}`))
      try { finish(null, JSON.parse(out)) } catch { finish(new Error('V2 CLI 返回无效 JSON')) }
    })
    child.stdin.end(JSON.stringify(payload))
  })
}
export function readingV2Middleware(req, res, next) {
  if (req.url?.split('?')[0] !== '/api/debug/reading-v2/match') return next()
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)) }
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return send(403, { error: 'localhost only' })
  if (req.method !== 'POST') return send(405, { error: 'POST required' })
  if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'application/json required' })
  let body = '', oversized = false
  req.on('data', chunk => { if (oversized) return; body += chunk; if (body.length > 256000) { oversized = true; body = '' } })
  req.on('end', async () => {
    if (oversized) return send(413, { error: '输入超过 256 KB' })
    try {
      const payload = JSON.parse(body)
      if (!Array.isArray(payload.sequence) || payload.sequence.length > 256 || typeof payload.reference !== 'string' || payload.reference.length > 20000) throw new Error('需要 Reference 和最多 256 条 P/F 事件')
      send(200, await runV2(payload))
    } catch (e) { send(400, { error: e.message }) }
  })
}
