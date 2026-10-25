import test from 'node:test';
import assert from 'node:assert/strict';
import { callGemma, interpretEventSetup, interpretRequest } from '../src/gemma.mjs';
import { createApi } from '../src/api.mjs';
import { demo } from '../test-fixtures/events.mjs';

const config = { key: 'private-recovery-test-key', model: 'gemma-4-26b-a4b-it' };
const answer = text => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
const failed = status => new Response(JSON.stringify({ error: { message: `Internal error ${config.key}` } }), { status });

test('Gemma recovery preserves the selected model, key, output limit and generation settings', async t => {
  let observed;
  t.mock.method(globalThis, 'fetch', async (url, options) => { observed = { url, options }; return answer('READY'); });
  assert.equal(await callGemma(config, 'test', { maxOutputTokens: 8192 }), 'READY');
  assert.deepEqual(JSON.parse(observed.options.body).generationConfig, { temperature: 0.1, maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'minimal' } });
  assert.equal(observed.options.headers['x-goog-api-key'], config.key);
  assert.match(observed.url, /gemma-4-26b-a4b-it:generateContent$/);
});

test('a 500 followed by 503 recovers on the third attempt with the same request and deadline', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls.push(options);
    return calls.length === 1 ? failed(500) : calls.length === 2 ? failed(503) : answer('READY');
  });
  assert.equal(await callGemma(config, 'test'), 'READY');
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.signal === calls[0].signal && call.body === calls[0].body));
});

test('temporary network failure recovers without exposing transport error details', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { if (++calls === 1) throw new TypeError(config.key); return answer('READY'); });
  assert.equal(await callGemma(config, 'test'), 'READY');
  assert.equal(calls, 2);
});

test('persistent upstream failure stops after three attempts and becomes an actionable API 503', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return failed(500); });
  const api = createApi({ GEMINI_API_KEY: config.key, GEMMA_MODEL: config.model });
  const response = await api(new Request('http://localhost/api/test-connection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
  assert.equal(response.status, 503);
  const result = await response.text();
  assert.match(result, /three attempts/);
  assert.ok(!result.includes(config.key));
  assert.equal(calls, 3);
});

test('quota errors are not automatically retried and preserve Google retry metadata', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '60s' }] } }), { status: 429 }); });
  await assert.rejects(callGemma(config, 'test'), error => error.status === 429 && error.quota.resetSource === 'provider');
  assert.equal(calls, 1);
});

test('invalid requests and credentials fail immediately with redacted messages', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return failed(403); });
  await assert.rejects(callGemma(config, 'test'), error => /Gemma API \(403\)/.test(error.message) && !error.message.includes(config.key));
  assert.equal(calls, 1);
});

test('a timed-out logical request returns 504 without starting another attempt', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new DOMException('Timed out', 'TimeoutError'); });
  await assert.rejects(callGemma(config, 'test'), error => error.status === 504 && /45 seconds/.test(error.message));
  assert.equal(calls, 1);
});

test('both event setup and change interpretation retain their generation settings', async t => {
  const draft = { event: 'Recovery check', date: '2026-10-24', volunteers: [{ name: 'A', skills: [], availability: [['10:00', '12:00']], maxHours: 2 }], shifts: [{ station: 'Desk', start: '10:00', end: '12:00', required: 1, skills: [] }] };
  const limits = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const generation = JSON.parse(options.body).generationConfig;
    limits.push(generation.maxOutputTokens);
    assert.equal(generation.temperature, 0.1);
    assert.deepEqual(generation.thinkingConfig, { thinkingLevel: 'minimal' });
    return generation.maxOutputTokens === 8192
      ? answer(JSON.stringify({ status: 'ready', message: 'Review the event.', questions: [], draft }))
      : answer(JSON.stringify({ status: 'clarification', message: 'Which shift time do you mean?', changes: [] }));
  });
  assert.equal((await interpretEventSetup(config, 'Set up a desk.', '2026-10-24')).status, 'ready');
  const change = await interpretRequest(config, 'Assign Nadia to a shift.', demo.volunteers, demo.shifts);
  assert.equal(change.status, 'clarification');
  assert.deepEqual(change.changes, []);
  assert.deepEqual(limits, [8192, 2048]);
});
