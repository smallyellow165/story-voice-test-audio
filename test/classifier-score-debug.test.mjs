import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifierVoteDebug,
  nearestClassifiedFrame,
} from '../src/classifier-score-debug.ts'

const frame = (frameIndex, videoTimestampMs, rawOpen, rawClose, rawWinner = rawOpen > rawClose ? 'star_open' : 'star_close') => ({
  frameIndex,
  videoTimestampMs,
  rawOpen,
  rawClose,
  rawWinner,
  emaOpen: rawOpen,
  emaClose: rawClose,
  emaWinner: rawWinner,
})

test('derives KNN winner vote share from the actual final vote counts', () => {
  assert.deepEqual(classifierVoteDebug(frame(1, 100, 6, 4)), {
    totalVotes: 10,
    winnerVotes: 6,
    winnerVoteShare: 0.6,
  })
  assert.deepEqual(classifierVoteDebug(frame(2, 200, 0, 0)), {
    totalVotes: 0,
    winnerVotes: 0,
    winnerVoteShare: null,
  })
})

test('maps current video time to the nearest classified frame and keeps the earlier tie', () => {
  const frames = [frame(0, 0, 5, 5), frame(1, 100, 6, 4), frame(2, 200, 8, 2)]
  assert.equal(nearestClassifiedFrame(frames, 149).frameIndex, 1)
  assert.equal(nearestClassifiedFrame(frames, 150).frameIndex, 1)
  assert.equal(nearestClassifiedFrame([], 100), null)
})
