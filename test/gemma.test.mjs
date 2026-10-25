import test from 'node:test';
import assert from 'node:assert/strict';
import { callGemma, interpretRequest, validateModel } from '../src/gemma.mjs';
import { demo } from '../test-fixtures/events.mjs';
const config = { key: 'test-key-used-only-in-unit-tests', model: 'gemma-4-26b-a4b-it' };
function response(text) { return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) }; }

test('production configuration rejects a non-Gemma model', () => {
  assert.throws(() => validateModel('gemini-anything'));
  assert.throws(() => validateModel('../another-model'));
});
test('Gemma requests use the selected model and header authentication', async t => {
  let observed;
  t.mock.method(globalThis, 'fetch', async (url, options) => { observed = { url, options }; return response('READY'); });
  assert.equal(await callGemma(config, 'test'), 'READY');
  assert.match(observed.url, /gemma-4-26b-a4b-it:generateContent$/);
  assert.equal(observed.options.headers['x-goog-api-key'], config.key);
  assert.ok(!observed.url.includes(config.key));
});
test('an unknown volunteer in model output cannot reach the solver', async t => {
  t.mock.method(globalThis, 'fetch', async () => response(JSON.stringify({ status: 'ready', message: 'Changed', changes: [{ type: 'max_hours', volunteerId: 'ghost', hours: 2 }] })));
  await assert.rejects(interpretRequest(config, 'Unknown person', demo.volunteers, demo.shifts), /unknown volunteer/);
});
test('malformed model output preserves the schedule by rejecting interpretation', async t => {
  t.mock.method(globalThis, 'fetch', async () => response('Here is your schedule: ...'));
  await assert.rejects(interpretRequest(config, 'test', demo.volunteers, demo.shifts), /not valid structured data/);
});
test('clarification responses contain no executable changes', async t => {
  t.mock.method(globalThis, 'fetch', async () => response(JSON.stringify({ status: 'clarification', message: '02:00 or 14:00?', changes: [{ type: 'max_hours', volunteerId: 'nadia', hours: 0 }] })));
  const result = await interpretRequest(config, 'after 2', demo.volunteers, demo.shifts);
  assert.equal(result.status, 'clarification'); assert.deepEqual(result.changes, []);
});
test('an API failure never includes the key in a displayed error', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 403, json: async () => ({ error: { message: `Rejected ${config.key}` } }) }));
  await assert.rejects(callGemma(config, 'test'), error => !error.message.includes(config.key) && error.message.includes('[redacted]'));
});
