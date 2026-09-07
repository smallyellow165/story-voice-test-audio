import { defineConfig } from 'vite'

const base = '/story-voice-test-audio/'
const ringProxy = {
  [`${base}ring-api`]: {
    target: 'http://127.0.0.1:8766',
    rewrite: (path: string) => path.replace(`${base}ring-api`, ''),
  },
}

export default defineConfig({
  base,
  server: { proxy: ringProxy },
  preview: { proxy: ringProxy },
  build: { rollupOptions: { input: { main: 'index.html', ringFeet: 'ring-feet.html' } } },
})
