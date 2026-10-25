import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverSavedEvent } from '../public/workspace.js';
const error = status => Object.assign(new Error('Request failed'), { status });
test('selected events reopen even when absent from the current list page', async () => {
  const calls = [], selected = { id: 'selected', state: { event: 'Saved event' } };
  const result = await recoverSavedEvent({ selectedId: 'selected', events: [{ id: 'newest' }], load: async id => { calls.push(id); return selected; } });
  assert.equal(result, selected); assert.deepEqual(calls, ['selected']);
});
test('sign-in without a saved selection opens the latest saved event', async () => {
  const result = await recoverSavedEvent({ selectedId: null, events: [{ id: 'newest' }, { id: 'older' }], load: async id => ({ id }) });
  assert.equal(result.id, 'newest');
});
test('only confirmed missing events permit fallback to another event', async () => {
  const calls = [];
  const result = await recoverSavedEvent({ selectedId: 'deleted', events: [{ id: 'deleted' }, { id: 'kept' }], load: async id => { calls.push(id); if (id === 'deleted') throw error(404); return { id }; } });
  assert.equal(result.id, 'kept'); assert.deepEqual(calls, ['deleted', 'kept']);
});
test('outages and session errors do not masquerade as empty or missing events', async () => {
  for (const status of [401, 429, 500, 503]) {
    const calls = [];
    await assert.rejects(recoverSavedEvent({ selectedId: 'saved', events: [{ id: 'other' }], load: async id => { calls.push(id); throw error(status); } }), e => e.status === status);
    assert.deepEqual(calls, ['saved']);
  }
});
test('a genuinely empty or fully deleted event list returns an empty workspace', async () => {
  assert.equal(await recoverSavedEvent({ events: [], load: async () => { throw new Error('Unexpected load'); } }), null);
  assert.equal(await recoverSavedEvent({ selectedId: 'deleted', events: [], load: async () => { throw error(404); } }), null);
});
