import assert from 'node:assert/strict'
import test from 'node:test'

import {
  findAppendedRun,
  getClipRunSelection,
  selectLlmPoseRun,
  selectPoseRun,
} from '../src/video-run-selection.mjs'

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

const library = () => ({
  poseRuns: [pose('001', '2026-01-01T00:00:01Z'), pose('002', '2026-01-01T00:00:02Z')],
  llmPoseRuns: [
    llm('001', '001', '2026-01-01T00:00:01Z'),
    llm('002', '001', '2026-01-01T00:00:02Z'),
    llm('002', '002', '2026-01-01T00:00:03Z'),
  ],
})

test('defaults to latest Pose and latest child LLM Run while exposing complete histories', () => {
  const poseSelections = new Map()
  const llmSelections = new Map()
  const view = getClipRunSelection(library(), clipId, poseSelections, llmSelections)

  assert.equal(view.poseRuns.length, 2)
  assert.equal(view.selectedPoseRun.poseRunId, `${clipId}_pose-002`)
  assert.deepEqual(view.llmPoseRuns.map((run) => run.llmPoseRunId), [
    `${clipId}_pose-002_llm-001`,
    `${clipId}_pose-002_llm-002`,
  ])
  assert.equal(view.selectedLlmPoseRun.llmPoseRunId, `${clipId}_pose-002_llm-002`)
})

test('Pose selection changes every selected action target and filters LLM history by parent', () => {
  const value = library()
  const poseSelections = new Map()
  const llmSelections = new Map()
  selectPoseRun(value, clipId, `${clipId}_pose-001`, poseSelections)
  const view = getClipRunSelection(value, clipId, poseSelections, llmSelections)

  assert.equal(view.selectedPoseRun.poseRunId, `${clipId}_pose-001`)
  assert.deepEqual(view.llmPoseRuns.map((run) => run.llmPoseRunId), [`${clipId}_pose-001_llm-001`])
  assert.equal(view.selectedLlmPoseRun.llmPoseRunId, `${clipId}_pose-001_llm-001`)
})

test('newly appended Pose and LLM Runs can be selected explicitly', () => {
  const value = library()
  const poseSelections = new Map()
  const llmSelections = new Map()
  const beforePoseIds = new Set(value.poseRuns.map((run) => run.poseRunId))
  value.poseRuns.push(pose('003', '2026-01-01T00:00:04Z'))
  const appendedPose = findAppendedRun(beforePoseIds, value.poseRuns, 'poseRunId')
  selectPoseRun(value, clipId, appendedPose.poseRunId, poseSelections)
  assert.equal(getClipRunSelection(value, clipId, poseSelections, llmSelections).selectedPoseRun.poseRunId, `${clipId}_pose-003`)

  selectPoseRun(value, clipId, `${clipId}_pose-002`, poseSelections)
  const beforeLlmIds = new Set(value.llmPoseRuns.map((run) => run.llmPoseRunId))
  value.llmPoseRuns.push(llm('002', '003', '2026-01-01T00:00:05Z'))
  const appendedLlm = findAppendedRun(beforeLlmIds, value.llmPoseRuns, 'llmPoseRunId')
  selectLlmPoseRun(value, `${clipId}_pose-002`, appendedLlm.llmPoseRunId, llmSelections)
  assert.equal(
    getClipRunSelection(value, clipId, poseSelections, llmSelections).selectedLlmPoseRun.llmPoseRunId,
    `${clipId}_pose-002_llm-003`,
  )
})

test('deleted selections fall back to latest remaining sibling without crossing parents', () => {
  const value = library()
  const poseSelections = new Map([[clipId, `${clipId}_pose-002`]])
  const llmSelections = new Map([[`${clipId}_pose-002`, `${clipId}_pose-002_llm-002`]])

  value.llmPoseRuns = value.llmPoseRuns.filter((run) => run.llmPoseRunId !== `${clipId}_pose-002_llm-002`)
  let view = getClipRunSelection(value, clipId, poseSelections, llmSelections)
  assert.equal(view.selectedLlmPoseRun.llmPoseRunId, `${clipId}_pose-002_llm-001`)
  assert.equal(view.selectedPoseRun.poseRunId, `${clipId}_pose-002`)

  value.poseRuns = value.poseRuns.filter((run) => run.poseRunId !== `${clipId}_pose-002`)
  value.llmPoseRuns = value.llmPoseRuns.filter((run) => run.poseRunId !== `${clipId}_pose-002`)
  view = getClipRunSelection(value, clipId, poseSelections, llmSelections)
  assert.equal(view.selectedPoseRun.poseRunId, `${clipId}_pose-001`)
  assert.deepEqual(view.llmPoseRuns.map((run) => run.llmPoseRunId), [`${clipId}_pose-001_llm-001`])
})
