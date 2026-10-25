import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudService } from '../src/cloud.mjs';
import { createApi } from '../src/api.mjs';
const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; } });
const service = factory => cloudService({ url: 'https://test.supabase.co', key: 'fixture-key', createSupabaseClient: factory });
const valid = { data: { user: { id: 'owner', is_anonymous: false } }, error: null };
test('temporary authentication failures preserve cookies and return a retryable error', async () => {
  for (const failure of [{ error: { status: 503 } }, { error: { status: 429 } }, { error: { name: 'AuthRetryableFetchError', status: 0 } }]) {
    const cloud = service(() => ({ auth: { getUser: async () => ({ data: {}, ...failure }) } })), res = response();
    await assert.rejects(cloud.session({ headers: { cookie: 'sr_access=kept-access; sr_refresh=kept-refresh' } }, res, true), e => e.status === 503);
    assert.equal(res.headers['Set-Cookie'], undefined);
  }
});
test('network exceptions during access validation do not sign the user out', async () => {
  const cloud = service(() => ({ auth: { getUser: async () => { throw new TypeError('fetch failed'); } } })), res = response();
  await assert.rejects(cloud.session({ headers: { cookie: 'sr_access=kept' } }, res), e => e.status === 503);
  assert.equal(res.headers['Set-Cookie'], undefined);
});
test('a failed refresh can be retried immediately without losing its cookie', async () => {
  let attempts = 0;
  const cloud = service(() => ({ auth: { refreshSession: async () => ++attempts === 1 ? { data: {}, error: { status: 503 } } : { data: { ...valid.data, session: { access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600 } }, error: null } } }));
  const req = { headers: { cookie: 'sr_refresh=kept' } }, first = response();
  await assert.rejects(cloud.session(req, first, true), e => e.status === 503); assert.equal(first.headers['Set-Cookie'], undefined);
  const next = response(), active = await cloud.session(req, next, true); assert.equal(active.user.id, 'owner'); assert.equal(attempts, 2);
  assert.match(next.headers['Set-Cookie'][0], /rotated-access/);
});
test('confirmed revoked refresh tokens still clear invalid credentials', async () => {
  const cloud = service(() => ({ auth: { refreshSession: async () => ({ data: {}, error: { status: 400, code: 'refresh_token_not_found' } }) } })), res = response();
  await assert.rejects(cloud.session({ headers: { cookie: 'sr_refresh=revoked' } }, res, true), e => e.status === 401);
  assert.ok(res.headers['Set-Cookie'].every(c => c.includes('Max-Age=0')));
});
test('event lists include all pages and explicitly separate active events from Trash', async () => {
  const requests = [];
  const active = { db: { from: () => {
    const query = { select() { return this; }, is(column, value) { requests.push(['active', column, value]); return this; }, not(column, op, value) { requests.push(['trash', column, op, value]); return this; }, order() { return this; }, async range(start, end) { requests.push(['range', start, end]); return { data: start === 0 ? Array.from({ length: 200 }, (_, i) => ({ id: `${i}` })) : [{ id: '201' }], error: null }; } }; return query;
  } } };
  const cloud = service(() => ({}));
  assert.equal((await cloud.list(active)).length, 201); assert.ok(requests.some(r => r[0] === 'active'));
  requests.length = 0; assert.equal((await cloud.list(active, { deleted: true })).length, 201); assert.ok(requests.some(r => r[0] === 'trash'));
});
test('delete and restore use the verified client and bind the expected version', async () => {
  const calls = [], cloud = service(() => ({})), id = '11111111-1111-4111-8111-111111111111';
  const active = { db: { rpc: async (fn, params) => { calls.push({ fn, params }); return { data: { id, version: 3 }, error: null }; } } };
  await cloud.setDeleted(active, id, 2, true); await cloud.setDeleted(active, id, 3, false);
  assert.equal(calls[0].fn, 'shiftrescue_set_event_deleted'); assert.equal(calls[0].params.p_expected_version, 2);
  assert.equal(calls[0].params.p_deleted, true); assert.equal(calls[1].params.p_deleted, false);
  await assert.rejects(cloud.setDeleted(active, id, undefined, true)); assert.equal(calls.length, 2);
});
test('stale and cross-owner lifecycle operations return conflicts and not-found errors', async () => {
  const cloud = service(() => ({}));
  for (const [code, status] of [['PT409',409], ['PT404',404]]) await assert.rejects(cloud.setDeleted({ db: { rpc: async () => ({ error: { code, message: 'Not available' } }) } }, '11111111-1111-4111-8111-111111111111', 1, true), e => e.status === status);
});
test('event deletion, restoration and Trash listing require a signed-in owner', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Unexpected provider access'); });
  const api = createApi({ NETLIFY: 'true', SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'fixture-key' });
  for (const action of ['delete','restore']) {
    const response = await api(new Request(`https://shiftrescue.netlify.app/api/events/11111111-1111-4111-8111-111111111111/${action}`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body:'{"expectedVersion":1}' }));
    assert.equal(response.status, 401);
  }
  assert.equal((await api(new Request('https://shiftrescue.netlify.app/api/events/trash'))).status,401); assert.equal(calls,0);
});
test('the application no longer exposes a public demo event', async () => {
  assert.equal((await createApi({})(new Request('https://shiftrescue.netlify.app/api/demo'))).status,404);
});
