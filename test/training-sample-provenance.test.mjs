import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { loadPoseSamplesFromCsvFiles } from '../src/pose-classifier.ts'
import {
  buildTrainingSampleProvenance,
  parseTrainingSampleName,
} from '../src/training-sample-provenance.ts'

const fixtureRoot = new URL('./fixtures/pose-classifier/star-jump/', import.meta.url)
const rawPose = JSON.parse(await readFile(
  new URL('../public/test-videos/video-006/pose/video-006_clip-001_pose-001.json', import.meta.url),
  'utf8',
))

test('parses the exporter sample name without guessing source identity', () => {
  assert.deepEqual(parseTrainingSampleName('video-006_clip-001_pose-001_frame-028_933ms'), {
    poseRunId: 'video-006_clip-001_pose-001',
    frameIndex: 28,
    encodedTimestampMs: 933,
  })
  assert.throws(() => parseTrainingSampleName('frame-28'), /Unsupported training sample name/)
})

test('resolves sample timestamps and source IDs from the Raw Pose artifact', async () => {
  const contents = await readFile(new URL('star_open.csv', fixtureRoot), 'utf8')
  const samples = loadPoseSamplesFromCsvFiles([{ fileName: 'star_open.csv', contents }])
  const provenance = buildTrainingSampleProvenance(samples, rawPose)

  assert.equal(provenance.length, 25)
  assert.deepEqual(provenance[0], {
    videoId: 'video-006',
    clipId: 'video-006_clip-001',
    poseRunId: 'video-006_clip-001_pose-001',
    frameIndex: 28,
    encodedTimestampMs: 933,
    className: 'star_open',
    sampleName: 'video-006_clip-001_pose-001_frame-028_933ms',
    videoTimestampMs: 933.333333,
  })
  assert.equal(provenance[2].frameIndex, 30)
  assert.equal(provenance[2].videoTimestampMs, rawPose.frames[30].videoTimestampMs)
  assert.ok(provenance.every((sample) =>
    sample.encodedTimestampMs === Math.round(rawPose.frames[sample.frameIndex].videoTimestampMs)))
})
