import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewSetupDraft, compileSetupDraft } from '../src/setup.mjs';
import { interpretEventSetup, callGemma } from '../src/gemma.mjs';
import { createApi } from '../src/api.mjs';
import { checkSchedule, repairSchedule } from '../src/scheduler.mjs';
import { validateEventState } from '../src/cloud.mjs';

const config = { key: 'test-only-key', model: 'gemma-4-26b-a4b-it' };
const draft = () => ({ event: 'Campus Help Day', date: '2026-10-20', volunteers: [
  { name: 'Nadia', skills: ['first-aid'], availability: [['10:00', '14:00']], maxHours: 4 },
  { name: 'Rahim', skills: [], availability: [['10:00', '14:00']], maxHours: 4 }
], shifts: [
  { station: 'Support', start: '10:00', end: '12:00', required: 1, skills: ['first-aid'] },
  { station: 'Registration', start: '10:00', end: '12:00', required: 1, skills: [] }
] });
const modelResponse = value => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }));
const post = (path, body) => new Request(`https://shiftrescue.netlify.app${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('reviewed event drafts compile into unassigned events and valid schedules', () => {
  const input = draft(), before = structuredClone(input);
  const state = compileSetupDraft(input);
  assert.deepEqual(input, before);
  validateEventState(state);
  assert.deepEqual(state.schedule, { 's-1': [], 's-2': [] });
  assert.deepEqual(state.volunteers[0].availability, [[600, 840]]);
  const solved = repairSchedule(state.volunteers, state.shifts, state.schedule);
  assert.equal(solved.status, 'feasible');
  assert.ok(checkSchedule(state.volunteers, state.shifts, solved.schedule).valid);
});
test('unknown details stay unknown and cannot be silently saved', () => {
  const input = draft(); input.date = null; input.volunteers[0].availability = null; input.volunteers[0].skills = null; input.volunteers[0].maxHours = null; input.shifts[0].required = null;
  const review = reviewSetupDraft(input);
  assert.equal(review.draft.date, null); assert.equal(review.draft.volunteers[0].maxHours, null);
  assert.equal(review.issues.length, 5);
  assert.throws(() => compileSetupDraft(input), /event date/);
});
test('explicit no skills and all-day unavailability are different from missing fields', () => {
  const input = draft(); input.volunteers[0].skills = []; input.volunteers[0].availability = [];
  assert.deepEqual(reviewSetupDraft(input).issues, []);
  assert.deepEqual(compileSetupDraft(input).volunteers[0].availability, []);
});
test('drafts reject duplicate names, invalid dates, reversed intervals and capacity overflow', () => {
  for (const mutate of [
    d => { d.volunteers[1].name = 'NADIA'; },
    d => { d.date = '2026-02-31'; },
    d => { d.volunteers[0].availability = [['14:00', '10:00']]; },
    d => { d.shifts[0].end = '09:00'; },
    d => { d.volunteers = Array.from({ length: 13 }, () => d.volunteers[0]); },
    d => { d.shifts[0].required = 4; },
    d => { d.volunteers[0].maxHours = '4'; },
    d => { d.volunteers[0].skills = ['<script>']; },
    d => { d.shifts[0].start = 'after 2'; }
  ]) { const input = draft(); mutate(input); assert.throws(() => compileSetupDraft(input)); }
});
test('model supplied IDs, raw schedules, histories and foreign timezones never become saved state', () => {
  const input = { ...draft(), timezone: 'Europe/London', schedule: { 's-1': ['admin'] }, history: [{ title: 'forged' }], ownerId: 'another-user' };
  input.volunteers[0].id = 'admin';
  const state = compileSetupDraft(input);
  assert.equal(state.timezone, 'Asia/Dhaka'); assert.equal(state.volunteers[0].id, 'v-1');
  assert.deepEqual(state.history, []); assert.deepEqual(state.schedule['s-1'], []); assert.equal(state.ownerId, undefined);
});
test('Gemma creates a draft without assigning people and downgrades incomplete ready responses', async t => {
  let prompt;
  const partial = draft(); partial.volunteers[0].maxHours = null;
  t.mock.method(globalThis, 'fetch', async (_url, options) => { prompt = JSON.parse(options.body); return modelResponse({ status: 'ready', message: 'Your event', questions: [], draft: partial }); });
  const result = await interpretEventSetup(config, 'My event description', '2026-10-18');
  assert.equal(result.status, 'clarification'); assert.equal(result.draft.volunteers[0].maxHours, null); assert.equal(result.source, 'gemma');
  assert.match(prompt.contents[0].parts[0].text, /2026-10-18/); assert.equal(prompt.generationConfig.maxOutputTokens, 8192);
});
test('Gemma clarification retains known fields and unsupported-rule questions', async t => {
  t.mock.method(globalThis, 'fetch', async () => modelResponse({ status: 'clarification', message: 'Please review', questions: ['Required breaks are unsupported. Can you remove that requirement?'], draft: draft() }));
  const result = await interpretEventSetup(config, 'Add a break', '2026-10-18');
  assert.equal(result.status, 'clarification'); assert.equal(result.questions.length, 1); assert.equal(result.draft.volunteers.length, 2);
});
test('malformed and truncated setup responses fail without silently saving a partial roster', async t => {
  t.mock.method(globalThis, 'fetch', async () => modelResponse({ status: 'ready', message: 'Event', questions: [], draft: { ...draft(), volunteers: 'Nadia' } }));
  await assert.rejects(interpretEventSetup(config, 'My event', '2026-10-18'), /invalid structured/);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } }] })));
  await assert.rejects(callGemma(config, 'test'), /cut short/);
});
test('setup enforces the description limit before calling Google', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return modelResponse({}); });
  await assert.rejects(interpretEventSetup(config, 'x'.repeat(8001), '2026-10-18'), /8,000/);
  await assert.rejects(interpretEventSetup(config, '   ', '2026-10-18'), /8,000/);
  assert.equal(calls, 0);
});
test('hosted setup parsing and event creation both require sign-in before model/database access', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Unexpected request'); });
  const api = createApi({ NETLIFY: 'true', SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key' });
  for (const path of ['/api/setup/interpret', '/api/setup/create']) assert.equal((await api(post(path, { request: 'My event', draft: draft() }))).status, 401);
  assert.equal(calls, 0);
});
test('setup parsing returns quota timing and does not write or change a draft', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { message: 'Quota reached' } }), { status: 429, headers: { 'retry-after': '90' } }));
  const input = draft(), before = structuredClone(input), api = createApi({ GEMINI_API_KEY: config.key });
  const response = await api(post('/api/setup/interpret', { request: 'My event', draft: input }));
  const body = await response.json(); assert.equal(response.status, 429); assert.ok(Date.parse(body.quota.retryAt) > Date.now()); assert.deepEqual(input, before);
});
test('setup creation revalidates the reviewed fields server-side before any database write', async t => {
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'owner', email: 'owner@example.test', is_anonymous: false }));
    if (String(url).includes('/rpc/shiftrescue_save_event')) {
      writes++; const params = JSON.parse(options.body);
      assert.equal(params.p_event_id, null); assert.equal(params.p_expected_version, 0); assert.equal(params.p_activity.source, 'gemma');
      return new Response(JSON.stringify({ id: 'new-event', version: 1, state: { ...params.p_state, history: [] } }));
    }
    throw new Error('Unexpected fetch');
  });
  const api = createApi({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key' });
  const send = body => { const request = post('/api/setup/create', body); request.headers.set('cookie', 'sr_access=verified-test-token'); return api(request); };
  const incomplete = draft(); incomplete.volunteers[0].maxHours = null;
  assert.equal((await send({ draft: incomplete })).status, 400); assert.equal(writes, 0);
  const response = await send({ draft: draft(), eventId: 'must-not-overwrite' });
  assert.equal(response.status, 201); assert.equal(writes, 1); assert.deepEqual((await response.json()).state.schedule, { 's-1': [], 's-2': [] });
});
