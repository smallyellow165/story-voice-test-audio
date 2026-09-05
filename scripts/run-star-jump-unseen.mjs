import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

import { PoseClassifier } from '../src/pose-classifier.ts'
import {
  classifyUnseenStarJumpFrames,
  summarizeUnseenStarJump,
} from '../src/star-jump-unseen.ts'

const run = promisify(execFile)
const testVideoRoot = new URL('../public/test-videos/', import.meta.url)
const rawPoseUrl = new URL('video-007/pose/video-007_clip-001_pose-001.json', testVideoRoot)
const clipUrl = new URL('video-007/clips/video-007_clip-001.mp4', testVideoRoot)
const trainingRoot = new URL('../test/fixtures/pose-classifier/star-jump/', import.meta.url)
const outputUrl = new URL('../generated/star-jump-unseen/video-007_clip-001_pose-001.json', import.meta.url)

const [rawPoseContents, trainingFiles, dimensions] = await Promise.all([
  readFile(rawPoseUrl, 'utf8'),
  Promise.all(['star_close.csv', 'star_open.csv'].map(async (fileName) => ({
    fileName,
    contents: await readFile(new URL(fileName, trainingRoot), 'utf8'),
  }))),
  run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', clipUrl.pathname,
  ]).then(({ stdout }) => JSON.parse(stdout).streams?.[0]),
])
const rawPose = JSON.parse(rawPoseContents)
if (!Number.isFinite(dimensions?.width) || !Number.isFinite(dimensions?.height)) {
  throw new Error('Could not resolve the unseen clip dimensions with ffprobe.')
}

const classifier = PoseClassifier.fromCsvFiles(trainingFiles)
const frames = classifyUnseenStarJumpFrames({
  frames: rawPose.frames,
  frameWidth: dimensions.width,
  frameHeight: dimensions.height,
  classifier,
})
const summary = summarizeUnseenStarJump(frames)
const output = {
  source: {
    videoId: rawPose.source.videoId,
    clipId: rawPose.source.clipId,
    poseRunId: rawPose.source.poseRunId,
    rawPoseRelativePath: 'video-007/pose/video-007_clip-001_pose-001.json',
    clipRelativePath: rawPose.source.clipRelativePath,
    frameWidth: dimensions.width,
    frameHeight: dimensions.height,
  },
  trainingSamples: Object.fromEntries(trainingFiles.map(({ fileName, contents }) => [
    fileName.slice(0, -4),
    contents.trim().split('\n').filter(Boolean).length,
  ])),
  rawFrameCount: rawPose.frameCount,
  detectedPoseFrameCount: rawPose.detectedPoseFrameCount,
  classifiedFrameCount: frames.length,
  ...summary,
  frames,
}

await mkdir(new URL('.', outputUrl), { recursive: true })
await writeFile(outputUrl, `${JSON.stringify(output, null, 2)}\n`)
console.log(JSON.stringify({ outputPath: outputUrl.pathname, ...output, frames: undefined }, null, 2))
