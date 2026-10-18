import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudService, readCookies, sessionCookies, validateEventState } from '../src/cloud.mjs';
import { demo } from '../src/demo.mjs';

const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; } });
const service = factory => cloudService({ url: 'https://test.supabase.co', key: 'test-publishable-key', createSupabaseClient: factory });

test('sessions are HttpOnly and cannot leak through browser storage', () => {
  const cookies = sessionCookies({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }, true);
  assert.equal(cookies.length, 2);
  cookies.forEach(value => { assert.match(value, /HttpOnly/); assert.match(value, /SameSite=Lax/); assert.match(value, /Secure/); });
  assert.ok(sessionCookies(null).every(value => value.includes('Max-Age=0')));
});
test('cookie parsing handles malformed input without authenticating it', () => {
  assert.deepEqual(readCookies('invalid; sr_access=token; broken=%zz'), { sr_access: 'token' });
});
test('an absent session cannot access a saved event', async () => {
  const cloud = service(() => { throw new Error('Unexpected database call'); });
  await assert.rejects(cloud.session({ headers: {} }, response(), true), error => error.status === 401);
});
test('a forged cookie is checked with Supabase and rejected', async () => {
  let checks = 0;
  const cloud = service(() => ({ auth: { getUser: async () => { checks++; return { data: {}, error: { message: 'Invalid token' } }; } } }));
  const res = response();
  await assert.rejects(cloud.session({ headers: { cookie: 'sr_access=forged' } }, res, true), error => error.status === 401);
  assert.equal(checks, 1); assert.ok(res.headers['Set-Cookie'].every(c => c.includes('Max-Age=0')));
});
test('database access uses the verified user token, not a privileged key', async () => {
  const calls = [];
  const cloud = service((_url, _key, options) => { calls.push(options); return { auth: { getUser: async token => ({ data: { user: { id: 'owner', email: 'owner@example.test', is_anonymous: false } }, error: null }) } }; });
  const active = await cloud.session({ headers: { cookie: 'sr_access=verified-token' } }, response(), true);
  assert.equal(active.user.id, 'owner'); assert.equal(calls.at(-1).global.headers.Authorization, 'Bearer verified-token');
  assert.equal(calls[0].auth.persistSession, false);
});
test('anonymous identities are not accepted by this email/password app', async () => {
  const cloud = service(() => ({ auth: { getUser: async () => ({ data: { user: { id: 'guest', is_anonymous: true } }, error: null }) } }));
  await assert.rejects(cloud.session({ headers: { cookie: 'sr_access=guest-token' } }, response(), true), error => error.status === 401);
});
test('refreshing a session rotates cookies before querying as that user', async () => {
  const cloud = service(() => ({ auth: { refreshSession: async () => ({ data: { session: { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }, user: { id: 'owner', is_anonymous: false } }, error: null }) } }));
  const res = response(), active = await cloud.session({ headers: { cookie: 'sr_refresh=old-refresh' } }, res, true);
  assert.equal(active.access, 'new-access'); assert.match(res.headers['Set-Cookie'][0], /new-access/);
});
test('invalid schedules and impossible calendar dates cannot be cloud saved', () => {
  const invalid = structuredClone(demo); invalid.schedule['help-14'] = ['arif', 'tanvir'];
  assert.throws(() => validateEventState(invalid), /rules are broken/);
  assert.throws(() => validateEventState({ ...demo, date: '2026-02-31' }), /valid date/);
  assert.throws(() => validateEventState({ ...demo, timezone: 'Europe/London' }), /timezone/);
});
test('a stale database version becomes an actionable HTTP conflict', async () => {
  const cloud = service(() => ({}));
  const active = { db: { rpc: async () => ({ data: null, error: { code: 'PT409', message: 'Conflict' } }) } };
  await assert.rejects(cloud.save(active, 'event-id', 1, demo), error => error.status === 409 && /newer event version/.test(error.message));
});
test('a cloud save passes expected version and strips client-supplied history', async () => {
  let call;
  const cloud = service(() => ({}));
  const active = { db: { rpc: async (name, params) => { call = { name, params }; return { data: { id: 'event-id', version: 2, state: structuredClone(demo) }, error: null }; } } };
  await cloud.save(active, 'event-id', 1, { ...demo, history: [{ title: 'Untrusted audit row' }] });
  assert.equal(call.name, 'shiftrescue_save_event'); assert.equal(call.params.p_expected_version, 1);
  assert.equal(call.params.p_state.history, undefined);
});
