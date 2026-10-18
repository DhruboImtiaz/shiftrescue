import test from 'node:test';
import assert from 'node:assert/strict';
import { demo, scenarios } from '../src/demo.mjs';
import { applyChanges, checkSchedule, repairSchedule, validateChanges, validateData, parseTime } from '../src/scheduler.mjs';

test('the demo baseline satisfies every scheduling rule', () => {
  validateData(demo.volunteers, demo.shifts, demo.schedule);
  assert.equal(checkSchedule(demo.volunteers, demo.shifts, demo.schedule).valid, true);
});
test('an unchanged schedule needs zero changes and is proved optimal', () => {
  const result = repairSchedule(demo.volunteers, demo.shifts, demo.schedule);
  assert.equal(result.changedAssignments, 0); assert.equal(result.optimal, true);
});
test('a sick call is repaired with exactly one replacement', () => {
  const volunteers = applyChanges(demo.volunteers, scenarios.sick.changes);
  const result = repairSchedule(volunteers, demo.shifts, demo.schedule);
  assert.equal(result.status, 'feasible'); assert.equal(result.changedAssignments, 1); assert.equal(result.optimal, true);
  assert.equal(checkSchedule(volunteers, demo.shifts, result.schedule).valid, true);
  assert.ok(!result.schedule['help-14'].includes('nadia'));
});
test('repair follows the ripple effect without violating Mehedi’s hours', () => {
  const volunteers = applyChanges(demo.volunteers, scenarios.chain.changes);
  const result = repairSchedule(volunteers, demo.shifts, demo.schedule);
  assert.equal(result.status, 'feasible'); assert.equal(result.changedAssignments, 2); assert.equal(result.optimal, true);
  assert.equal(result.workloads.mehedi, 2); assert.ok(result.schedule['help-14'].includes('mehedi'));
  assert.equal(checkSchedule(volunteers, demo.shifts, result.schedule).valid, true);
});
test('no available qualified person is a proven conflict with specific evidence', () => {
  const volunteers = applyChanges(demo.volunteers, scenarios.impossible.changes);
  const result = repairSchedule(volunteers, demo.shifts, demo.schedule);
  assert.equal(result.status, 'infeasible'); assert.match(result.diagnostics.join(' '), /first-aid/);
});
test('double booking is rejected', () => {
  const schedule = structuredClone(demo.schedule); schedule['help-10'] = ['nadia', 'arif'];
  assert.match(checkSchedule(demo.volunteers, demo.shifts, schedule).errors.join(' '), /overlapping/);
});
test('hour limits are enforced even when each individual shift is eligible', () => {
  const people = [{ id: 'a', name: 'A', availability: [[0, 1440]], maxHours: 1, skills: ['welcome'] }];
  const shifts = [{ id: 'a', station: 'Desk', start: 600, end: 660, required: 1, skills: [] }, { id: 'b', station: 'Desk', start: 660, end: 720, required: 1, skills: [] }];
  assert.equal(repairSchedule(people, shifts, { a: ['a'], b: ['a'] }).status, 'infeasible');
});
test('a search limit never claims infeasibility', () => {
  const result = repairSchedule(demo.volunteers, demo.shifts, demo.schedule, { maxNodes: 0 });
  assert.equal(result.status, 'search_limit'); assert.equal(result.optimal, false);
});
test('a partial search with a solution does not claim optimality', () => {
  const people = applyChanges(demo.volunteers, scenarios.sick.changes);
  const result = repairSchedule(people, demo.shifts, demo.schedule, { maxNodes: 7 });
  assert.equal(result.status, 'feasible'); assert.equal(result.optimal, false);
  assert.equal(checkSchedule(people, demo.shifts, result.schedule).valid, true);
});
test('equally small repairs prefer a balanced distribution of hours', () => {
  const people = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id, skills: [], maxHours: 2, availability: ['a', 'b'].includes(id) ? [] : [[600, 720]] }));
  const shifts = [{ id: 'x', station: 'Desk', start: 600, end: 660, required: 1, skills: [] }, { id: 'y', station: 'Desk', start: 660, end: 720, required: 1, skills: [] }];
  const result = repairSchedule(people, shifts, { x: ['a'], y: ['b'] });
  assert.equal(result.changedAssignments, 2); assert.equal(result.optimal, true);
  assert.equal(result.workloads.c, 1); assert.equal(result.workloads.d, 1);
});
test('unavailability splits intervals and never mutates the original team', () => {
  const before = JSON.stringify(demo.volunteers);
  const next = applyChanges(demo.volunteers, [{ type: 'unavailable', volunteerId: 'nadia', start: '11:00', end: '13:00' }]);
  assert.deepEqual(next[0].availability, [[600, 660], [780, 960]]);
  assert.equal(JSON.stringify(demo.volunteers), before);
});
test('a person available for only part of a shift cannot be assigned', () => {
  const people = applyChanges(demo.volunteers, [{ type: 'unavailable', volunteerId: 'nadia', start: '15:00', end: '16:00' }]);
  const result = repairSchedule(people, demo.shifts, demo.schedule);
  assert.ok(!result.schedule['help-14'].includes('nadia'));
});
test('invalid names, operations, times and hour values are rejected', () => {
  assert.throws(() => validateChanges([{ type: 'unavailable', volunteerId: 'ghost', start: '14:00', end: '16:00' }], demo.volunteers));
  assert.throws(() => validateChanges([{ type: 'delete_rules', volunteerId: 'nadia' }], demo.volunteers));
  assert.throws(() => parseTime('25:00')); assert.throws(() => parseTime('2 pm'));
  assert.throws(() => validateChanges([{ type: 'max_hours', volunteerId: 'nadia', hours: -2 }], demo.volunteers));
  assert.throws(() => validateChanges([{ type: 'unavailable', volunteerId: 'nadia', start: '16:00', end: '14:00' }], demo.volunteers));
});
test('adjacent shifts do not count as overlapping', () => {
  const p = [{ id: 'a', name: 'A', availability: [[600, 720]], maxHours: 2, skills: [] }];
  const s = [{ id: 'x', station: 'Desk', start: 600, end: 660, required: 1, skills: [] }, { id: 'y', station: 'Desk', start: 660, end: 720, required: 1, skills: [] }];
  assert.equal(checkSchedule(p, s, { x: ['a'], y: ['a'] }).valid, true);
});

test('adjacent availability windows cover a whole shift but a real gap does not', () => {
  const p = { ...demo.volunteers[0], maxHours: 4, availability: [[720, 840], [600, 720]] };
  const shifts = [{ ...demo.shifts[0], start: 600, end: 840, required: 1 }];
  assert.ok(checkSchedule([p], shifts, { [shifts[0].id]: [p.id] }).valid);
  assert.ok(!checkSchedule([{ ...p, availability: [[600, 719], [720, 840]] }], shifts, { [shifts[0].id]: [p.id] }).valid);
});
