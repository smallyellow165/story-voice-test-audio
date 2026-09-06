import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/style.css', import.meta.url), 'utf8')

test('Classifier Lab is a third horizontal right-panel tab with an explicit load stage', () => {
  assert.match(source, /id="video-tools-tab"[^>]*>Video<\/button>[\s\S]*id="pose-harvest-tab"[^>]*>Pose Harvest<\/button>[\s\S]*id="classifier-tab"[^>]*>Classifier<\/button>/)
  assert.match(styles, /\.video-v2-right-tabs[^}]*grid-template-columns: repeat\(3,/)
  assert.match(source, /id="classifier-load"[^>]*>Load Classifier<\/button>/)
  assert.match(source, /CSV 33×3 landmarks → FullBodyPoseEmbedder → normalization → 23-vector embedding → KNN ready/)
  assert.doesNotMatch(source, />Train Model<|>Normalize Dataset</)
})

test('Load Classifier reads both existing CSVs and delegates preparation to PoseClassifier', () => {
  assert.match(source, /import\('\.\.\/test\/fixtures\/pose-classifier\/star-jump\/star_open\.csv\?raw'\)/)
  assert.match(source, /import\('\.\.\/test\/fixtures\/pose-classifier\/star-jump\/star_close\.csv\?raw'\)/)
  assert.match(source, /PoseClassifier\.fromCsvFiles\(/)
  assert.match(source, /classifier\.samples\.filter\(\(sample\) => sample\.className === 'star_open'\)\.length/)
  assert.match(source, /classifier\.samples\.filter\(\(sample\) => sample\.className === 'star_close'\)\.length/)
})

test('Raw Pose Run selection and classification reuse the existing unseen pipeline', () => {
  assert.match(source, /data-history-action="use-classifier"[^>]*data-pose-run-id=/)
  assert.match(source, /action === 'use-classifier'[\s\S]*setClassifierContext\(updatedRecord, poseRun\)[\s\S]*startPoseReplay\(updatedRecord, poseRun\)/)
  assert.match(source, /classifyUnseenStarJumpFrames\(\{[\s\S]*classifier: starJumpClassifier/)
  assert.match(source, /summarizeUnseenStarJump\(classifierFrames\)/)
  assert.match(source, /data-classifier-seek=/)
  assert.match(source, /video\.currentTime = Math\.min\(video\.duration, Math\.max\(0, seekMs \/ 1000\)\)/)
})

test('Training Set exposes expandable provenance rows that open Pose Replay and seek by Raw Pose timestamp', () => {
  assert.match(source, /data-training-samples-toggle="star_open"[^>]*>Show Samples<\/button>/)
  assert.match(source, /data-training-samples-toggle="star_close"[^>]*>Show Samples<\/button>/)
  assert.match(source, /<th>Frame<\/th><th>Timestamp<\/th><th>Source<\/th><th>Action<\/th>/)
  assert.match(source, /buildTrainingSampleProvenance\(classifier\.samples, trainingRawPose\)/)
  assert.match(source, /action[^]*data-training-sample=/i)
  assert.match(source, /openStoredPoseReplay[\s\S]*startPoseReplay\(clip, storedPoseRun\)/)
  assert.match(source, /inspectTrainingSample[\s\S]*openStoredPoseReplay\(sample\.videoId, sample\.clipId, sample\.poseRunId\)[\s\S]*seekVideoAfterMetadata\(sample\.videoTimestampMs\)/)
})
