import { AsyncLocalStorage } from 'node:async_hooks'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const scope = new AsyncLocalStorage()
let installed = false
// SDK uses global fetch. Scope capture to this async request, never to other
// concurrent Gemini/HTTP traffic. Do not change provider bodies or headers.
export async function captureVisionWire(directory, record, persist, call) {
  if (!installed) {
    const transport = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const capture = scope.getStore()
      if (!capture) return transport(input, init)
      if (capture.called) throw new Error('Vision 禁止重复 HTTP 请求')
      capture.called = true
      const { record: r, directory: dir, persist: save } = capture
      if (typeof init?.body !== 'string') throw new Error('无法完整保存 Vision HTTP 请求正文，未发送')
      const url = new URL(input instanceof Request ? input.url : String(input))
      r.endpoint = url.origin + url.pathname
      r.rawRequestPath = path.resolve(dir, `${r.id}.request.json`)
      await writeFile(r.rawRequestPath, init.body, { flag: 'wx', mode: 0o600 })
      r.wireStatus = 'request_saved'
      await save()
      let response
      try { response = await transport(input, init) }
      catch (error) {
        r.wireStatus = 'no_response'
        r.transportError = error?.name || 'TransportError'
        await save()
        throw error
      }
      r.httpStatus = response.status
      r.rawResponsePath = path.resolve(dir, `${r.id}.response.txt`)
      try {
        const body = await response.clone().text()
        await writeFile(r.rawResponsePath, body, { flag: 'wx', mode: 0o600 })
        r.wireStatus = 'response_saved'
      } catch (error) {
        r.wireStatus = 'response_capture_failed'
        r.responseCaptureError = String(error)
        await save()
        throw error
      }
      await save() // Durable before SDK JSON parsing or business validation.
      return response
    }
    installed = true
  }
  return scope.run({ directory, record, persist, called: false }, call)
}
