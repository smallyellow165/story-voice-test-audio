import { readingCaseMiddleware } from './server/reading-test-cases.mjs'
import { defineConfig } from 'vite'
import { brickLibraryPlugin } from './server/brick-library.mjs'
import { readingV2Middleware } from './server/reading-v2.mjs'
import { screencastMiddleware } from './server/screencast-transcode.mjs'
import { whisperAlignmentFixtureMiddleware } from './server/whisper-alignment-fixture.mjs'

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
  worker: { format: 'es' },
  plugins: [brickLibraryPlugin(), { name: 'reading-test-cases', configureServer(server) { server.middlewares.use(readingCaseMiddleware) }, configurePreviewServer(server) { server.middlewares.use(readingCaseMiddleware) } }, { name: 'reading-v2-cli', configureServer(server) { server.middlewares.use(readingV2Middleware) }, configurePreviewServer(server) { server.middlewares.use(readingV2Middleware) } }, {
    name: 'local-screencast-mp4',
    configureServer(server) { server.middlewares.use(screencastMiddleware) },
    configurePreviewServer(server) { server.middlewares.use(screencastMiddleware) },
  }, {
    name: 'local-whisper-alignment-fixture',
    configureServer(server) { server.middlewares.use(whisperAlignmentFixtureMiddleware) },
    configurePreviewServer(server) { server.middlewares.use(whisperAlignmentFixtureMiddleware) },
  }],
  server: { proxy: ringProxy },
  preview: { proxy: ringProxy },
  build: { rollupOptions: { input: { main: 'index.html', brickTest: 'brick-test.html', readingTracker: 'reading-tracker.html', fishTimestampDebug: 'fish-timestamp-debug.html', whisperAlignment: 'whisper-alignment.html', storybookMarker: 'storybook-marker.html', cameraSnapshot: 'camera-snapshot.html', imagePointDebug: 'image-point-debug.html', hopscotch: 'hopscotch.html', touchColor: 'touch-color.html', ringFeet: 'ring-feet.html', ringLlm: 'ring-llm.html', geminiBaseline: 'gemini-baseline.html', geminiOfficial: 'gemini-official.html', layoutBaseline: 'layout-baseline.html' } } },
})
