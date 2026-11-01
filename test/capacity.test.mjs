import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityEvent } from '../test-fixtures/capacity.mjs';
import { validateData, checkSchedule, repairSchedule, editSchedule, clock } from '../src/scheduler.mjs';
import { compileSetupDraft } from '../src/setup.mjs';
import { validateEventState } from '../src/cloud.mjs';
import { proposalTokens } from '../src/proposals.mjs';
import { createApi } from '../src/api.mjs';
import { MAX_EVENT_REQUEST_BYTES, MAX_PROPOSAL_CHARACTERS } from '../src/limits.mjs';

const request = (path, data) => new Request(`https://shiftrescue.netlify.app${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: 'sr_access=test-token' }, body: JSON.stringify(data) });
test('full-size events validate all 80 volunteers, 24 shifts and 192 placements', () => {
  const event = capacityEvent();
  validateData(event.volunteers, event.shifts, event.schedule);
  validateEventState(event);
  assert.ok(checkSchedule(event.volunteers, event.shifts, event.schedule).valid);
  for (const mutate of [
    e => e.volunteers.push({ ...e.volunteers[0], id: 'extra-person' }),
    e => e.shifts.push({ ...e.shifts[0], id: 'extra-shift' }),
    e => { e.shifts[0].required = 9; }
  ]) { const e = structuredClone(event); mutate(e); assert.throws(() => validateData(e.volunteers, e.shifts, e.schedule)); }
});
test('AI draft compilation preserves the entire team, shifts and imported placements', () => {
  const event = capacityEvent();
  const draft = {
    event: event.event, date: event.date,
    volunteers: event.volunteers.map(p => ({ ...p, availability: p.availability.map(a => a.map(clock)) })),
    shifts: event.shifts.map(s => ({ ...s, start: clock(s.start), end: clock(s.end) })),
    assignments: event.shifts.flatMap((_, shiftIndex) => Array.from({ length: 8 }, (_, volunteerIndex) => ({ shiftIndex, volunteerIndex })))
  };
  const saved = compileSetupDraft(draft);
  assert.equal(saved.volunteers.length, 80); assert.equal(saved.shifts.length, 24);
  assert.equal(Object.values(saved.schedule).flat().length, 192);
  assert.ok(checkSchedule(saved.volunteers, saved.shifts, saved.schedule).valid);
});
test('maximum-size completion and unchanged schedules avoid combinatorial materialization', () => {
  const event = capacityEvent();
  const empty = Object.fromEntries(event.shifts.map(s => [s.id, []]));
  for (const baseline of [empty, event.schedule]) {
    const started = performance.now();
    const result = repairSchedule(event.volunteers, event.shifts, baseline);
    assert.equal(result.status, 'feasible'); assert.equal(result.optimal, true);
    assert.ok(checkSchedule(event.volunteers, event.shifts, result.schedule).valid);
    assert.ok(performance.now() - started < 1000, 'simple full-size events should finish without consuming the search budget');
    if (baseline === event.schedule) assert.equal(result.changedAssignments, 0);
  }
});
test('large teams still enforce overlaps and hour limits during manual replacements', () => {
  const e = capacityEvent();
  e.shifts[1].start = e.shifts[0].start; e.shifts[1].end = e.shifts[0].end;
  assert.ok(!checkSchedule(e.volunteers, e.shifts, e.schedule).valid);
  const fresh = capacityEvent(); fresh.volunteers[8].maxHours = 0;
  const result = editSchedule(fresh.volunteers, fresh.shifts, fresh.schedule, [{ type: 'unassign', shiftId: 's-0', volunteerId: 'v-0' }, { type: 'assign', shiftId: 's-0', volunteerId: 'v-8' }]);
  assert.equal(result.status, 'conflict'); assert.equal(result.schedule, null);
});
test('a 16-change replacement of all eight people remains atomic', () => {
  const e = capacityEvent(); e.shifts[0].skills = [];
  const changes = [...e.volunteers.slice(0, 8).map(p => ({ type: 'unassign', volunteerId: p.id, shiftId: 's-0' })), ...e.volunteers.slice(8, 16).map(p => ({ type: 'assign', volunteerId: p.id, shiftId: 's-0' }))];
  const result = editSchedule(e.volunteers, e.shifts, e.schedule, changes);
  assert.ok(result.schedule); assert.deepEqual(result.schedule['s-0'], e.volunteers.slice(8, 16).map(p => p.id));
  assert.deepEqual(result.schedule['s-1'], e.schedule['s-1']);
});
test('oversubscribed simultaneous shifts are a proven conflict', () => {
  const e = capacityEvent(); e.shifts.forEach(s => { s.start = 0; s.end = 60; });
  const result = repairSchedule(e.volunteers, e.shifts, Object.fromEntries(e.shifts.map(s => [s.id, []])));
  assert.equal(result.status, 'infeasible'); assert.equal(result.optimal, true); assert.match(result.diagnostics.join(' '), /overlap/);
});
test('the deadline covers staffing-group generation and never reports an unproven conflict', () => {
  const people = capacityEvent().volunteers.map((p, i) => ({ ...p, skills: i === 0 ? ['rare-skill'] : [] }));
  const shifts = [0, 1].map(i => ({ id: `s-${i}`, station: 'Desk', start: 0, end: 60, required: 8, skills: ['rare-skill'] }));
  const started = performance.now();
  const result = repairSchedule(people, shifts, { 's-0': [], 's-1': [] }, { maxMs: 15 });
  assert.equal(result.status, 'search_limit'); assert.equal(result.optimal, false); assert.equal(result.schedule, null);
  assert.ok(performance.now() - started < 1000);
});
test('full-size previews exceeding the old token limit can be applied through the API', async t => {
  const e = capacityEvent({ long: true }), userId = 'owner', eventId = '11111111-1111-4111-8111-111111111111';
  validateEventState(e);
  const secret = 'capacity-signing-secret-'.repeat(3), tokens = proposalTokens(secret);
  const proof = tokens.issue({ userId, eventId, version: 1, mode: 'incremental', assignments: [], state: e, activity: null });
  assert.ok(proof.length > 60000); assert.ok(proof.length < MAX_PROPOSAL_CHARACTERS);
  assert.equal(tokens.read(proof, userId, eventId).state.volunteers.length, 80);
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: userId, email: 'owner@example.test', is_anonymous: false }));
    if (String(url).endsWith('/shiftrescue_load_event')) return new Response(JSON.stringify({ id: eventId, role: 'owner', version: 1, state: e }));
    assert.match(String(url), /rpc\/shiftrescue_save_event$/); writes++;
    const input = JSON.parse(options.body); assert.equal(input.p_state.volunteers.length, 80); assert.equal(input.p_state.shifts.length, 24);
    return new Response(JSON.stringify({ id: eventId, version: 2, state: { ...input.p_state, history: [] } }));
  });
  const api = createApi({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'publishable', PROPOSAL_SECRET: secret });
  const response = await api(request(`/api/events/${eventId}/apply`, { proposalId: proof }));
  assert.equal(response.status, 200); assert.equal(writes, 1);
  assert.equal((await response.json()).state.volunteers.length, 80);
  const oversized = await api(request('/api/repair', { text: 'a'.repeat(MAX_EVENT_REQUEST_BYTES + 1) }));
  assert.equal(oversized.status, 413);
});

test('lazy search matches exhaustive optima on independent small fixtures', () => {
  let seed = 7361;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let sample = 0; sample < 12; sample++) {
    const people = Array.from({ length: 5 }, (_, i) => ({ id: `p-${i}`, name: `P${i}`, skills: random() < 0.5 ? ['trained'] : [], maxHours: 1 + Math.floor(random() * 3), availability: [[0, random() < 0.25 ? 120 : 1440]] }));
    const shifts = Array.from({ length: 3 }, (_, i) => ({ id: `s-${i}`, station: `Desk ${i}`, start: sample % 2 ? i * 60 : 0, end: sample % 2 ? (i + 1) * 60 : 60, required: random() < 0.5 ? 1 : 2, skills: random() < 0.5 ? ['trained'] : [] }));
    const baseline = Object.fromEntries(shifts.map(s => [s.id, [...people].sort(() => random() - 0.5).slice(0, s.required).map(p => p.id)]));
    let optimum = null;
    const options = s => {
      const groups = [];
      for (let mask = 0; mask < 1 << people.length; mask++) {
        const ids = people.filter((_, i) => mask & 1 << i).map(p => p.id);
        if (ids.length === s.required) groups.push(ids);
      }
      return groups;
    };
    for (const a of options(shifts[0])) for (const b of options(shifts[1])) for (const c of options(shifts[2])) {
      const schedule = { 's-0': a, 's-1': b, 's-2': c }, check = checkSchedule(people, shifts, schedule);
      if (!check.valid) continue;
      const cost = shifts.reduce((n, s) => n + baseline[s.id].filter(id => !schedule[s.id].includes(id)).length, 0);
      const balance = Object.values(check.workloads).reduce((n, hours) => n + (hours * 60) ** 2, 0);
      if (!optimum || cost < optimum.cost || cost === optimum.cost && balance < optimum.balance) optimum = { cost, balance };
    }
    const result = repairSchedule(people, shifts, baseline);
    assert.equal(result.optimal, true, `fixture ${sample} did not exhaust its small search`);
    if (!optimum) assert.equal(result.status, 'infeasible');
    else {
      assert.equal(result.status, 'feasible'); assert.equal(result.changedAssignments, optimum.cost);
      assert.equal(Object.values(result.workloads).reduce((n, hours) => n + (hours * 60) ** 2, 0), optimum.balance);
    }
  }
});

test('a maximum-size bulk replacement accepts all 384 requested edits', () => {
  const e = capacityEvent();
  const changes = e.shifts.flatMap(s => [
    ...e.volunteers.slice(0, 8).map(p => ({ type: 'unassign', volunteerId: p.id, shiftId: s.id })),
    ...e.volunteers.slice(8, 16).map(p => ({ type: 'assign', volunteerId: p.id, shiftId: s.id }))
  ]);
  assert.equal(changes.length, 384);
  const result = editSchedule(e.volunteers, e.shifts, e.schedule, changes);
  assert.equal(result.status, 'feasible'); assert.equal(result.complete, true);
  assert.ok(checkSchedule(e.volunteers, e.shifts, result.schedule).valid);
  assert.deepEqual(result.schedule['s-23'], e.volunteers.slice(8, 16).map(p => p.id));
});
