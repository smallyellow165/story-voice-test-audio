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
