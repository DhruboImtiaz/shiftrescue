import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.mjs';
import { demo } from '../test-fixtures/events.mjs';

const eventId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const env = { SUPABASE_URL: 'https://collaboration-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key', PROPOSAL_SECRET: 'collaboration-test-secret-'.repeat(3) };
const request = (path, body, { signedIn = true, origin = 'https://shiftrescue.netlify.app' } = {}) => new Request(`https://shiftrescue.netlify.app${path}`, { headers: { ...(signedIn ? { cookie: 'sr_access=test-access' } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json', origin }) }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function fixture(t, role = 'viewer') {
  const calls = [], state = { role, version: 1 };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(typeof url === 'string' ? url : url.url).pathname;
    if (path === '/auth/v1/user') return json({ id: userId, email: 'test@example.test', is_anonymous: false });
    const operation = path.split('/').at(-1), input = JSON.parse(options.body);
    calls.push({ operation, input });
    if (operation === 'shiftrescue_load_event') return json({ id: eventId, role: state.role, version: state.version, state: structuredClone(demo) });
    if (operation === 'shiftrescue_event_status') return json({ id: eventId, role: state.role, version: state.version, pendingRequests: 0 });
    if (['shiftrescue_event_sharing', 'shiftrescue_decide_access', 'shiftrescue_rotate_event_code', 'shiftrescue_requester_avatar'].includes(operation)) return state.role === 'owner' ? json({ eventId, code: 'ABCDEF123456', requests: [], members: [] }) : json({ code: '42501', message: 'Only the event owner can manage sharing.' }, 403);
    if (operation === 'shiftrescue_request_access') return input.p_code === '000000000000' ? json({ error: 'Too many code attempts.', status: 429 }) : json({ message: 'Request sent.', status: 'pending', eventId });
    if (operation === 'shiftrescue_my_requests') return json([{ eventId, requestedRole: 'editor', status: 'pending' }]);
    if (operation === 'shiftrescue_save_event') return json({ id: eventId, role: state.role, version: ++state.version, state: { ...input.p_state, history: [] } });
    throw new Error(`Unexpected endpoint ${path}`);
  });
  return { api: createApi(env), calls, state };
}

test('sharing, request status and profile-photo routes require authentication', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Unexpected provider call'); });
  const api = createApi(env);
  for (const [path, body] of [['/api/access/requests'], ['/api/access/request', { code: 'ABCDEF123456', role: 'viewer' }], [`/api/events/${eventId}/sharing`], [`/api/events/${eventId}/sharing`, { action: 'rotate' }], [`/api/events/${eventId}/status`], [`/api/events/${eventId}/people/${userId}/avatar`]]) assert.equal((await api(request(path, body, { signedIn: false }))).status, 401);
  assert.equal(calls, 0);
});
test('requesting access preserves the selected role and returns a pending status', async t => {
  const { api, calls } = fixture(t);
  const response = await api(request('/api/access/request', { code: 'abcd-ef12-3456', role: 'editor' }));
  assert.equal(response.status, 200); assert.equal((await response.json()).status, 'pending');
  assert.deepEqual(calls[0], { operation: 'shiftrescue_request_access', input: { p_code: 'abcd-ef12-3456', p_role: 'editor' } });
  assert.equal((await api(request('/api/access/requests'))).status, 200);
});
test('invalid codes, fabricated roles and cross-site sharing changes never reach the database', async t => {
  const { api, calls } = fixture(t, 'owner');
  for (const input of [{ code: 'bad', role: 'viewer' }, { code: 'ABCDEF123456', role: 'owner' }, { code: [], role: 'editor' }]) assert.equal((await api(request('/api/access/request', input))).status, 400);
  assert.equal((await api(request(`/api/events/${eventId}/sharing`, { action: 'rotate' }, { origin: 'https://another-site.test' }))).status, 403);
  assert.equal(calls.length, 0);
});
test('database rate limits remain actionable HTTP errors', async t => {
  const { api } = fixture(t);
  const response = await api(request('/api/access/request', { code: '000000000000', role: 'viewer' }));
  assert.equal(response.status, 429); assert.match((await response.json()).error, /Too many/);
});
test('viewers can read events and status, but cannot interpret, preview, edit, or apply', async t => {
  const { api, calls } = fixture(t);
  assert.equal((await api(request(`/api/events/${eventId}`))).status, 200);
  assert.equal((await api(request(`/api/events/${eventId}/status`))).status, 200);
  for (const [path, body] of [[`/api/events/${eventId}/setup`, { state: demo, expectedVersion: 1 }], [`/api/events/${eventId}/apply`, { proposalId: 'old-proof' }], ['/api/repair', { eventId, expectedVersion: 1 }], ['/api/interpret', { eventId, request: 'Change a shift' }], ['/api/voice/transcribe', { eventId, audio: Buffer.alloc(64).toString('base64'), mimeType: 'audio/wav', language: 'auto' }]]) assert.equal((await api(request(path, body))).status, 403, path);
  assert.ok(calls.every(c => ['shiftrescue_load_event', 'shiftrescue_event_status'].includes(c.operation)));
});
test('only owners can read requests, approve members, rotate codes or preview requester photos', async t => {
  const { api } = fixture(t, 'editor');
  for (const [path, body] of [[`/api/events/${eventId}/sharing`], [`/api/events/${eventId}/sharing`, { userId, decision: 'editor' }], [`/api/events/${eventId}/sharing`, { action: 'rotate' }], [`/api/events/${eventId}/people/${userId}/avatar`]]) assert.equal((await api(request(path, body))).status, 403);
});
test('a previously signed preview cannot be applied after edit access is removed', async t => {
  const { api, calls, state } = fixture(t, 'editor');
  const preview = await api(request('/api/repair', { eventId, expectedVersion: 1, changes: [] }));
  assert.equal(preview.status, 200); const { proposalId } = await preview.json(); assert.ok(proposalId);
  state.role = 'viewer'; state.version++;
  assert.equal((await api(request(`/api/events/${eventId}/apply`, { proposalId }))).status, 403);
  assert.ok(!calls.some(c => c.operation === 'shiftrescue_save_event'));
});
test('owner decisions bind the event and requester IDs and reject invented decisions', async t => {
  const { api, calls } = fixture(t, 'owner');
  assert.equal((await api(request(`/api/events/${eventId}/sharing`, { userId, decision: 'viewer' }))).status, 200);
  assert.deepEqual(calls.at(-1).input, { p_event_id: eventId, p_user_id: userId, p_decision: 'viewer' });
  assert.equal((await api(request(`/api/events/${eventId}/sharing`, { userId, decision: 'owner' }))).status, 400);
});
