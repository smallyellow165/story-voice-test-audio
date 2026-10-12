import { pathToFileURL } from 'node:url';
import { createTracker, track } from '../src/reading-tracker.ts';
import { provenance, reference, events } from '../test/fixtures/reading-jingyesi-observed.mjs';

export function replayObserved(config = {}, input = events) {
  let state = createTracker(reference, 'V1', config);
  return input.map(event => {
    state = track(state, event);
    return { event, state };
  });
}
export function diagnosticReport() {
  const firstFinal = events[3];
  const thirdFinal = { ...events[9], seq: 5 };
  return {
    provenance, reference,
    comparison: [1, 2].map(maxGap => ({ maxGap, rows: replayObserved({ maxGap }) })),
    probes: {
      finalOnly: [1, 2].map(maxGap => ({ maxGap, rows: replayObserved({ maxGap }, events.filter(e => e.final)) })),
      // Isolate recovery after a missed entire sentence, WITHOUT fixing sentence two first.
      thirdAfterStall: [1, 2, 5].map(maxGap => ({ maxGap, rows: replayObserved({ maxGap }, [firstFinal, thirdFinal]) })),
      exactSecondSentence: replayObserved({}, events.map(e => e.seq === 7 ? { ...e, text: '疑是地上霜。' } : e)),
      // A new stable prefix needs at least four shared tokens before bridging two substitutions.
      stabilizedPartial: replayObserved({ maxGap: 2 }, [firstFinal,
        { ...events[5], seq: 5, text: '一室地上' }, { ...events[5], seq: 6 }]),
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = diagnosticReport();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log('RECONSTRUCTED screenshot replay — NOT raw STT capture. Synthetic segment/time metadata.');
    console.log(JSON.stringify(provenance, null, 2));
    for (const { maxGap, rows } of report.comparison) {
      console.log(`\nV1 maxGap=${maxGap}; Match/Skip/Uncertain are cumulative reference positions`);
      console.log('| Step | STT Input | Match | Skip | Uncertain | Cursor / confirmed | Reason |');
      console.log('|---|---|---|---|---|---|---|');
      for (const { event, state: s } of rows) {
        const chars = indices => indices.map(i => `${s.tokens[i].text}[${i}]`).join('、') || '—';
        console.log(`| ${event.seq} ${event.final ? 'F' : 'P'} | ${event.text} | ${chars(s.matched)} | ${chars(s.skipped)} | ${chars(s.uncertain)} | ${chars(s.cursor < 0 ? [] : [s.cursor])} / ${s.confirmed} | ${s.decision.reason} |`);
      }
    }
    console.log('\nControlled probes (cursor indices):');
    for (const key of ['finalOnly', 'thirdAfterStall'])
      for (const p of report.probes[key]) console.log(key, 'maxGap', p.maxGap, p.rows.map(r => r.state.cursor));
    for (const key of ['exactSecondSentence', 'stabilizedPartial'])
      console.log(key, report.probes[key].map(r => [r.event.seq, r.state.cursor, r.state.decision.reason]));
  }
}
