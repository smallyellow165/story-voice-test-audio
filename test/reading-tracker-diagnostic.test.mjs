import test from 'node:test';
import assert from 'node:assert/strict';
import { createTracker, track } from '../src/reading-tracker.ts';
import { indices } from '../src/reading-tracker-scenarios.ts';
import { replayObserved, diagnosticReport } from '../scripts/reading-tracker-diagnose.mjs';
import { reference, events, provenance } from './fixtures/reading-jingyesi-observed.mjs';

// Explicit current-behavior contracts for this NEW reconstructed case; not desired
// reading targets and not edits to the original 22 scenarios / their expectations.
const first = [
  [0,-1,'0','','sequential-match'],
  [1,-1,'0-1','','sequential-match'],
  [4,-1,'0-4','','sequential-match'],
  [4,4,'0-4','','sequential-match'],
];
const gapOne = [...first, ...Array.from({length:9}, () => [4,4,'0-4','','no-local-match'])];
const gapTwo = [...first,
  [4,4,'0-4','','no-local-match'],
  [4,4,'0-4','','awaiting-context'],
  [9,9,'0-4,7-9','5-6','bridged-mismatch'],
  [10,9,'0-4,7-10','5-6','sequential-match'],
  [12,9,'0-4,7-12','5-6','sequential-match'],
  [14,14,'0-4,7-14','5-6','sequential-match'],
  [16,14,'0-4,7-16','5-6','sequential-match'],
  [18,14,'0-4,7-18','5-6','sequential-match'],
  [17,17,'0-4,7-17','5-6','sequential-match'],
];
for (const [maxGap, expected] of [[1,gapOne],[2,gapTwo]]) {
  test(`screenshot reconstruction maxGap=${maxGap}: all 13 intermediate states`, () => {
    const rows = replayObserved({maxGap});
    assert.equal(rows.length,13);
    for (const [i,{event,state:s}] of rows.entries()) {
      const [cursor,confirmed,matched,uncertain,reason] = expected[i];
      assert.equal(s.cursor,cursor,`step ${i+1} cursor`);
      assert.equal(s.confirmed,confirmed,`step ${i+1} confirmed`);
      assert.deepEqual(s.matched,indices(matched),`step ${i+1} matched`);
      assert.deepEqual(s.skipped,[],`step ${i+1} skipped`);
      assert.deepEqual(s.uncertain,indices(uncertain),`step ${i+1} uncertain`);
      assert.equal(s.decision.reason,reason,`step ${i+1} reason`);
      if (event.final) {
        assert.equal(s.active,null);
        assert.equal(s.hypothesis,'');
        assert.equal(s.committed.cursor,s.cursor);
        assert.deepEqual(s.committed.matched,s.matched);
        assert.deepEqual(s.committed.uncertain,s.uncertain);
        assert.ok(s.sealed.includes(event.segment));
      }
    }
    assert.deepEqual(rows.at(-1).state.sealed,events.filter(e=>e.final).map(e=>e.segment));
  });
}
test('replaying just Finals gives the same committed state at each boundary', () => {
  for (const maxGap of [1,2]) {
    const complete = replayObserved({maxGap}).filter(r=>r.event.final);
    const finals = replayObserved({maxGap},events.filter(e=>e.final));
    assert.deepEqual(finals.map(r=>r.state.committed),complete.map(r=>r.state.committed));
  }
});
test('third sentence cannot freely jump over five unaccepted characters', () => {
  const p = diagnosticReport().probes.thirdAfterStall;
  assert.deepEqual(p.map(x=>x.rows.at(-1).state.cursor),[4,4,14]);
  assert.deepEqual(p[2].rows.at(-1).state.skipped,[5,6,7,8,9]);
  assert.deepEqual(p[2].rows.at(-1).state.uncertain,[]);
  const bigWindow = replayObserved({maxGap:2,lookAhead:64},[events[3],events[9]]);
  assert.equal(bigWindow.at(-1).state.cursor,4);
});
test('correct second sentence unblocks default tracker without adapter changes', () => {
  const rows = diagnosticReport().probes.exactSecondSentence;
  assert.deepEqual(rows.filter(r=>r.event.final).map(r=>r.state.cursor),[4,9,14,17]);
});
test('two substitutions need stable following support; classification is Uncertain', () => {
  const rows = diagnosticReport().probes.stabilizedPartial;
  assert.equal(rows[1].state.decision.reason,'awaiting-context');
  assert.equal(rows[2].state.cursor,9);
  assert.deepEqual(rows[2].state.uncertain,[5,6]);
  assert.deepEqual(rows[2].state.skipped,[]);
  let s = createTracker(reference,'V1',{maxGap:2,minCoverage:.61});
  s = track(s,events[3]); s = track(s,events[6]);
  assert.equal(s.cursor,4); // 3 / 5 = .6 is exactly the default coverage threshold.
});
test('last Final revokes tentative 故 and cannot confirm trailing 苦香 as 故乡', () => {
  const rows = replayObserved({maxGap:2});
  assert.equal(rows[11].state.cursor,18);
  assert.equal(rows[12].state.decision.action,'Revise');
  assert.equal(rows[12].state.cursor,17);
  assert.ok(!rows[12].state.matched.includes(18));
  assert.ok(!rows[12].state.uncertain.includes(18));
  assert.equal(rows[12].state.complete,false);
});
test('fixture explicitly discloses absent raw metadata', () => {
  assert.ok(provenance.missing.includes('provider audio ranges'));
  assert.ok(events.every(e=>e.segment.startsWith('reconstructed-')));
});
