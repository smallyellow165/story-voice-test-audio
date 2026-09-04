import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [styles, panels] = await Promise.all([
  readFile(new URL('../src/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/video-v2-panels.tsx', import.meta.url), 'utf8'),
])

test('history action rows reserve horizontal space and never wrap', () => {
  assert.match(styles, /\.history-run-table \{ min-width: 800px;/)
  assert.match(styles, /\.history-pose-run-table th:nth-child\(6\) \{ width: 52%; \}/)
  assert.match(styles, /\.history-row-actions \{ display: flex; width: max-content; flex-wrap: nowrap;/)
  assert.match(styles, /\.history-run-table td:last-child \{ overflow: visible; white-space: nowrap; \}/)
})

test('Video V2 gives the center workspace the largest default panel', () => {
  assert.match(panels, /id="video-v2-left"[\s\S]*defaultSize="22%"/)
  assert.match(panels, /id="video-v2-center"[\s\S]*defaultSize="58%"/)
  assert.match(panels, /id="video-v2-right"[\s\S]*defaultSize="20%"/)
})
