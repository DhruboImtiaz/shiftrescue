import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePhoto, MAX_PHOTO_BYTES } from '../src/photo.mjs';
import { interpretEventSetup } from '../src/gemma.mjs';
import { compileSetupDraft, reviewSetupDraft } from '../src/setup.mjs';
import { createApi } from '../src/api.mjs';

const image = () => ({ mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=' });
const config = { key: 'private-fixture-key', model: 'gemma-4-26b-a4b-it' };
const draft = () => ({ event: 'Community Day', date: '2026-10-25', volunteers: [
  { name: 'Nadia', skills: [], availability: [['10:00', '14:00']], maxHours: 4 },
  { name: 'রহিম', skills: [], availability: [['10:00', '14:00']], maxHours: 4 }
], shifts: [
  { station: 'Registration', start: '10:00', end: '12:00', required: 2, skills: [] },
  { station: 'Information', start: '12:00', end: '14:00', required: 3, skills: [] }
], assignments: [{ volunteerIndex: 0, shiftIndex: 0 }, { volunteerIndex: 1, shiftIndex: 1 }] });
const response = d => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ status: 'ready', message: 'Review your roster', questions: [], draft: d }) }] } }] }));
const post = (path, body, cookie = '') => new Request(`https://shiftrescue.netlify.app${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });

test('photo boundary accepts canonical image bytes, rejects URLs, mismatched types and malformed base64', () => {
  assert.deepEqual(validatePhoto(image()), image());
  for (const value of [null, {}, [], { url: 'https://private.example/roster.png' }, { ...image(), mimeType: 'image/svg+xml' }, { ...image(), mimeType: 'image/jpeg' }, { ...image(), data: image().data + '\n' }, { ...image(), data: 'AAAA=AAA' }, { ...image(), data: 'AAAA' }]) assert.throws(() => validatePhoto(value));
});
test('photo size limit is enforced on decoded bytes, including large canonical payloads', () => {
  const bytes = Buffer.alloc(MAX_PHOTO_BYTES); Buffer.from(image().data, 'base64').copy(bytes);
  assert.equal(validatePhoto({ mimeType: 'image/png', data: bytes.toString('base64') }).data.length, bytes.toString('base64').length);
  assert.throws(() => validatePhoto({ mimeType: 'image/png', data: Buffer.concat([bytes, Buffer.from([1])]).toString('base64') }), /larger than 2 MB/);
});
test('photo-only interpretation sends image before instructions and retains explicit assignments and Bengali names', async t => {
  let payload;
  t.mock.method(globalThis, 'fetch', async (_url, options) => { payload = JSON.parse(options.body); return response(draft()); });
  const result = await interpretEventSetup(config, '', '2026-10-25', { image: image() });
  assert.deepEqual(payload.contents[0].parts[0], { inlineData: image() });
  assert.match(payload.contents[0].parts[1].text, /instructions printed in the photo/);
  assert.match(payload.contents[0].parts[1].text, /written assignment is NOT evidence/);
  assert.equal(result.draft.volunteers[1].name, 'রহিম');
  assert.deepEqual(result.draft.assignments, draft().assignments);
});
test('unreadable fields stay null and prevent an accidental save', async t => {
  const partial = draft(); partial.date = null; partial.volunteers[0].availability = null;
  t.mock.method(globalThis, 'fetch', async () => response(partial));
  const result = await interpretEventSetup(config, 'Times in the table are assignments', '2026-10-25', { image: image() });
  assert.equal(result.status, 'clarification'); assert.equal(result.draft.date, null);
  assert.equal(result.draft.volunteers[0].availability, null); assert.throws(() => compileSetupDraft(result.draft), /availability/);
});
test('invalid photo/model/notes fail before any provider access', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Unexpected request'); });
  await assert.rejects(interpretEventSetup(config, '', '2026-10-25', { image: {} }));
  await assert.rejects(interpretEventSetup({ ...config, model: 'gemma-3-1b-it' }, '', '2026-10-25', { image: image() }), /image-capable/);
  await assert.rejects(interpretEventSetup(config, 'x'.repeat(32001), '2026-10-25', { image: image() }), /32,000/);
  assert.equal(calls, 0);
});
test('the model cannot label an imported assignment ready when it breaks a hard rule', async t => {
  const d = draft(); d.volunteers[0].maxHours = 1;
  t.mock.method(globalThis, 'fetch', async () => response(d));
  const result = await interpretEventSetup(config, '', '2026-10-25', { image: image() });
  assert.equal(result.status, 'clarification'); assert.match(result.issues.join(' '), /hour limit/);
  assert.deepEqual(result.draft.assignments, d.assignments);
});
test('imported placements compile deterministically while unrelated places remain open', () => {
  const input = draft(), before = structuredClone(input), state = compileSetupDraft(input);
  assert.deepEqual(input, before); assert.deepEqual(state.schedule, { 's-1': ['v-1'], 's-2': ['v-2'] });
  assert.deepEqual(state.history, []); assert.equal(state.volunteers[1].name, 'রহিম');
});
test('bad placement references, duplicates, overlaps, unavailable volunteers, hours and capacity are blocked', () => {
  for (const mutate of [
    d => { d.assignments[0].volunteerIndex = 9; },
    d => { d.assignments[0].shiftIndex = -1; },
    d => { d.assignments.push({ ...d.assignments[0] }); },
    d => { d.shifts[1].start = '11:00'; d.assignments.push({ volunteerIndex: 0, shiftIndex: 1 }); },
    d => { d.volunteers[0].availability = [['12:00', '14:00']]; },
    d => { d.volunteers[0].maxHours = 1; },
    d => { d.shifts[0].required = 1; d.assignments.push({ volunteerIndex: 1, shiftIndex: 0 }); }
  ]) { const d = draft(); mutate(d); assert.throws(() => compileSetupDraft(d)); }
  const d = draft(); delete d.assignments; assert.deepEqual(reviewSetupDraft(d).draft.assignments, []);
});
test('hosted photo parsing requires sign-in before Google and requires an actual photo', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Unexpected request'); });
  const hosted = createApi({ NETLIFY: 'true', SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key' });
  assert.equal((await hosted(post('/api/setup/photo', { image: image() }))).status, 401);
  assert.equal(calls, 0);
  const local = createApi({ GEMINI_API_KEY: config.key });
  assert.equal((await local(post('/api/setup/photo', { request: 'My event' }))).status, 400);
});
test('photo import has a larger allowance than event JSON and never writes during interpretation', async t => {
  let modelCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => { assert.match(String(url), /generativelanguage/); modelCalls++; return response(draft()); });
  const api = createApi({ GEMINI_API_KEY: config.key });
  const bytes = Buffer.alloc(900000); Buffer.from(image().data, 'base64').copy(bytes);
  const body = { image: { mimeType: 'image/png', data: bytes.toString('base64') } };
  assert.equal((await api(post('/api/setup/photo', body))).status, 200);
  assert.equal((await api(post('/api/setup/interpret', { ...body, request: 'Event' }))).status, 413);
  assert.equal(modelCalls, 1);
});
test('reviewed imported assignments are rechecked before save and no image reaches storage', async t => {
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'owner', email: 'owner@example.test', is_anonymous: false }));
    assert.match(String(url), /rpc\/shiftrescue_save_event/); writes++;
    const params = JSON.parse(options.body); assert.equal(params.p_event_id, null);
    assert.deepEqual(params.p_state.schedule, { 's-1': ['v-1'], 's-2': ['v-2'] });
    assert.equal(params.p_state.image, undefined); assert.equal(params.p_state.assignments, undefined);
    return new Response(JSON.stringify({ id: 'new-event', version: 1, state: params.p_state }));
  });
  const api = createApi({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key' });
  const invalid = draft(); invalid.volunteers[0].maxHours = 0;
  assert.equal((await api(post('/api/setup/create', { draft: invalid }, 'sr_access=fixture-token'))).status, 400);
  assert.equal(writes, 0);
  assert.equal((await api(post('/api/setup/create', { draft: { ...draft(), image: image() }, eventId: 'must-not-overwrite' }, 'sr_access=fixture-token'))).status, 201);
  assert.equal(writes, 1);
});
