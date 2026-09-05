import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Video Library source summaries prominently render the persisted Video ID', async () => {
  const [mainSource, styles] = await Promise.all([
    readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/style.css', import.meta.url), 'utf8'),
  ])

  assert.match(mainSource, /video-library-video-id">Video ID: \$\{escapeHtml\(record\.videoId\)\}/)
  assert.match(styles, /\.video-library-summary \.video-library-video-id \{ color: var\(--ink\); font-size: 0\.64rem; font-weight: 700; \}/)
})
