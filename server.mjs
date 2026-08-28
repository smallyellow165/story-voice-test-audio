import { createServer } from 'node:http'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import textToSpeech from '@google-cloud/text-to-speech'
import { createServer as createViteServer } from 'vite'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const generatedDirectory = path.join(projectRoot, 'generated')
const generatedAudioDirectory = path.join(projectRoot, 'generated', 'test-audio')
const metadataFile = path.join(generatedDirectory, 'metadata.json')
const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? 5173)
const maxRequestBytes = 32 * 1024
const maxInputBytes = 8_000

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: 'spa',
})

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}

const readMetadata = async () => {
  try {
    const contents = await readFile(metadataFile, 'utf8')
    const records = JSON.parse(contents)
    if (!Array.isArray(records)) throw new Error('Generated audio metadata must be a JSON array.')
    return records
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

const writeMetadata = async (records) => {
  await mkdir(generatedDirectory, { recursive: true })
  await writeFile(metadataFile, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
}

let metadataWriteQueue = Promise.resolve()
const appendMetadataRecord = (record) => {
  const write = metadataWriteQueue.then(async () => {
    const records = await readMetadata()
    records.unshift(record)
    await writeMetadata(records)
    return record
  })
  metadataWriteQueue = write.catch(() => undefined)
  return write
}

const localTimestamp = (date) => {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const pad = (value) => String(Math.abs(value)).padStart(2, '0')
  const offsetHours = pad(Math.trunc(offset / 60))
  const offsetMinutes = pad(offset % 60)
  const datePart = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const timePart = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return {
    idPrefix: `${datePart}-${timePart}`,
    createdAt: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${offsetHours}:${offsetMinutes}`,
  }
}

const readJsonBody = (request) => new Promise((resolve, reject) => {
  let size = 0
  const chunks = []

  request.on('data', (chunk) => {
    size += chunk.length
    if (size > maxRequestBytes) {
      reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413 }))
      request.destroy()
      return
    }
    chunks.push(chunk)
  })
  request.on('end', () => {
    try {
      resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } catch {
      reject(Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }))
    }
  })
  request.on('error', reject)
})

const hasLocalApplicationDefaultCredentials = async () => {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true
  const gcloudConfigDirectory = process.env.CLOUDSDK_CONFIG ?? path.join(homedir(), '.config', 'gcloud')
  try {
    await access(path.join(gcloudConfigDirectory, 'application_default_credentials.json'), constants.R_OK)
    return true
  } catch {
    return false
  }
}

const toPublicError = (error) => {
  const message = String(error?.message ?? '')
  const details = String(error?.details ?? '')
  const context = `${message} ${details}`.toLowerCase()

  if (error?.code === 16 || /could not load the default credentials|application default credentials|unauthenticated/.test(context)) {
    return {
      statusCode: 401,
      code: 'GOOGLE_AUTH_REQUIRED',
      message: 'Google Cloud authentication is unavailable. Configure Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS on the server.',
    }
  }
  if (error?.code === 8 || /quota|resource exhausted/.test(context)) {
    return {
      statusCode: 429,
      code: 'GOOGLE_QUOTA_EXCEEDED',
      message: 'Google Cloud Text-to-Speech quota was exceeded. Check the project quota and try again later.',
    }
  }
  if (error?.code === 7 && /billing|consumer|serviceusage/.test(context)) {
    return {
      statusCode: 403,
      code: 'GOOGLE_BILLING_OR_PROJECT_ACCESS',
      message: 'Google Cloud billing or project access is not configured for Cloud Text-to-Speech.',
    }
  }
  if (error?.code === 7 || /permission denied/.test(context)) {
    return {
      statusCode: 403,
      code: 'GOOGLE_PERMISSION_DENIED',
      message: 'The server credential does not have permission to use Cloud Text-to-Speech.',
    }
  }
  if (error?.code === 3 || /model.*not found|model.*unavailable|unsupported.*model/.test(context)) {
    return {
      statusCode: 422,
      code: 'GOOGLE_MODEL_UNAVAILABLE',
      message: 'The requested Gemini TTS model or voice is unavailable for this Google Cloud project or region.',
    }
  }
  if (error?.code === 14 || /unavailable|deadline exceeded/.test(context)) {
    return {
      statusCode: 503,
      code: 'GOOGLE_TTS_UNAVAILABLE',
      message: 'Cloud Text-to-Speech is temporarily unavailable. Please try again.',
    }
  }
  return {
    statusCode: 502,
    code: 'GOOGLE_TTS_REQUEST_FAILED',
    message: 'Cloud Text-to-Speech rejected the request. Check the server console for non-secret error context.',
  }
}

const handleTestTts = async (request, response) => {
  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    sendJson(response, error.statusCode ?? 400, { error: { code: 'INVALID_REQUEST', message: error.message } })
    return
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const voice = typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : 'Achernar'
  const style = typeof body.style === 'string' ? body.style.trim() : ''

  if (!text) {
    sendJson(response, 400, { error: { code: 'TEXT_REQUIRED', message: 'Text is required.' } })
    return
  }
  if (Buffer.byteLength(text, 'utf8') + Buffer.byteLength(style, 'utf8') > maxInputBytes) {
    sendJson(response, 400, { error: { code: 'TEXT_TOO_LONG', message: 'Text and style instructions must total 8,000 bytes or fewer.' } })
    return
  }
  if (!/^[A-Za-z0-9-]+$/.test(voice)) {
    sendJson(response, 400, { error: { code: 'INVALID_VOICE', message: 'Voice must contain only letters, numbers, and hyphens.' } })
    return
  }
  if (!(await hasLocalApplicationDefaultCredentials())) {
    sendJson(response, 401, {
      error: {
        code: 'GOOGLE_AUTH_REQUIRED',
        message: 'Google Cloud authentication is unavailable. Run gcloud auth application-default login or set GOOGLE_APPLICATION_CREDENTIALS on the server.',
      },
    })
    return
  }

  const client = new textToSpeech.TextToSpeechClient({ fallback: true })
  try {
    const [result] = await client.synthesizeSpeech({
      input: { text, prompt: style || undefined },
      voice: {
        languageCode: 'cmn-CN',
        name: voice,
        modelName: 'gemini-3.1-flash-tts-preview',
      },
      audioConfig: { audioEncoding: 'MP3' },
    })
    if (!result.audioContent) throw new Error('Cloud Text-to-Speech returned an empty audio response.')

    await mkdir(generatedAudioDirectory, { recursive: true })
    const timestamp = localTimestamp(new Date())
    const id = `${timestamp.idPrefix}-${crypto.randomUUID().slice(0, 8)}`
    const filename = `${id}-${voice.toLowerCase()}.mp3`
    await writeFile(path.join(generatedAudioDirectory, filename), result.audioContent)

    const record = await appendMetadataRecord({
      id,
      voice,
      script: text,
      audioFile: filename,
      createdAt: timestamp.createdAt,
    })

    sendJson(response, 201, {
      url: `/generated/test-audio/${filename}`,
      format: 'audio/mpeg',
      model: 'gemini-3.1-flash-tts-preview',
      languageCode: 'cmn-CN',
      voice,
      bytes: result.audioContent.length,
      record,
    })
  } catch (error) {
    const publicError = toPublicError(error)
    console.error('Google Cloud TTS request failed', {
      code: error?.code,
      details: error?.details,
      message: error?.message,
    })
    sendJson(response, publicError.statusCode, { error: { code: publicError.code, message: publicError.message } })
  } finally {
    await client.close().catch(() => undefined)
  }
}

const serveGeneratedAudio = async (pathname, response) => {
  const filename = path.basename(pathname)
  if (!/^[a-z0-9-]+\.mp3$/i.test(filename)) {
    response.writeHead(404).end()
    return
  }
  try {
    const audio = await readFile(path.join(generatedAudioDirectory, filename))
    response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' })
    response.end(audio)
  } catch {
    response.writeHead(404).end()
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (url.pathname === '/api/test-audio') {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for /api/test-audio.' } })
      return
    }
    try {
      sendJson(response, 200, { records: await readMetadata() })
    } catch (error) {
      console.error('Generated audio metadata could not be read', { code: error?.code, message: error?.message })
      sendJson(response, 500, { error: { code: 'METADATA_READ_FAILED', message: 'Generated audio metadata could not be read.' } })
    }
    return
  }

  if (url.pathname === '/api/test-tts') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for /api/test-tts.' } })
      return
    }
    await handleTestTts(request, response)
    return
  }
  if (url.pathname.startsWith('/generated/test-audio/')) {
    await serveGeneratedAudio(url.pathname, response)
    return
  }
  vite.middlewares(request, response)
})

server.listen(port, host, () => {
  console.log(`Voice test server listening on http://localhost:${port}${vite.config.base}`)
})
