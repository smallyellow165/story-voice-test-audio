import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createBatchInputRow,
  findExistingSourceVideo,
  processBatchDatasetRows,
  validateBatchInputRows,
} from '../src/batch-dataset-input.ts'

const input = (id, label, start, end, url) => ({
  id, label, start, end, url, status: 'Pending', error: '',
})

test('new rows inherit only Label and URL from the previous row', () => {
  const row = createBatchInputRow('row-002', input('row-001', 'bunny_hop', '12.3', '15.8', 'https://example.com/a'))
  assert.deepEqual(row, {
    id: 'row-002', label: 'bunny_hop', start: '', end: '', url: 'https://example.com/a', status: 'Pending', error: '',
  })
})

test('validation reports row errors and counts normalized unique source URLs', () => {
  const result = validateBatchInputRows([
    input('1', 'bunny_hop', '10', '13', 'https://example.com/a'),
    input('2', 'high_knees', '20.5', '24', 'https://example.com/a'),
    input('3', '', '20', '10', 'bad-url'),
  ])

  assert.equal(result.total, 3)
  assert.equal(result.validCount, 2)
  assert.equal(result.invalidCount, 1)
  assert.equal(result.uniqueSourceCount, 1)
  assert.match(result.errorsByRowId.get('3'), /Label is required/)
  assert.match(result.errorsByRowId.get('3'), /End must be greater than Start/)
})

test('finds an existing Source Video by the normalized source URL', () => {
  const existing = { videoId: 'video-001', sourceUrl: 'https://example.com/a' }
  assert.equal(findExistingSourceVideo([existing], 'https://example.com/a'), existing)
  assert.equal(findExistingSourceVideo([existing], 'https://example.com/b'), undefined)
})

test('processing resolves each source once, builds every valid row, and isolates source failures', async () => {
  const validated = validateBatchInputRows([
    input('a1', 'bunny_hop', '10', '13', 'https://example.com/a'),
    input('a2', 'high_knees', '20', '24', 'https://example.com/a'),
    input('b1', 'frog_jump', '15', '19', 'https://example.com/b'),
  ]).validRows
  const resolved = []
  const built = []
  const statuses = new Map()

  const result = await processBatchDatasetRows(validated, {
    resolveSource: async (url) => {
      resolved.push(url)
      if (url.endsWith('/b')) throw new Error('download failed')
      return { videoId: 'video-001' }
    },
    createClip: async (_source, row) => ({ clipId: `clip-${row.id}` }),
    generateClip: async (_source, clip) => clip,
    analyzePose: async (_source, clip) => ({ poseRunId: `${clip.clipId}-pose` }),
    buildLlmPose: async (_source, clip, pose) => built.push([clip.clipId, pose.poseRunId]),
  }, (rowId, status, error = '') => statuses.set(rowId, { status, error }))

  assert.deepEqual(resolved, ['https://example.com/a', 'https://example.com/b'])
  assert.deepEqual(built, [
    ['clip-a1', 'clip-a1-pose'],
    ['clip-a2', 'clip-a2-pose'],
  ])
  assert.deepEqual(result, { completed: 2, failed: 1 })
  assert.equal(statuses.get('a1').status, 'Done')
  assert.equal(statuses.get('a2').status, 'Done')
  assert.deepEqual(statuses.get('b1'), { status: 'Error', error: 'download failed' })
})

test('a failed row does not stop a later row for the same source', async () => {
  const rows = validateBatchInputRows([
    input('a1', 'bad_clip', '10', '13', 'https://example.com/a'),
    input('a2', 'good_clip', '20', '23', 'https://example.com/a'),
  ]).validRows
  const statuses = new Map()
  const result = await processBatchDatasetRows(rows, {
    resolveSource: async () => ({ videoId: 'video-001' }),
    createClip: async (_source, row) => {
      if (row.id === 'a1') throw new Error('clip failed')
      return { clipId: 'clip-a2' }
    },
    generateClip: async (_source, clip) => clip,
    analyzePose: async () => ({ poseRunId: 'pose-a2' }),
    buildLlmPose: async () => undefined,
  }, (rowId, status, error = '') => statuses.set(rowId, { status, error }))

  assert.deepEqual(result, { completed: 1, failed: 1 })
  assert.deepEqual(statuses.get('a1'), { status: 'Error', error: 'clip failed' })
  assert.equal(statuses.get('a2').status, 'Done')
})
