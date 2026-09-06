import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Video V2 exposes horizontal Video and Pose Harvest tabs with seekable results', async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/style.css', import.meta.url), 'utf8'),
  ])
  assert.match(source, /id="video-tools-tab"[^>]*role="tab"/)
  assert.match(source, /id="pose-harvest-tab"[^>]*role="tab"/)
  assert.match(source, /id="pose-harvest-add-a"[^>]*>Add Current Frame</)
  assert.match(source, /id="pose-harvest-add-b"[^>]*>Add Current Frame</)
  assert.match(source, /data-harvest-seek=/)
  assert.match(source, /video\.currentTime = Math\.min/)
  assert.match(styles, /\.video-v2-right-tabs[^}]*grid-template-columns:/)
})
