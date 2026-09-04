import assert from 'node:assert/strict'
import test from 'node:test'

import { getClipRuns } from '../src/video-run-history.mjs'

const clipId = 'video-001_clip-001'
const pose = (number, createdAt) => ({
  poseRunId: `${clipId}_pose-${number}`,
  videoId: 'video-001',
  clipId,
  createdAt,
})
const llm = (poseNumber, number, createdAt) => ({
  llmPoseRunId: `${clipId}_pose-${poseNumber}_llm-${number}`,
  poseRunId: `${clipId}_pose-${poseNumber}`,
  videoId: 'video-001',
  clipId,
  createdAt,
})

test('returns every Pose and LLM Pose Run for a Clip with stable ordering', () => {
  const library = {
    poseRuns: [pose('002', '2026-01-01T00:00:02Z'), pose('001', '2026-01-01T00:00:01Z')],
    llmPoseRuns: [
      llm('002', '002', '2026-01-01T00:00:04Z'),
      llm('001', '001', '2026-01-01T00:00:01Z'),
      llm('002', '001', '2026-01-01T00:00:03Z'),
    ],
  }

  const runs = getClipRuns(library, clipId)

  assert.deepEqual(runs.poseRuns.map((run) => run.poseRunId), [
    `${clipId}_pose-001`,
    `${clipId}_pose-002`,
  ])
  assert.deepEqual(runs.llmPoseRuns.map((run) => [run.llmPoseRunId, run.poseRunId]), [
    [`${clipId}_pose-001_llm-001`, `${clipId}_pose-001`],
    [`${clipId}_pose-002_llm-001`, `${clipId}_pose-002`],
    [`${clipId}_pose-002_llm-002`, `${clipId}_pose-002`],
  ])
})
