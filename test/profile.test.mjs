import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudService } from '../src/cloud.mjs';
import { validateProfile } from '../src/profile.mjs';
import { createApi } from '../src/api.mjs';

const input = { name: ' Nadia Rahman ', username: 'Nadia.R', phone: '+880 (170) 000-0000', bio: 'Ready to help.' };
const row = { name: 'Nadia', username: 'nadia.r', phone: '+8801700000000', bio: '', avatar_path: 'owner/old.jpg', updated_at: '2026-10-31T00:00:00Z' };
const image = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=' };
const response = () => ({ setHeader() {} });
function service(factory = () => ({})) { return cloudService({ url: 'https://test.supabase.co', key: 'publishable', createSupabaseClient: factory }); }
function activeDatabase({ conflict = false, lostResponse = false } = {}) {
  const calls = [];
  const bucket = { upload: async (path, bytes, options) => { calls.push({ type: 'upload', path, bytes, options }); return { error: null }; }, remove: async paths => { calls.push({ type: 'remove', paths }); return { error: null }; } };
  const active = { user: { id: 'owner', email: 'nadia@example.test' }, db: {
    storage: { from: () => bucket },
    from(table) {
      let fields;
      const query = { select() { return query; }, eq(key, value) { calls.push({ type: 'filter', table, key, value }); return query; }, update(value) { fields = value; calls.push({ type: 'update', value }); return query; }, async single() { if (fields && lostResponse) throw new Error('Network response lost'); return fields && conflict ? { error: { code: '23505' } } : { data: { ...row, ...fields }, error: null }; } };
      return query;
    }
  } };
  return { active, calls };
}

test('signup validates contact details and normalizes username/phone before Auth', async () => {
  let credentials;
  const cloud = service(() => ({ auth: { signUp: async value => { credentials = value; return { data: { user: {}, session: null }, error: null }; } } }));
  const account = { ...input, email: 'nadia@example.test', password: 'test-password' };
  await cloud.login(account, response(), true);
  assert.deepEqual(credentials.options.data, { name: 'Nadia Rahman', username: 'nadia.r', phone: '+8801700000000' });
  credentials = null;
  await assert.rejects(cloud.login({ ...account, phone: 'bad' }, response(), true), /phone number/);
  assert.equal(credentials, null);
  assert.throws(() => validateProfile({ ...input, bio: 'x'.repeat(161) }), /bio/);
  assert.throws(() => validateProfile({ ...input, username: '../bad' }), /username/);
});
test('sign-in remains available for existing accounts without profile fields', async () => {
  const cloud = service(() => ({ auth: { signInWithPassword: async credentials => ({ data: { user: { id: 'owner', email: credentials.email }, session: { access_token: 'access', refresh_token: 'refresh' } }, error: null }) } }));
  assert.equal((await cloud.login({ email: 'nadia@example.test', password: 'test-password' }, response())).user.id, 'owner');
});
test('profile updates bind the verified owner and ignore supplied identity/email/path fields', async () => {
  const { active, calls } = activeDatabase();
  const result = await service().saveProfile(active, { ...input, id: 'victim', email: 'victim@example.test', avatar_path: 'victim/photo.jpg' });
  assert.equal(result.email, 'nadia@example.test');
  assert.ok(result.avatarUrl.startsWith('/api/profile/avatar?'));
  assert.deepEqual(calls.find(c => c.type === 'update').value, validateProfile(input));
  assert.ok(calls.filter(c => c.type === 'filter').every(c => c.key === 'id' && c.value === 'owner'));
});
test('replacement uploads first, saves the new path, then removes the old photo', async () => {
  const { active, calls } = activeDatabase();
  await service().saveProfile(active, { ...input, image });
  const operations = calls.filter(c => c.type !== 'filter');
  assert.deepEqual(operations.map(c => c.type), ['upload', 'update', 'remove']);
  assert.match(operations[0].path, /^owner\/[0-9a-f-]{36}\.png$/);
  assert.equal(operations[0].options.upsert, false);
  assert.equal(operations[1].value.avatar_path, operations[0].path);
  assert.deepEqual(operations[2].paths, ['owner/old.jpg']);
});
test('duplicate username cleans up the new upload and preserves the old photo', async () => {
  const { active, calls } = activeDatabase({ conflict: true });
  await assert.rejects(service().saveProfile(active, { ...input, image }), error => error.status === 409 && /already taken/.test(error.message));
  assert.deepEqual(calls.find(c => c.type === 'remove').paths, [calls.find(c => c.type === 'upload').path]);
  assert.ok(!calls.some(c => c.type === 'remove' && c.paths.includes('owner/old.jpg')));
});
test('photo removal clears the reference before deleting the stored image', async () => {
  const { active, calls } = activeDatabase();
  const result = await service().saveProfile(active, { ...input, bio: '', image: null });
  assert.equal(result.avatarUrl, null); assert.equal(result.bio, '');
  assert.deepEqual(calls.filter(c => c.type !== 'filter').map(c => c.type), ['update', 'remove']);
});
test('a lost save response cannot delete a photo the database may already reference', async () => {
  const { active, calls } = activeDatabase({ lostResponse: true });
  await assert.rejects(service().saveProfile(active, { ...input, image }), /Network response lost/);
  assert.ok(!calls.some(c => c.type === 'remove'));
});
test('invalid images cannot change profiles or reach storage', async () => {
  const { active, calls } = activeDatabase();
  await assert.rejects(service().saveProfile(active, { ...input, image: { mimeType: 'image/png', data: 'not-an-image' } }), /photo/);
  assert.ok(!calls.some(c => ['upload', 'update', 'remove'].includes(c.type)));
});
test('profile and photo endpoints require authentication and reject cross-site writes', async () => {
  const api = createApi({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test' });
  for (const path of ['/api/profile', '/api/profile/avatar']) assert.equal((await api(new Request(`https://shiftrescue.netlify.app${path}`))).status, 401);
  for (const path of ['/api/profile', '/api/profile/email']) {
    const request = origin => new Request(`https://shiftrescue.netlify.app${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(input) });
    assert.equal((await api(request('https://shiftrescue.netlify.app'))).status, 401);
    assert.equal((await api(request('https://other.example'))).status, 403);
  }
});
test('email changes use the verified Auth session and preserve the old email pending confirmation', async () => {
  let session, change;
  const cloud = service(() => ({ auth: { setSession: async value => { session = value; return { data: { session: null }, error: null }; }, updateUser: async value => { change = value; return { data: { user: { id: 'owner', email: 'old@example.test', new_email: value.email } }, error: null }; } } }));
  const result = await cloud.changeEmail({ access: 'verified', refresh: 'refresh' }, { email: 'new@example.test', id: 'victim' }, response());
  assert.deepEqual(session, { access_token: 'verified', refresh_token: 'refresh' });
  assert.deepEqual(change, { email: 'new@example.test' });
  assert.equal(result.user.email, 'old@example.test'); assert.match(result.message, /confirm/);
});
