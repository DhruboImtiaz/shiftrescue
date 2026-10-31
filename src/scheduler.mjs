import { MAX_VOLUNTEERS, MAX_SHIFTS, MAX_PEOPLE_PER_SHIFT, MAX_CHANGES } from './limits.mjs';

export const clock = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export const overlap = (a, b) => a.start < b.end && b.start < a.end;
export function available(person, shift) {
  let coveredUntil = shift.start;
  for (const [start, end] of [...person.availability].sort((a, b) => a[0] - b[0])) {
    if (end <= coveredUntil) continue;
    if (start > coveredUntil) return false;
    coveredUntil = end;
    if (coveredUntil >= shift.end) return true;
  }
  return false;
}

export function parseTime(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(value)) throw new Error('Use an exact 24-hour time, such as 14:00.');
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function validateData(volunteers, shifts, schedule = null, { allowEmpty = false } = {}) {
  if (!Array.isArray(volunteers) || (!allowEmpty && volunteers.length < 1) || volunteers.length > MAX_VOLUNTEERS || !Array.isArray(shifts) || (!allowEmpty && shifts.length < 1) || shifts.length > MAX_SHIFTS) throw new Error(`Events support up to ${MAX_VOLUNTEERS} volunteers and ${MAX_SHIFTS} shifts.`);
  const ids = new Set();
  for (const p of volunteers) {
    if (!p || typeof p.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(p.id) || ids.has(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60) throw new Error('Every volunteer needs a unique ID and a name.');
    ids.add(p.id);
    if (!Array.isArray(p.skills) || p.skills.length > 8 || p.skills.some(s => typeof s !== 'string' || !/^[a-z-]{1,30}$/.test(s))) throw new Error('Invalid volunteer skills.');
    if (!Number.isFinite(p.maxHours) || p.maxHours < 0 || p.maxHours > 24) throw new Error('Maximum hours must be between 0 and 24.');
    if (!Array.isArray(p.availability) || p.availability.length > 20 || p.availability.some(a => !Array.isArray(a) || a.length !== 2 || !a.every(Number.isInteger) || a[0] < 0 || a[1] > 1440 || a[0] >= a[1])) throw new Error('Invalid availability interval.');
  }
  const shiftIds = new Set();
  for (const s of shifts) {
    if (!s || typeof s.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(s.id) || shiftIds.has(s.id) || typeof s.station !== 'string' || !s.station.trim() || s.station.length > 80 || !Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 || s.end > 1440 || s.start >= s.end || !Number.isInteger(s.required) || s.required < 1 || s.required > MAX_PEOPLE_PER_SHIFT || !Array.isArray(s.skills) || s.skills.length > 8 || s.skills.some(x => typeof x !== 'string' || !/^[a-z-]{1,30}$/.test(x))) throw new Error('Invalid shift definition.');
    shiftIds.add(s.id);
  }
  if (schedule !== null && (typeof schedule !== 'object' || Array.isArray(schedule) || !schedule || Object.keys(schedule).some(id => !shiftIds.has(id)) || shifts.some(s => !Array.isArray(schedule[s.id]) || schedule[s.id].length > MAX_PEOPLE_PER_SHIFT || schedule[s.id].some(id => !ids.has(id))))) throw new Error('Invalid schedule assignments.');
}

export function validateChanges(changes, volunteers, shifts = []) {
  if (!Array.isArray(changes) || changes.length > MAX_CHANGES) throw new Error(`Provide at most ${MAX_CHANGES} changes at once.`);
  for (const c of changes) {
    if (!c || !volunteers.some(p => p.id === c.volunteerId)) throw new Error('The request names an unknown volunteer. Please choose someone on this team.');
    if (c.type === 'unavailable') {
      if (parseTime(c.start) >= parseTime(c.end)) throw new Error('The unavailable interval must end after it starts.');
    } else if (c.type === 'max_hours') {
      if (!Number.isFinite(c.hours) || c.hours < 0 || c.hours > 24) throw new Error('Maximum hours must be a number between 0 and 24.');
    } else if (c.type === 'assign' || c.type === 'unassign') {
      if (!shifts.some(s => s.id === c.shiftId)) throw new Error('The request names an unknown shift. Please choose a shift in this event.');
      if (changes.some(other => other?.volunteerId === c.volunteerId && other.shiftId === c.shiftId && other.type === (c.type === 'assign' ? 'unassign' : 'assign'))) throw new Error('The same volunteer cannot be both added to and removed from the same shift in one request.');
    } else throw new Error('Supported changes are adding or removing shift assignments, unavailable time intervals and maximum working hours.');
  }
  return changes;
}

export function applyChanges(volunteers, changes, shifts = []) {
  validateChanges(changes, volunteers, shifts);
  const next = structuredClone(volunteers);
  for (const c of changes) {
    const person = next.find(p => p.id === c.volunteerId);
    if (c.type === 'max_hours') person.maxHours = c.hours;
    else if (c.type === 'unavailable') {
      const start = parseTime(c.start), end = parseTime(c.end);
      person.availability = person.availability.flatMap(([a, b]) => {
        if (end <= a || start >= b) return [[a, b]];
        return [[a, Math.min(start, b)], [Math.max(end, a), b]].filter(([x, y]) => x < y);
      });
    }
  }
  return next;
}

function validateAssignments(assignments, volunteers, shifts) {
  validateChanges(assignments, volunteers, shifts);
  if (assignments.some(c => !['assign', 'unassign'].includes(c.type))) throw new Error('Schedule assignment requirements must name a volunteer and a shift.');
}

export function checkSchedule(volunteers, shifts, schedule, { assignments = [], allowPartial = false } = {}) {
  validateAssignments(assignments, volunteers, shifts);
  const errors = [], warnings = [], workloads = Object.fromEntries(volunteers.map(p => [p.id, 0]));
  const personById = new Map(volunteers.map(p => [p.id, p]));
  for (const s of shifts) {
    const assigned = schedule[s.id] || [];
    if (assigned.length > s.required || new Set(assigned).size !== assigned.length) errors.push(`${s.station}, ${clock(s.start)}–${clock(s.end)}: allows at most ${s.required} different volunteers.`);
    if (assigned.length < s.required) warnings.push(`${s.station}, ${clock(s.start)}–${clock(s.end)}: ${s.required - assigned.length} of ${s.required} places still open.`);
    for (const id of assigned) {
      const p = personById.get(id);
      if (!p) { errors.push('An assigned volunteer does not exist.'); continue; }
      workloads[id] += (s.end - s.start) / 60;
      if (!available(p, s)) errors.push(`${p.name} is unavailable for ${s.station}, ${clock(s.start)}–${clock(s.end)}.`);
    }
    for (const skill of s.skills) if (!assigned.some(id => personById.get(id)?.skills.includes(skill))) warnings.push(`${s.station}, ${clock(s.start)}–${clock(s.end)}: missing ${skill} coverage.`);
  }
  for (const p of volunteers) {
    if (workloads[p.id] > p.maxHours + 1e-8) errors.push(`${p.name} exceeds their ${p.maxHours}-hour limit.`);
    const assigned = shifts.filter(s => (schedule[s.id] || []).includes(p.id));
    for (let i = 0; i < assigned.length; i++) for (let j = i + 1; j < assigned.length; j++) if (overlap(assigned[i], assigned[j])) errors.push(`${p.name} is assigned to overlapping shifts.`);
  }
  for (const c of assignments) {
    const shift = shifts.find(s => s.id === c.shiftId);
    const included = (schedule[c.shiftId] || []).includes(c.volunteerId);
    if ((c.type === 'assign' && !included) || (c.type === 'unassign' && included)) errors.push(`${personById.get(c.volunteerId).name} must be ${c.type === 'assign' ? 'assigned to' : 'removed from'} ${shift.station}, ${clock(shift.start)}–${clock(shift.end)}.`);
  }
  return { valid: !errors.length && (allowPartial || !warnings.length), complete: !errors.length && !warnings.length, errors: [...new Set(allowPartial ? errors : [...errors, ...warnings])], warnings: [...new Set(warnings)], workloads };
}

// Keep every placement that still fits after team/shift edits. Coverage gaps
// are allowed; invalid individual assignments become open places.
export function retainValidAssignments(volunteers, shifts, schedule) {
  const next = Object.fromEntries(shifts.map(s => [s.id, []]));
  const ids = new Set(volunteers.map(p => p.id));
  for (const shift of shifts) for (const id of new Set(schedule[shift.id] || [])) {
    if (!ids.has(id)) continue;
    next[shift.id].push(id);
    if (!checkSchedule(volunteers, shifts, next, { allowPartial: true }).valid) next[shift.id].pop();
  }
  return next;
}

function scheduleDifferences(shifts, baseline, schedule) {
  return shifts.filter(s => schedule[s.id].some(id => !(baseline[s.id] || []).includes(id)) || (baseline[s.id] || []).some(id => !schedule[s.id].includes(id))).map(s => ({ shiftId: s.id, station: s.station, start: s.start, end: s.end, removed: (baseline[s.id] || []).filter(id => !schedule[s.id].includes(id)), added: schedule[s.id].filter(id => !(baseline[s.id] || []).includes(id)) }));
}

// Apply only the requested edits. Never fill unrelated shifts or reshuffle
// other people just because the rest of the event is incomplete.
export function editSchedule(people, shifts, baseline, changes) {
  validateData(people, shifts, baseline);
  const volunteers = applyChanges(people, changes, shifts);
  const assignments = changes.filter(c => ['assign', 'unassign'].includes(c.type)).map(({ type, volunteerId, shiftId }) => ({ type, volunteerId, shiftId }));
  let schedule = structuredClone(baseline);
  // Removals happen first so moves and replacements are atomic, regardless
  // of the order of operations returned by the model.
  for (const c of assignments.filter(c => c.type === 'unassign')) schedule[c.shiftId] = schedule[c.shiftId].filter(id => id !== c.volunteerId);
  if (changes.some(c => c.type === 'unavailable' || c.type === 'max_hours')) schedule = retainValidAssignments(volunteers, shifts, schedule);
  for (const c of assignments.filter(c => c.type === 'assign')) if (!schedule[c.shiftId].includes(c.volunteerId)) schedule[c.shiftId].push(c.volunteerId);
  const validation = checkSchedule(volunteers, shifts, schedule, { assignments, allowPartial: true });
  if (!validation.valid) return { mode: 'incremental', status: 'conflict', schedule: null, diagnostics: validation.errors, volunteers, assignments };
  const differences = scheduleDifferences(shifts, baseline, schedule);
  return { mode: 'incremental', status: validation.complete ? 'feasible' : 'partial', complete: validation.complete, schedule, volunteers, assignments, changes: structuredClone(changes), differences, warnings: validation.warnings, openPlaces: shifts.reduce((n, s) => n + s.required - schedule[s.id].length, 0), changedAssignments: differences.reduce((n, d) => n + Math.max(d.added.length, d.removed.length), 0), workloads: validation.workloads };
}

// Search staffing groups lazily instead of materializing n-choose-k groups.
// Both group generation and the event search share the same wall-clock budget.
export function repairSchedule(volunteers, shifts, baseline, { assignments = [], maxNodes = 600000, maxMs = 1500 } = {}) {
  validateData(volunteers, shifts, baseline);
  validateAssignments(assignments, volunteers, shifts);
  const begin = performance.now(), personById = new Map(volunteers.map(p => [p.id, p]));
  let nodes = 0, interrupted = false, proven = false, best = null, bestCost = Infinity, bestBalance = Infinity;
  const diagnostics = [];
  const timedOut = () => {
    if (performance.now() - begin >= maxMs) interrupted = true;
    return interrupted;
  };
  const result = () => {
    if (!best) return { status: interrupted ? 'search_limit' : 'infeasible', optimal: !interrupted, schedule: null, diagnostics: diagnostics.length ? diagnostics : [interrupted ? 'The search limit was reached before a valid schedule was found. This does not prove the request is impossible. Keep your current plan, assign places manually, or adjust the constraints and retry.' : 'The requested assignments conflict with availability, overlapping shifts, skill requirements or hour limits. Adjust the placements or constraints.'], nodes, elapsedMs: Math.round(performance.now() - begin) };
    const validation = checkSchedule(volunteers, shifts, best, { assignments });
    if (!validation.valid) throw new Error('Internal validation rejected the proposed schedule. The original schedule was preserved.');
    return { status: 'feasible', optimal: proven || !interrupted, schedule: best, changedAssignments: bestCost, differences: scheduleDifferences(shifts, baseline, best), workloads: validation.workloads, nodes, elapsedMs: Math.round(performance.now() - begin), diagnostics: [] };
  };
  if (maxNodes <= 0 || maxMs <= 0) { interrupted = true; return result(); }
  const ordered = [];
  for (const s of shifts) {
    if (timedOut()) return result();
    const requested = [...new Set(assignments.filter(c => c.type === 'assign' && c.shiftId === s.id).map(c => c.volunteerId))];
    const excluded = new Set(assignments.filter(c => c.type === 'unassign' && c.shiftId === s.id).map(c => c.volunteerId));
    const eligible = volunteers.filter(p => !excluded.has(p.id) && available(p, s) && p.maxHours * 60 >= s.end - s.start).map(p => p.id);
    for (const skill of s.skills) if (!eligible.some(id => personById.get(id).skills.includes(skill))) diagnostics.push(`${s.station}, ${clock(s.start)}–${clock(s.end)}: no available volunteer with ${skill} training and enough hours for this shift.`);
    if (eligible.length < s.required) diagnostics.push(`${s.station}, ${clock(s.start)}–${clock(s.end)}: ${eligible.length} eligible volunteers for ${s.required} places.`);
    if (requested.length > s.required || requested.some(id => !eligible.includes(id))) diagnostics.push(`${s.station}, ${clock(s.start)}–${clock(s.end)}: assigning ${requested.map(id => personById.get(id).name).join(', ')} cannot satisfy this shift’s staffing, availability and hour limits.`);
    const skills = [...new Set(s.skills)], fullMask = (1 << skills.length) - 1;
    const masks = new Map(eligible.map(id => [id, skills.reduce((mask, skill, index) => mask | (personById.get(id).skills.includes(skill) ? 1 << index : 0), 0)]));
    const old = new Set(baseline[s.id] || []), fixedOld = requested.filter(id => old.has(id)).length;
    const optionalOld = eligible.filter(id => old.has(id) && !requested.includes(id)).length;
    const minCost = Math.max(0, old.size - fixedOld - Math.min(Math.max(0, s.required - requested.length), optionalOld));
    // Logarithms provide a bounded estimate for choosing the tightest shift.
    let weight = 0;
    const n = eligible.length - requested.length, k = Math.min(s.required - requested.length, n - s.required + requested.length);
    for (let i = 1; i <= k; i++) weight += Math.log(n - i + 1) - Math.log(i);
    ordered.push({ ...s, eligible, requested, masks, fullMask, old, minCost, weight });
  }
  if (diagnostics.length) return result();
  // These are necessary conditions, so failing them proves a conflict.
  for (const time of new Set(shifts.map(s => s.start))) {
    const active = ordered.filter(s => s.start <= time && time < s.end);
    const needed = active.reduce((sum, s) => sum + s.required, 0);
    const pool = new Set(active.flatMap(s => s.eligible));
    if (needed > pool.size) diagnostics.push(`${clock(time)}: ${needed} places overlap, but only ${pool.size} eligible volunteers can cover those shifts.`);
  }
  const requiredMinutes = shifts.reduce((sum, s) => sum + (s.end - s.start) * s.required, 0);
  if (requiredMinutes > volunteers.reduce((sum, p) => sum + p.maxHours * 60, 0) + 1e-8) diagnostics.push('The shifts require more volunteer hours than the team’s total hour limits allow.');
  if (diagnostics.length) return result();
  ordered.sort((a, b) => a.weight - b.weight || a.start - b.start);
  const lower = Array(ordered.length + 1).fill(0);
  for (let i = ordered.length - 1; i >= 0; i--) lower[i] = lower[i + 1] + ordered[i].minCost;
  const minutes = Object.fromEntries(volunteers.map(p => [p.id, 0]));
  const assignedShifts = Object.fromEntries(volunteers.map(p => [p.id, []]));
  const current = {};
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const quantum = shifts.reduce((unit, s) => gcd(unit, s.end - s.start), 0) || 1;
  const activeCount = new Set(ordered.flatMap(s => s.eligible)).size || 1;
  const units = requiredMinutes / quantum, q = Math.floor(units / activeCount), remainder = units % activeCount;
  const balanceLower = ((activeCount - remainder) * q * q + remainder * (q + 1) ** 2) * quantum ** 2;
  const canUse = (id, s) => minutes[id] + s.end - s.start <= personById.get(id).maxHours * 60 + 1e-8 && !assignedShifts[id].some(other => overlap(s, other));
  const bits = value => { let n = 0; for (; value; value &= value - 1) n++; return n; };
  function* groups(s, cost, futureLower) {
    if (s.requested.some(id => !canUse(id, s))) return;
    const fixed = new Set(s.requested);
    const pool = s.eligible.filter(id => !fixed.has(id) && canUse(id, s)).sort((a, b) => Number(s.old.has(b)) - Number(s.old.has(a)) || minutes[a] - minutes[b] || a.localeCompare(b));
    const remaining = s.required - fixed.size;
    if (pool.length < remaining) return;
    const initialMask = s.requested.reduce((mask, id) => mask | s.masks.get(id), 0);
    // Try a low-change, skill-covering, balanced group before branching.
    const greedy = [...s.requested]; let mask = initialMask;
    while (mask !== s.fullMask && greedy.length < s.required) {
      const next = pool.filter(id => !greedy.includes(id) && (s.masks.get(id) & ~mask)).sort((a, b) => Number(s.old.has(b)) - Number(s.old.has(a)) || bits(s.masks.get(b) & ~mask) - bits(s.masks.get(a) & ~mask) || minutes[a] - minutes[b] || a.localeCompare(b))[0];
      if (!next) break;
      greedy.push(next); mask |= s.masks.get(next);
    }
    const fillers = [...pool].sort((a, b) => Number(s.old.has(b)) - Number(s.old.has(a)) || Number(s.masks.get(a) !== 0) - Number(s.masks.get(b) !== 0) || minutes[a] - minutes[b] || a.localeCompare(b));
    for (const id of fillers) if (greedy.length < s.required && !greedy.includes(id)) greedy.push(id);
    let greedyKey = null;
    if (greedy.length === s.required && mask === s.fullMask) { greedyKey = [...greedy].sort().join('|'); yield greedy; }
    const suffix = Array(pool.length + 1).fill(0), suffixOld = Array(pool.length + 1).fill(0);
    for (let i = pool.length - 1; i >= 0; i--) { suffix[i] = suffix[i + 1] | s.masks.get(pool[i]); suffixOld[i] = suffixOld[i + 1] + Number(s.old.has(pool[i])); }
    const chosen = [...s.requested];
    function* choose(start, covered) {
      if (proven || timedOut() || (covered | suffix[start]) !== s.fullMask) return;
      const kept = chosen.filter(id => s.old.has(id)).length;
      const leastLoss = Math.max(0, s.old.size - kept - Math.min(s.required - chosen.length, suffixOld[start]));
      if (cost + leastLoss + futureLower > bestCost) return;
      if (chosen.length === s.required) {
        if (covered === s.fullMask && [...chosen].sort().join('|') !== greedyKey) yield [...chosen];
        return;
      }
      for (let i = start; i <= pool.length - (s.required - chosen.length); i++) {
        if (proven || timedOut()) return;
        chosen.push(pool[i]); yield* choose(i + 1, covered | s.masks.get(pool[i])); chosen.pop();
      }
    }
    yield* choose(0, initialMask);
  }
  function visit(index, cost) {
    if (proven || interrupted || cost + lower[index] > bestCost) return;
    if (nodes >= maxNodes || timedOut()) { interrupted = true; return; }
    nodes++;
    if (index === ordered.length) {
      const balance = Object.values(minutes).reduce((sum, n) => sum + n * n, 0);
      if (cost < bestCost || (cost === bestCost && balance < bestBalance)) { best = structuredClone(current); bestCost = cost; bestBalance = balance; }
      // Matching both global lower bounds proves the objective is optimal.
      if (bestCost === lower[0] && bestBalance === balanceLower) proven = true;
      return;
    }
    const s = ordered[index], duration = s.end - s.start;
    for (const ids of groups(s, cost, lower[index + 1])) {
      const optionCost = [...s.old].filter(id => !ids.includes(id)).length;
      if (cost + optionCost + lower[index + 1] > bestCost) continue;
      current[s.id] = ids;
      for (const id of ids) { minutes[id] += duration; assignedShifts[id].push(s); }
      visit(index + 1, cost + optionCost);
      for (const id of ids) { minutes[id] -= duration; assignedShifts[id].pop(); }
      delete current[s.id];
      if (proven || interrupted) return;
    }
  }
  visit(0, 0);
  return result();
}
