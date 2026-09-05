import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const host = '127.0.0.1'
const port = 5190
const baseUrl = `http://${host}:${port}/story-voice-test-audio`
const pageUrl = `${baseUrl}/test/pose-classifier-e2e.html`

const waitForServer = async () => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await new Promise((resolve) => {
      const check = request(baseUrl, { method: 'HEAD' }, (response) => {
        response.resume()
        resolve((response.statusCode ?? 500) < 500)
      })
      check.on('error', () => resolve(false))
      check.end()
    })
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Timed out starting the Vite E2E server.')
}

const wait = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs))

const readDevtoolsPort = async (profileDirectory) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const [port] = (await readFile(join(profileDirectory, 'DevToolsActivePort'), 'utf8')).split('\n')
      if (port) return Number(port)
    } catch {}
    await wait(100)
  }
  throw new Error('Timed out connecting to headless Chrome.')
}

const connectCdp = (url) => new Promise((resolve, reject) => {
  const socket = new WebSocket(url)
  const pending = new Map()
  let nextId = 1
  socket.addEventListener('error', () => reject(new Error('Could not connect to Chrome DevTools.')), { once: true })
  socket.addEventListener('open', () => {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const callback = pending.get(message.id)
      if (!callback) return
      pending.delete(message.id)
      if (message.error) callback.reject(new Error(message.error.message))
      else callback.resolve(message.result)
    })
    resolve({
      close: () => socket.close(),
      send: (method, params = {}) => new Promise((resolveCommand, rejectCommand) => {
        const id = nextId
        nextId += 1
        pending.set(id, { resolve: resolveCommand, reject: rejectCommand })
        socket.send(JSON.stringify({ id, method, params }))
      }),
    })
  }, { once: true })
})

const runChrome = async () => {
  const profileDirectory = await mkdtemp(join(tmpdir(), 'story-voice-pose-e2e-'))
  const chrome = spawn('/usr/bin/google-chrome', [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDirectory}`,
    pageUrl,
  ], { stdio: ['ignore', 'ignore', 'inherit'] })
  let cdp
  try {
    const debuggingPort = await readDevtoolsPort(profileDirectory)
    let target
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const targets = await fetch(`http://${host}:${debuggingPort}/json/list`).then((response) => response.json())
      target = targets.find((item) => item.type === 'page' && item.url === pageUrl)
      if (target) break
      await wait(100)
    }
    if (!target?.webSocketDebuggerUrl) throw new Error('Could not find the pose E2E browser page.')
    cdp = await connectCdp(target.webSocketDebuggerUrl)
    await cdp.send('Runtime.enable')
    const deadline = Date.now() + 10 * 60 * 1000
    while (Date.now() < deadline) {
      const response = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const element = document.querySelector('#result');
          return element ? { status: element.dataset.status, text: element.textContent } : null;
        })()`,
        returnByValue: true,
      })
      const pageResult = response.result?.value
      if (pageResult?.status && pageResult.status !== 'pending') {
        return { status: pageResult.status, payload: JSON.parse(pageResult.text) }
      }
      await wait(1_000)
    }
    throw new Error('Real push-ups browser E2E timed out after 10 minutes.')
  } finally {
    cdp?.close()
    const chromeExited = new Promise((resolve) => chrome.once('exit', resolve))
    chrome.kill('SIGTERM')
    await Promise.race([chromeExited, wait(2_000)])
    await rm(profileDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}

const server = spawn(process.execPath, ['./node_modules/vite/bin/vite.js', '--host', host, '--port', String(port), '--strictPort'], {
  stdio: ['ignore', 'ignore', 'inherit'],
})

try {
  await waitForServer()
  const { status, payload } = await runChrome()
  console.log(JSON.stringify(payload, null, 2))
  if (status !== 'passed') {
    throw new Error(status === 'failed'
      ? `Real push-ups E2E assertions failed; repetitions=${payload.repetitions}, frames=${payload.frameCount}.`
      : payload.error ?? 'Real push-ups E2E failed.')
  }
} finally {
  server.kill('SIGTERM')
}
