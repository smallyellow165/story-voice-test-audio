import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const mainSource = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const clipHistorySource = mainSource.slice(
  mainSource.indexOf('  const renderClipHistory = () => {'),
  mainSource.indexOf('  const rebuildCurrentVideoRecord = () => {'),
)

test('Clip History renders compact summary, Pose Run, and LLM Pose Run tables', () => {
  assert.match(clipHistorySource, /<table class="history-table history-clip-table">/)
  assert.match(clipHistorySource, /<th>Clip<\/th><th>Range<\/th><th>Duration<\/th><th>Label<\/th>/)
  assert.match(clipHistorySource, /<h4>Pose Runs <span>/)
  assert.match(clipHistorySource, /<h4>LLM Pose Runs <span>/)
  assert.doesNotMatch(clipHistorySource, /history-selected-run|history-selected-llm|Selected Pose|Selected LLM Pose/)
})

test('each history action row carries the exact Pose or LLM Run identity', () => {
  assert.match(clipHistorySource, /data-pose-run-id="\$\{escapeHtml\(poseRun\.poseRunId\)\}"/)
  assert.match(clipHistorySource, /data-llm-pose-run-id="\$\{escapeHtml\(llmRun\.llmPoseRunId\)\}"/)
  assert.match(mainSource, /action === 'copy-pose-path'[\s\S]*button\.dataset\.poseRunId/)
  assert.match(mainSource, /action === 'delete-pose'[\s\S]*button\.dataset\.poseRunId/)
  assert.match(mainSource, /action === 'copy-llm-pose-path'[\s\S]*button\.dataset\.llmPoseRunId/)
  assert.match(mainSource, /action === 'delete-llm-pose'[\s\S]*button\.dataset\.llmPoseRunId/)
})
