import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityBridge } from '../src/activity-bridge.ts';

test('bridge enforces origin/instance, deduplicates reset, rejects stale runs, works without server', () => {
  const events = new EventTarget(), sent = [];
  const parent = { postMessage: data => sent.push(data) };
  Object.assign(globalThis, { parent, location: { search: '?activityId=i1&hostOrigin=http://localhost:3000' },
    window: Object.assign(events, { parent }) });
  let resets = 0, runId = 'r1', revision = 1;
  const snapshot = () => ({ runId, revision, taskId: 't1' });
  const bridge = createActivityBridge(() => {}, snapshot, () => { resets++; runId = 'r2'; revision++; });
  const command = { channel: 'activity-v1', v: 1, instanceId: 'i1', id: 'c1', kind: 'command',
    name: 'reset', sessionEpoch: 'session-1', payload: { expectedRunId: 'r1' } };
  function deliver(data, origin='http://localhost:3000') {
    const event = new Event('message'); Object.assign(event, { data, source: parent, origin });
    events.dispatchEvent(event);
  }
  deliver(command, 'https://wrong.example'); assert.equal(resets, 0);
  deliver({ ...command, instanceId: 'other' }); assert.equal(resets, 0);
  deliver(command); deliver(command);
  assert.equal(resets, 1);
  assert.equal(sent.at(-1).payload.status, 'applied');
  assert.equal(sent.at(-1).payload.snapshot.runId, 'r2');
  assert.equal(sent.at(-1).payload.replyTo, 'c1');
  deliver({ ...command, id: 'c2' });
  assert.equal(resets, 1); assert.equal(sent.at(-1).payload.status, 'rejected');
  bridge.send('task_changed', { snapshot: { ...snapshot(), taskId: 't2' } });
  assert.equal(sent.at(-1).payload.snapshot.taskId, 't2');
  bridge.dispose();
});

test('module endpoint uses same contract with no window message listener', () => {
  const sent = [];
  Object.assign(globalThis, { location: { search: '' }, window: {
    addEventListener() { throw new Error('module must not subscribe to postMessage'); },
    removeEventListener() {},
  } });
  let runId = 'r1', resets = 0, exited = false;
  const bridge = createActivityBridge(() => { exited = true }, () => ({ runId, revision: resets + 1 }),
    () => { runId = 'r2'; resets++ }, { instanceId: 'module', send: m => sent.push(m) });
  const command = { v: 1, instanceId: 'module', id: 'reset-1', kind: 'command', name: 'reset',
    sessionEpoch: 'epoch', payload: { expectedRunId: 'r1' } };
  bridge.receive(command); bridge.receive(command);
  assert.equal(resets, 1); assert.equal(sent.at(-1).payload.replyTo, 'reset-1');
  bridge.receive({ ...command, id: 'stale' });
  assert.equal(sent.at(-1).payload.status, 'rejected');
  bridge.receive({ ...command, id: 'snapshot', name: 'get_snapshot' });
  assert.equal(sent.at(-1).payload.snapshot.runId, 'r2');
  bridge.receive({ ...command, id: 'exit', name: 'exit' });
  assert.equal(exited, true); assert.equal(sent.at(-1).payload.snapshot.lifecycle, 'closed');
  bridge.dispose();
});
