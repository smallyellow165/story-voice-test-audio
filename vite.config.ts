import { defineConfig } from 'vite'
import { screencastMiddleware } from './server/screencast-transcode.mjs'

const base = '/story-voice-test-audio/'
// Frozen OpenCV Legacy route only; Gemini/History and Activity messaging do not use 8766.
const ringProxy = {
  [`${base}ring-api`]: {
    target: 'http://127.0.0.1:8766',
    rewrite: (path: string) => path.replace(`${base}ring-api`, ''),
  },
}

export default defineConfig({
  base,
  plugins: [{
    name: 'local-screencast-mp4',
    configureServer(server) { server.middlewares.use(screencastMiddleware) },
    configurePreviewServer(server) { server.middlewares.use(screencastMiddleware) },
  }],
  server: { proxy: ringProxy },
  preview: { proxy: ringProxy },
  build: { rollupOptions: { input: { main: 'index.html', ringFeet: 'ring-feet.html', ringLlm: 'ring-llm.html', geminiBaseline: 'gemini-baseline.html', geminiOfficial: 'gemini-official.html', layoutBaseline: 'layout-baseline.html' } } },
})
