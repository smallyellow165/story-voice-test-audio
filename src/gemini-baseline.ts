import './gemini-baseline.css'

const button = document.querySelector<HTMLButtonElement>('#run')!
const status = document.querySelector<HTMLParagraphElement>('#status')!
const result = document.querySelector<HTMLPreElement>('#result')!
const details = document.querySelector<HTMLPreElement>('#details')!

async function readResponse(response: Response) {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('请通过 npm run dev 启动 Node 服务；独立 Vite 服务不提供此 API。')
  }
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

async function loadStatus() {
  try {
    const data = await readResponse(await fetch('/api/gemini-baseline', { signal: AbortSignal.timeout(10000) }))
    document.querySelector('#model')!.textContent = data.model
    document.querySelector('#prompt')!.textContent = data.prompt
    status.textContent = data.apiKeyConfigured
      ? '服务端已配置 API Key。点击按钮发起一次真实调用。'
      : '服务端缺少 GEMINI_API_KEY：请配置项目 .env，重启服务后刷新页面。'
    button.disabled = !data.apiKeyConfigured
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '无法连接服务端。'
  }
}

button.addEventListener('click', async () => {
  button.disabled = true
  result.textContent = '等待模型响应…'
  details.textContent = '调用中…'
  status.textContent = '正在上传官方示例图片并调用 Gemini…'
  try {
    const data = await readResponse(await fetch('/api/gemini-baseline', {
      method: 'POST', signal: AbortSignal.timeout(210000),
    }))
    result.textContent = data.text || '模型未返回文字。'
    details.textContent = JSON.stringify(data, null, 2)
    status.textContent = data.ok
      ? `真实调用成功 · ${data.model} · ${(data.elapsedMs / 1000).toFixed(1)} 秒`
      : `调用已返回，但未正常完成：${data.finishReason || data.blockReason || '无候选结果'}`
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '请求失败。'
    result.textContent = '调用失败。'
    details.textContent = '没有成功的模型响应。'
  } finally {
    button.disabled = false
  }
})

void loadStatus()
