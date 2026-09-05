import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

import { exportExtendedPoseDataset, starJumpPoseAnchors } from '../src/star-jump-dataset-exporter.ts'

const run = promisify(execFile)
const testVideoRoot = new URL('../public/test-videos/', import.meta.url)
const rawPoseUrl = new URL('video-006/pose/video-006_clip-001_pose-001.json', testVideoRoot)
const clipUrl = new URL('video-006/clips/video-006_clip-001.mp4', testVideoRoot)
const outputDirectory = new URL('../test/fixtures/pose-classifier/star-jump/', import.meta.url)

const rawPose = JSON.parse(await readFile(rawPoseUrl, 'utf8'))
const { stdout } = await run('ffprobe', [
  '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', clipUrl.pathname,
])
const stream = JSON.parse(stdout).streams?.[0]
if (!Number.isFinite(stream?.width) || !Number.isFinite(stream?.height)) {
  throw new Error('Could not resolve generated clip dimensions with ffprobe.')
}

const dataset = exportExtendedPoseDataset({
  frames: rawPose.frames,
  poseRunId: rawPose.source.poseRunId,
  frameWidth: stream.width,
  frameHeight: stream.height,
  anchors: starJumpPoseAnchors,
})

await mkdir(outputDirectory, { recursive: true })
await Promise.all(Object.entries(dataset.csvByClass).map(([className, csv]) =>
  writeFile(new URL(`${className}.csv`, outputDirectory), csv)))

console.log(JSON.stringify({
  rawPoseArtifact: rawPoseUrl.pathname,
  dimensions: { width: stream.width, height: stream.height },
  anchorMatches: dataset.anchorMatches,
  samplesByClass: Object.fromEntries(Object.entries(dataset.csvByClass).map(([className, csv]) => [
    className,
    csv.trim() ? csv.trim().split('\n').length : 0,
  ])),
}, null, 2))
