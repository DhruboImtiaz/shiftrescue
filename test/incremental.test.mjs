import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSchedule, editSchedule, repairSchedule, retainValidAssignments, validateChanges } from '../src/scheduler.mjs';
import { createApi, normalizeSetup } from '../src/api.mjs';
import { validateEventState } from '../src/cloud.mjs';
import { proposalTokens } from '../src/proposals.mjs';

const fixture = () => ({
  event: 'Incremental verification', date: '2026-10-24', timezone: 'Asia/Dhaka', history: [],
  volunteers: [{ id: 's1', name: 's1', skills: [], availability: [[600, 840]], maxHours: 4 }, { id: 's2', name: 's2', skills: [], availability: [[600, 720]], maxHours: 2 }],
  shifts: [{ id: 'a1', station: 'a1', start: 600, end: 720, required: 2, skills: [] }, { id: 'b1', station: 'b1', start: 600, end: 840, required: 2, skills: [] }, { id: 'c1', station: 'c1', start: 720, end: 840, required: 3, skills: [] }],
  schedule: { a1: [], b1: [], c1: [] }
});
const add = (volunteerId, shiftId) => ({ type: 'assign', volunteerId, shiftId });
const remove = (volunteerId, shiftId) => ({ type: 'unassign', volunteerId, shiftId });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const request = (path, body) => new Request(`https://shiftrescue.netlify.app${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: 'sr_access=test-token' }, body: JSON.stringify(body) });

test('one volunteer can be added while unrelated shifts cannot be completed', () => {
  const state = fixture(), before = structuredClone(state);
  assert.equal(repairSchedule(state.volunteers, state.shifts, state.schedule).status, 'infeasible');
  const first = editSchedule(state.volunteers, state.shifts, state.schedule, [add('s1', 'a1')]);
  assert.equal(first.status, 'partial');
  assert.equal(first.mode, 'incremental');
  assert.deepEqual(first.schedule, { a1: ['s1'], b1: [], c1: [] });
  assert.equal(first.openPlaces, 6);
  assert.ok(first.warnings.length);
  const second = editSchedule(first.volunteers, state.shifts, first.schedule, [add('s2', 'a1')]);
  assert.deepEqual(second.schedule, { a1: ['s1', 's2'], b1: [], c1: [] });
  assert.deepEqual(state, before);
});

test('one placement can be removed without clearing other volunteers', () => {
  const state = fixture(); state.schedule.a1 = ['s1', 's2'];
  const result = editSchedule(state.volunteers, state.shifts, state.schedule, [remove('s1', 'a1')]);
  assert.deepEqual(result.schedule, { a1: ['s2'], b1: [], c1: [] });
  assert.deepEqual(result.differences[0].removed, ['s1']);
});

test('moves are atomic even when the add is listed before the removal', () => {
  const state = fixture(); state.schedule.a1 = ['s1', 's2'];
  const result = editSchedule(state.volunteers, state.shifts, state.schedule, [add('s1', 'b1'), remove('s1', 'a1')]);
  assert.deepEqual(result.schedule, { a1: ['s2'], b1: ['s1'], c1: [] });
  assert.equal(result.status, 'partial');
});

test('replacing a volunteer on a full shift does not require other shifts to be filled', () => {
  const state = fixture(); state.shifts[0].required = 1; state.schedule.a1 = ['s1'];
  assert.equal(editSchedule(state.volunteers, state.shifts, state.schedule, [add('s2', 'a1')]).status, 'conflict');
  const replaced = editSchedule(state.volunteers, state.shifts, state.schedule, [add('s2', 'a1'), remove('s1', 'a1')]);
  assert.deepEqual(replaced.schedule, { a1: ['s2'], b1: [], c1: [] });
});

test('missing skill coverage is a visible gap, not a barrier to building the schedule', () => {
  const state = fixture(); state.shifts[0].skills = ['first-aid'];
  const result = editSchedule(state.volunteers, state.shifts, state.schedule, [add('s1', 'a1')]);
  assert.equal(result.status, 'partial');
  assert.match(result.warnings.join(' '), /missing first-aid/);
  assert.equal(checkSchedule(state.volunteers, state.shifts, result.schedule).valid, false);
  assert.doesNotThrow(() => validateEventState({ ...state, schedule: result.schedule }));
});

test('partial edits still reject overlapping assignments and preserve accepted state', () => {
  const state = fixture(); state.schedule.a1 = ['s1']; const before = structuredClone(state);
  const result = editSchedule(state.volunteers, state.shifts, state.schedule, [add('s1', 'b1')]);
  assert.equal(result.status, 'conflict');
  assert.equal(result.schedule, null);
  assert.match(result.diagnostics.join(' '), /overlapping/);
  assert.deepEqual(state, before);
});

test('partial edits reject unavailable volunteers and excessive total hours', () => {
  const state = fixture();
  assert.match(editSchedule(state.volunteers, state.shifts, state.schedule, [add('s2', 'c1')]).diagnostics.join(' '), /unavailable/);
  state.volunteers[0].maxHours = 2; state.schedule.a1 = ['s1'];
  assert.match(editSchedule(state.volunteers, state.shifts, state.schedule, [add('s1', 'c1')]).diagnostics.join(' '), /hour limit/);
});

test('availability edits reopen only affected placements and keep other people assigned', () => {
  const state = fixture(); state.schedule.a1 = ['s1', 's2'];
  const result = editSchedule(state.volunteers, state.shifts, state.schedule, [{ type: 'unavailable', volunteerId: 's1', start: '10:00', end: '12:00' }]);
  assert.deepEqual(result.schedule, { a1: ['s2'], b1: [], c1: [] });
  assert.deepEqual(result.volunteers[0].availability, [[720, 840]]);
});

test('setup changes preserve partial assignments when adding shifts or removing a volunteer', () => {
  const state = fixture(); state.schedule.a1 = ['s1', 's2'];
  const expanded = normalizeSetup({ ...state, shifts: [...state.shifts, { id: 'd1', station: 'Later', start: 840, end: 960, required: 1, skills: [] }] });
  assert.deepEqual(expanded.schedule.a1, ['s1', 's2']);
  assert.deepEqual(expanded.schedule.d1, []);
  const removed = normalizeSetup({ ...state, volunteers: state.volunteers.filter(p => p.id !== 's1') });
  assert.deepEqual(removed.schedule.a1, ['s2']);
});

test('retaining placements after an hour reduction keeps unaffected volunteers', () => {
  const state = fixture(); state.schedule.a1 = ['s1', 's2']; state.schedule.c1 = ['s1']; state.volunteers[0].maxHours = 2;
  assert.deepEqual(retainValidAssignments(state.volunteers, state.shifts, state.schedule), { a1: ['s1', 's2'], b1: [], c1: [] });
});

test('invalid partial states cannot bypass personal assignment rules during cloud saves', () => {
  const state = fixture(); state.schedule.a1 = ['s1', 's1'];
  assert.throws(() => validateEventState(state), /rules are broken/);
  state.volunteers[0].maxHours = 8; state.schedule.a1 = ['s1']; state.schedule.b1 = ['s1'];
  assert.throws(() => validateEventState(state), /overlapping/);
});

test('placement references and contradictory requests are rejected before editing', () => {
  const state = fixture();
  assert.throws(() => validateChanges([remove('s1', 'missing')], state.volunteers, state.shifts), /unknown shift/);
  assert.throws(() => editSchedule(state.volunteers, state.shifts, state.schedule, [add('s1', 'a1'), remove('s1', 'a1')]), /both added to and removed/);
});

const eventId = '11111111-1111-4111-8111-111111111111';
const secret = 'incremental-test-secret-'.repeat(3);
const env = { SUPABASE_URL: 'https://incremental-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key', PROPOSAL_SECRET: secret };
function cloudFixture(t) {
  let stored = { id: eventId, role: 'owner', version: 1, state: fixture() };
  const saves = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(typeof url === 'string' ? url : url.url).pathname;
    if (path === '/auth/v1/user') return json({ id: 'owner', email: 'owner@example.test', is_anonymous: false });
    if (path.endsWith('/shiftrescue_load_event')) return json(stored);
    if (path.endsWith('/shiftrescue_save_event')) {
      const input = JSON.parse(options.body);
      if (input.p_expected_version !== stored.version) return json({ code: 'PT409', message: 'Stale version' }, 409);
      saves.push(input); stored = { id: eventId, role: 'owner', version: stored.version + 1, state: { ...input.p_state, history: [] } }; return json(stored);
    }
    throw new Error(`Unexpected endpoint: ${path}`);
  });
  return { saves, read: () => stored };
}

test('partial cloud edits save, reload, and accept the next volunteer one at a time', async t => {
  const cloud = cloudFixture(t);
  for (const [index, id] of ['s1', 's2'].entries()) {
    const response = await createApi(env)(request('/api/repair', { eventId, expectedVersion: index + 1, changes: [add(id, 'a1')] }));
    assert.equal(response.status, 200);
    const preview = await response.json();
    assert.equal(preview.mode, 'incremental'); assert.equal(preview.status, 'partial'); assert.equal(cloud.saves.length, index);
    assert.equal(proposalTokens(secret).read(preview.proposalId, 'owner', eventId).mode, 'incremental');
    const saved = await createApi(env)(request(`/api/events/${eventId}/apply`, { proposalId: preview.proposalId }));
    assert.equal(saved.status, 200);
    const reloaded = await createApi(env)(new Request(`https://shiftrescue.netlify.app/api/events/${eventId}`, { headers: { cookie: 'sr_access=test-token' } }));
    assert.equal(reloaded.status, 200);
    assert.equal((await reloaded.json()).state.schedule.a1.length, index + 1);
    assert.deepEqual(cloud.read().state.schedule.b1, []); assert.deepEqual(cloud.read().state.schedule.c1, []);
  }
  assert.equal(cloud.read().version, 3);
});

test('saving a removed placement survives a new function instance and reload', async t => {
  const cloud = cloudFixture(t); cloud.read().state.schedule.a1 = ['s1'];
  const response = await createApi(env)(request('/api/repair', { eventId, expectedVersion: 1, changes: [remove('s1', 'a1')] }));
  const preview = await response.json();
  assert.deepEqual(preview.assignments, [remove('s1', 'a1')]);
  assert.equal((await createApi(env)(request(`/api/events/${eventId}/apply`, { proposalId: preview.proposalId }))).status, 200);
  assert.deepEqual(cloud.read().state.schedule, fixture().schedule);
});

test('stale partial previews cannot overwrite a newer saved assignment', async t => {
  const cloud = cloudFixture(t), api = createApi(env);
  const a = await (await api(request('/api/repair', { eventId, expectedVersion: 1, changes: [add('s1', 'a1')] }))).json();
  const b = await (await api(request('/api/repair', { eventId, expectedVersion: 1, changes: [add('s2', 'a1')] }))).json();
  assert.equal((await api(request(`/api/events/${eventId}/apply`, { proposalId: a.proposalId }))).status, 200);
  assert.equal((await api(request(`/api/events/${eventId}/apply`, { proposalId: b.proposalId }))).status, 409);
  assert.deepEqual(cloud.read().state.schedule.a1, ['s1']); assert.equal(cloud.saves.length, 1);
});

test('a partial preview cannot be applied as a fully completed schedule', async t => {
  const cloud = cloudFixture(t); const state = fixture(); state.schedule.a1 = ['s1'];
  const token = proposalTokens(secret).issue({ userId: 'owner', eventId, version: 1, mode: 'complete', state, assignments: [add('s1', 'a1')] });
  assert.equal((await createApi(env)(request(`/api/events/${eventId}/apply`, { proposalId: token }))).status, 409);
  assert.equal(cloud.saves.length, 0);
});

test('a signed removal is revalidated before saving', async t => {
  const cloud = cloudFixture(t); const state = fixture(); state.schedule.a1 = ['s1'];
  const token = proposalTokens(secret).issue({ userId: 'owner', eventId, version: 1, mode: 'incremental', state, assignments: [remove('s1', 'a1')] });
  assert.equal((await createApi(env)(request(`/api/events/${eventId}/apply`, { proposalId: token }))).status, 409);
  assert.equal(cloud.saves.length, 0);
});

test('complete schedule generation remains explicit and does not save an infeasible result', async t => {
  const cloud = cloudFixture(t);
  const response = await createApi(env)(request('/api/repair', { eventId, expectedVersion: 1, changes: [] }));
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.mode, 'complete'); assert.equal(result.status, 'infeasible'); assert.equal(result.schedule, null);
  assert.equal(cloud.saves.length, 0);
});
