import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, normalizeSetup } from '../src/api.mjs';
import { proposalTokens } from '../src/proposals.mjs';
import { demo } from '../test-fixtures/events.mjs';
import { checkSchedule, repairSchedule } from '../src/scheduler.mjs';
const request = (path, body, headers = {}) => new Request(`https://shiftrescue.netlify.app${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('public status reports configuration without leaking server credentials', async () => {
  const api = createApi({ GEMINI_API_KEY: 'private-test-key', PROPOSAL_SECRET: 's'.repeat(64) });
  const response = await api(new Request('https://shiftrescue.netlify.app/api/status'));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const text = await response.text(); assert.ok(!text.includes('private-test-key')); assert.ok(!text.includes('s'.repeat(64)));
});
test('same-origin HTTPS requests work while cross-site writes are rejected', async () => {
  const api = createApi({});
  assert.equal((await api(request('/api/repair', { ...demo, changes: [] }, { Origin: 'https://attacker.example' }))).status, 403);
  assert.equal((await api(request('/api/repair', { ...demo, changes: [] }, { Origin: 'https://shiftrescue.netlify.app' }))).status, 200);
});
test('request size and malformed bodies are rejected before model calls', async () => {
  const api = createApi({});
  assert.equal((await api(request('/api/interpret', { request: 'a'.repeat(81000) }))).status, 413);
  assert.equal((await api(request('/api/interpret', null))).status, 400);
});
test('quota errors reach the client with retry metadata and unchanged input', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { message: 'Too many requests', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '60s' }] } }), { status: 429 }));
  const before = structuredClone(demo);
  const api = createApi({ GEMINI_API_KEY: 'private-test-key', GEMMA_MODEL: 'gemma-4-26b-a4b-it' });
  const response = await api(request('/api/interpret', { ...demo, request: 'Nadia cannot work after 14:00.' }));
  const result = await response.json();
  assert.equal(response.status, 429); assert.equal(result.quota.resetSource, 'provider'); assert.ok(Date.parse(result.quota.retryAt) > Date.now()); assert.deepEqual(demo, before);
});
test('an empty event is a valid saved draft, and real shifts can be generated later', () => {
  const blank = normalizeSetup({ ...demo, volunteers: [], shifts: [], schedule: {} });
  assert.deepEqual(blank.schedule, {});
  const next = normalizeSetup({ ...demo, volunteers: [demo.volunteers[0]], shifts: [{ ...demo.shifts[0], required: 1 }], schedule: {} });
  assert.deepEqual(next.schedule, { 'reg-10': [] });
  const solved = repairSchedule(next.volunteers, next.shifts, next.schedule);
  assert.ok(checkSchedule(next.volunteers, next.shifts, solved.schedule).valid);
});
test('removing an assigned person preserves unaffected assignments in a partial schedule', () => {
  const next = normalizeSetup({ ...demo, volunteers: demo.volunteers.filter(p => p.id !== 'nadia') });
  assert.ok(Object.values(next.schedule).some(ids => ids.length > 0));
  assert.ok(Object.values(next.schedule).every(ids => !ids.includes('nadia')));
  assert.ok(!checkSchedule(next.volunteers, next.shifts, next.schedule).valid);
});
test('signed previews survive separate function instances and bind owner, event, version and expiry', () => {
  let now = 1000; const secret = 's'.repeat(64);
  const issue = proposalTokens(secret, () => now), apply = proposalTokens(secret, () => now);
  const token = issue.issue({ userId: 'owner', eventId: 'event', version: 3, state: demo });
  assert.equal(apply.read(token, 'owner', 'event').version, 3);
  assert.throws(() => apply.read(token, 'another-user', 'event'), error => error.status === 409);
  assert.throws(() => apply.read(token, 'owner', 'another-event'), error => error.status === 409);
  assert.throws(() => apply.read(token.replace(/^./, 'x'), 'owner', 'event'), error => error.status === 409);
  now += 600001; assert.throws(() => apply.read(token, 'owner', 'event'), error => error.status === 409);
});
test('cloud previews require a dedicated signing secret', () => {
  assert.throws(() => proposalTokens('').issue({}), error => error.status === 503);
});
test('Netlify adapter handles Web Requests without filesystem or localhost dependencies', async () => {
  const { default: handle, config } = await import('../netlify/functions/api.mjs');
  const response = await handle(new Request('https://shiftrescue.netlify.app/api/status'));
  assert.equal(response.status, 200); assert.equal((await response.json()).managed, true); assert.equal(config.path, '/api/*'); assert.deepEqual(config.rateLimit.aggregateBy, ['ip', 'domain']);
});
