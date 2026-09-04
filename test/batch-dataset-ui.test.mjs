import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const mainSource = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

test('Video V2 exposes Video Library and Batch Input tabs with an editable five-column table', () => {
  assert.match(mainSource, /role="tab" aria-selected="true"[^>]*>Video Library<\/button>/)
  assert.match(mainSource, /role="tab" aria-selected="false"[^>]*>Batch Input<\/button>/)
  assert.match(mainSource, /<th>Label<\/th><th>Start<\/th><th>End<\/th><th>URL<\/th><th>Action<\/th>/)
  assert.match(mainSource, /\+ Add Row/)
  assert.match(mainSource, /Import &amp; Process/)
})

test('Batch processing reuses the existing storage and browser Pose operations', () => {
  assert.match(mainSource, /findExistingSourceVideo\(videoLibrary\.videos, sourceUrl\)/)
  assert.match(mainSource, /requestSourceDownload\(sourceUrl\)/)
  assert.match(mainSource, /createClipRecord\(source\.videoId/)
  assert.match(mainSource, /videoStorage\.generateClip\(source\.videoId, clip\.clipId\)/)
  assert.match(mainSource, /analyzeAndSavePose\(source\.videoId, clip\.clipId, clip\.relativePath\)/)
  assert.match(mainSource, /videoStorage\.buildLlmPoseResult\(source\.videoId, clip\.clipId, poseRun\.poseRunId\)/)
})
