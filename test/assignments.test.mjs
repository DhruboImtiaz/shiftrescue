import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChanges, checkSchedule, repairSchedule, validateChanges } from '../src/scheduler.mjs';
import { interpretRequest } from '../src/gemma.mjs';
import { createApi } from '../src/api.mjs';
import { proposalTokens } from '../src/proposals.mjs';

const fixture = () => ({
  event: 'Assignment verification', date: '2026-10-24', timezone: 'Asia/Dhaka', history: [],
  volunteers: ['s1', 's2', 's3'].map(id => ({ id, name: id, skills: [], availability: [[600, 840]], maxHours: 4 })),
  shifts: [{ id: 'a1', station: 'a1', start: 600, end: 720, required: 1, skills: [] }, { id: 'c1', station: 'c1', start: 720, end: 840, required: 1, skills: [] }],
  schedule: { a1: ['s3'], c1: ['s1'] }
});
const assign = (volunteerId, shiftId) => ({ type: 'assign', volunteerId, shiftId });
const assignments = [assign('s1', 'a1'), assign('s2', 'c1')];
const request = (path, body) => new Request(`https://shiftrescue.netlify.app${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: 'sr_access=test-access' }, body: JSON.stringify(body) });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('requested placements override the minimum-change preference without mutating the accepted rota', () => {
  const state = fixture(), before = structuredClone(state);
  const result = repairSchedule(state.volunteers, state.shifts, state.schedule, { assignments });
  assert.equal(result.status, 'feasible');
  assert.deepEqual(result.schedule, { a1: ['s1'], c1: ['s2'] });
  assert.equal(result.changedAssignments, 2);
  assert.ok(checkSchedule(state.volunteers, state.shifts, result.schedule, { assignments }).valid);
  assert.deepEqual(state, before);
});

test('assignments can be mixed with availability and hour changes without creating availability', () => {
  const state = fixture();
  const changes = [assign('s1', 'a1'), { type: 'max_hours', volunteerId: 's1', hours: 2 }, { type: 'unavailable', volunteerId: 's2', start: '10:00', end: '12:00' }];
  const people = applyChanges(state.volunteers, changes, state.shifts);
  assert.equal(people[0].maxHours, 2);
  assert.deepEqual(people[0].availability, [[600, 840]]);
  assert.deepEqual(people[1].availability, [[720, 840]]);
  const result = repairSchedule(people, state.shifts, state.schedule, { assignments: [changes[0]] });
  assert.equal(result.status, 'feasible');
  assert.deepEqual(result.schedule.a1, ['s1']);
  assert.ok(!result.schedule.c1.includes('s1'));
});

test('unknown volunteer and shift IDs are rejected before solving', () => {
  const state = fixture();
  assert.throws(() => validateChanges([assign('missing', 'a1')], state.volunteers, state.shifts), /unknown volunteer/);
  assert.throws(() => validateChanges([assign('s1', 'missing')], state.volunteers, state.shifts), /unknown shift/);
  assert.throws(() => repairSchedule(state.volunteers, state.shifts, state.schedule, { assignments: [assign('s1', 'missing')] }), /unknown shift/);
  assert.throws(() => validateChanges(Array(25).fill(assign('s1', 'a1')), state.volunteers, state.shifts), /24 changes/);
});

test('requesting an unavailable volunteer returns a conflict instead of dropping the assignment', () => {
  const state = fixture(); state.volunteers[0].availability = [[720, 840]];
  const result = repairSchedule(state.volunteers, state.shifts, state.schedule, { assignments });
  assert.equal(result.status, 'infeasible');
  assert.equal(result.schedule, null);
  assert.match(result.diagnostics.join(' '), /assigning s1/);
});

test('requested assignments cannot exceed staffing capacity', () => {
  const state = fixture();
  const result = repairSchedule(state.volunteers, state.shifts, state.schedule, { assignments: [assign('s1', 'a1'), assign('s2', 'a1')] });
  assert.equal(result.status, 'infeasible');
  assert.equal(result.schedule, null);
});

test('requested assignments cannot bypass collective skill coverage', () => {
  const state = fixture(); state.shifts[0].skills = ['first-aid']; state.volunteers[2].skills = ['first-aid'];
  const result = repairSchedule(state.volunteers, state.shifts, state.schedule, { assignments });
  assert.equal(result.status, 'infeasible');
  assert.equal(result.schedule, null);
});

test('one requested volunteer cannot be double booked on overlapping shifts', () => {
  const state = fixture(); state.shifts[1].start = 660;
  const result = repairSchedule(state.volunteers, state.shifts, state.schedule, { assignments: [assign('s1', 'a1'), assign('s1', 'c1')] });
  assert.equal(result.status, 'infeasible');
  assert.equal(result.schedule, null);
  assert.match(result.diagnostics.join(' '), /requested assignments.*overlapping/);
});

test('total-hour limits still apply across multiple requested placements', () => {
  const state = fixture(); state.volunteers[0].maxHours = 2;
  const result = repairSchedule(state.volunteers, state.shifts, state.schedule, { assignments: [assign('s1', 'a1'), assign('s1', 'c1')] });
  assert.equal(result.status, 'infeasible');
  assert.equal(result.schedule, null);
});

test('group shifts accept several requested volunteers and ignore repeated identical requirements', () => {
  const state = fixture(); state.shifts[0].required = 2;
  const required = [assign('s1', 'a1'), assign('s2', 'a1'), assign('s1', 'a1')];
  const result = repairSchedule(state.volunteers, state.shifts, state.schedule, { assignments: required });
  assert.equal(result.status, 'feasible');
  assert.deepEqual(new Set(result.schedule.a1), new Set(['s1', 's2']));
});

test('final validation detects an otherwise valid rota that omits a requested placement', () => {
  const state = fixture();
  assert.ok(checkSchedule(state.volunteers, state.shifts, state.schedule).valid);
  const result = checkSchedule(state.volunteers, state.shifts, state.schedule, { assignments });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /s1 must be assigned to a1/);
});

test('Gemma assignment output reaches the solver as validated existing IDs', async t => {
  const state = fixture();
  t.mock.method(globalThis, 'fetch', async () => json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ status: 'ready', message: 'Assign s1 to a1 and s2 to c1.', changes: assignments }) }] } }] }));
  const result = await interpretRequest({ key: 'test-key', model: 'gemma-4-26b-a4b-it' }, 's1 will work on shift a1. s2 will work on c1.', state.volunteers, state.shifts);
  assert.deepEqual(result.changes, assignments);
  assert.equal(repairSchedule(state.volunteers, state.shifts, state.schedule, { assignments: result.changes }).status, 'feasible');
});

test('a model-invented shift is rejected without producing an executable assignment', async t => {
  const state = fixture();
  t.mock.method(globalThis, 'fetch', async () => json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ status: 'ready', message: 'Assign', changes: [assign('s1', 'invented')] }) }] } }] }));
  await assert.rejects(interpretRequest({ key: 'test-key', model: 'gemma-4-26b-a4b-it' }, 'Assign s1.', state.volunteers, state.shifts), /unknown shift/);
});

test('Gemma receives exact 24-hour shift times and availability instead of ambiguous minute counts', async t => {
  const state = fixture();
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const prompt = JSON.parse(options.body).contents[0].parts[0].text;
    assert.match(prompt, /"start":"10:00","end":"12:00"/);
    assert.match(prompt, /"availability":\[\["10:00","14:00"\]\]/);
    return json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ status: 'ready', message: 'Assign s1 to c1.', changes: [assign('s1', 'c1')] }) }] } }] });
  });
  const result = await interpretRequest({ key: 'test-key', model: 'gemma-4-26b-a4b-it' }, 'Assign s1 to c1 12:00-14:00.', state.volunteers, state.shifts);
  assert.deepEqual(result.changes, [assign('s1', 'c1')]);
});

test('an ambiguous-shift clarification never carries executable assignments', async t => {
  const state = fixture(); state.shifts.forEach(s => { s.station = 'Desk'; });
  t.mock.method(globalThis, 'fetch', async () => json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ status: 'clarification', message: 'Which Desk shift time?', changes: assignments }) }] } }] }));
  const result = await interpretRequest({ key: 'test-key', model: 'gemma-4-26b-a4b-it' }, 'Assign s1 to Desk.', state.volunteers, state.shifts);
  assert.equal(result.status, 'clarification');
  assert.deepEqual(result.changes, []);
});

const eventId = '11111111-1111-4111-8111-111111111111';
const secret = 'assignment-verification-secret-'.repeat(3);
const env = { SUPABASE_URL: 'https://assignment-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key', PROPOSAL_SECRET: secret };
function cloudFixture(t) {
  let stored = { id: eventId, version: 1, state: fixture() };
  const saves = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(typeof url === 'string' ? url : url.url).pathname;
    if (path === '/auth/v1/user') return json({ id: 'owner', email: 'owner@example.test', is_anonymous: false });
    if (path.endsWith('/shiftrescue_load_event')) return json(stored);
    if (path.endsWith('/shiftrescue_save_event')) {
      const input = JSON.parse(options.body); saves.push(input);
      if (input.p_expected_version !== stored.version) return json({ code: 'PT409', message: 'Stale version' }, 409);
      stored = { id: eventId, version: stored.version + 1, state: { ...input.p_state, history: [] } };
      return json(stored);
    }
    throw new Error(`Unexpected test endpoint: ${path}`);
  });
  return { saves, read: () => stored };
}

test('cloud assignment preview stays unsaved until explicit apply, then survives a fresh load', async t => {
  const cloud = cloudFixture(t), api = createApi(env);
  const response = await api(request('/api/repair', { eventId, expectedVersion: 1, changes: assignments, source: 'gemma', requestText: 'Assign s1 to a1 and s2 to c1.' }));
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.deepEqual(preview.schedule, { a1: ['s1'], c1: ['s2'] });
  assert.deepEqual(preview.assignments, assignments);
  assert.equal(cloud.saves.length, 0);
  assert.deepEqual(cloud.read().state.schedule, fixture().schedule);
  const proof = proposalTokens(secret).read(preview.proposalId, 'owner', eventId);
  assert.deepEqual(proof.assignments, assignments);
  const applied = await createApi(env)(request(`/api/events/${eventId}/apply`, { proposalId: preview.proposalId }));
  assert.equal(applied.status, 200);
  assert.equal(cloud.saves.length, 1);
  assert.equal(cloud.saves[0].p_expected_version, 1);
  assert.equal(cloud.saves[0].p_activity.source, 'gemma');
  const loaded = await createApi(env)(new Request(`https://shiftrescue.netlify.app/api/events/${eventId}`, { headers: { cookie: 'sr_access=test-access' } }));
  assert.equal(loaded.status, 200);
  assert.deepEqual((await loaded.json()).state.schedule, preview.schedule);
});

test('apply rechecks signed assignment requirements before any cloud write', async t => {
  const cloud = cloudFixture(t);
  const token = proposalTokens(secret).issue({ userId: 'owner', eventId, version: 1, state: fixture(), assignments });
  const response = await createApi(env)(request(`/api/events/${eventId}/apply`, { proposalId: token }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /final validation/);
  assert.equal(cloud.saves.length, 0);
});
