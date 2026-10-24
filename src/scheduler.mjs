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
  if (!Array.isArray(volunteers) || (!allowEmpty && volunteers.length < 1) || volunteers.length > 12 || !Array.isArray(shifts) || (!allowEmpty && shifts.length < 1) || shifts.length > 8) throw new Error('This prototype supports 1–12 volunteers and 1–8 shifts.');
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
    if (!s || typeof s.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(s.id) || shiftIds.has(s.id) || typeof s.station !== 'string' || !s.station.trim() || s.station.length > 80 || !Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 || s.end > 1440 || s.start >= s.end || !Number.isInteger(s.required) || s.required < 1 || s.required > 3 || !Array.isArray(s.skills) || s.skills.length > 8 || s.skills.some(x => typeof x !== 'string' || !/^[a-z-]{1,30}$/.test(x))) throw new Error('Invalid shift definition.');
    shiftIds.add(s.id);
  }
  if (schedule !== null && (typeof schedule !== 'object' || Array.isArray(schedule) || !schedule || Object.keys(schedule).some(id => !shiftIds.has(id)) || shifts.some(s => !Array.isArray(schedule[s.id]) || schedule[s.id].length > 12 || schedule[s.id].some(id => !ids.has(id))))) throw new Error('Invalid schedule assignments.');
}

export function validateChanges(changes, volunteers, shifts = []) {
  if (!Array.isArray(changes) || changes.length > 24) throw new Error('Provide at most 24 changes at once.');
  for (const c of changes) {
    if (!c || !volunteers.some(p => p.id === c.volunteerId)) throw new Error('The request names an unknown volunteer. Please choose someone on this team.');
    if (c.type === 'unavailable') {
      if (parseTime(c.start) >= parseTime(c.end)) throw new Error('The unavailable interval must end after it starts.');
    } else if (c.type === 'max_hours') {
      if (!Number.isFinite(c.hours) || c.hours < 0 || c.hours > 24) throw new Error('Maximum hours must be a number between 0 and 24.');
    } else if (c.type === 'assign') {
      if (!shifts.some(s => s.id === c.shiftId)) throw new Error('The request names an unknown shift. Please choose a shift in this event.');
    } else throw new Error('Supported changes are shift assignments, unavailable time intervals and maximum working hours.');
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
  if (assignments.some(c => c.type !== 'assign')) throw new Error('Schedule assignment requirements must name a volunteer and a shift.');
}

export function checkSchedule(volunteers, shifts, schedule, { assignments = [] } = {}) {
  validateAssignments(assignments, volunteers, shifts);
  const errors = [], workloads = Object.fromEntries(volunteers.map(p => [p.id, 0]));
  const personById = new Map(volunteers.map(p => [p.id, p]));
  for (const s of shifts) {
    const assigned = schedule[s.id] || [];
    if (assigned.length !== s.required || new Set(assigned).size !== assigned.length) errors.push(`${s.station}, ${clock(s.start)}–${clock(s.end)}: needs ${s.required} different volunteers.`);
    for (const id of assigned) {
      const p = personById.get(id);
      if (!p) { errors.push('An assigned volunteer does not exist.'); continue; }
      workloads[id] += (s.end - s.start) / 60;
      if (!available(p, s)) errors.push(`${p.name} is unavailable for ${s.station}, ${clock(s.start)}–${clock(s.end)}.`);
    }
    for (const skill of s.skills) if (!assigned.some(id => personById.get(id)?.skills.includes(skill))) errors.push(`${s.station}, ${clock(s.start)}–${clock(s.end)}: missing ${skill} coverage.`);
  }
  for (const p of volunteers) {
    if (workloads[p.id] > p.maxHours + 1e-8) errors.push(`${p.name} exceeds their ${p.maxHours}-hour limit.`);
    const assigned = shifts.filter(s => (schedule[s.id] || []).includes(p.id));
    for (let i = 0; i < assigned.length; i++) for (let j = i + 1; j < assigned.length; j++) if (overlap(assigned[i], assigned[j])) errors.push(`${p.name} is assigned to overlapping shifts.`);
  }
  for (const c of assignments) {
    const shift = shifts.find(s => s.id === c.shiftId);
    if (!(schedule[c.shiftId] || []).includes(c.volunteerId)) errors.push(`${personById.get(c.volunteerId).name} must be assigned to ${shift.station}, ${clock(shift.start)}–${clock(shift.end)}.`);
  }
  return { valid: !errors.length, errors: [...new Set(errors)], workloads };
}

function combinations(items, count, start = 0, chosen = [], result = []) {
  if (chosen.length === count) { result.push([...chosen]); return result; }
  for (let i = start; i <= items.length - (count - chosen.length); i++) {
    chosen.push(items[i]); combinations(items, count, i + 1, chosen, result); chosen.pop();
  }
  return result;
}

export function repairSchedule(volunteers, shifts, baseline, { assignments = [], maxNodes = 600000, maxMs = 1500 } = {}) {
  validateData(volunteers, shifts, baseline);
  validateAssignments(assignments, volunteers, shifts);
  const begin = performance.now(), personById = new Map(volunteers.map(p => [p.id, p]));
  const diagnostics = [];
  const ordered = shifts.map(s => {
    const requested = [...new Set(assignments.filter(c => c.shiftId === s.id).map(c => c.volunteerId))];
    const eligible = volunteers.filter(p => available(p, s) && p.maxHours * 60 >= s.end - s.start);
    for (const skill of s.skills) if (!eligible.some(p => p.skills.includes(skill))) diagnostics.push(`${s.station}, ${clock(s.start)}–${clock(s.end)}: no available volunteer with ${skill} training and enough hours for this shift.`);
    if (eligible.length < s.required) diagnostics.push(`${s.station}, ${clock(s.start)}–${clock(s.end)}: ${eligible.length} eligible volunteers for ${s.required} places.`);
    const options = combinations(eligible.map(p => p.id), s.required)
      .filter(ids => requested.every(id => ids.includes(id)) && s.skills.every(skill => ids.some(id => personById.get(id).skills.includes(skill))))
      .map(ids => ({ ids, cost: (baseline[s.id] || []).filter(id => !ids.includes(id)).length }))
      .sort((a, b) => a.cost - b.cost);
    if (requested.length && !options.length) diagnostics.push(`${s.station}, ${clock(s.start)}–${clock(s.end)}: assigning ${requested.map(id => personById.get(id).name).join(', ')} cannot satisfy this shift’s staffing, availability, skills and hour limits.`);
    return { ...s, options };
  }).sort((a, b) => a.options.length - b.options.length || a.start - b.start);
  if (ordered.some(s => !s.options.length)) return { status: 'infeasible', optimal: true, schedule: null, diagnostics, nodes: 0, elapsedMs: Math.round(performance.now() - begin) };
  const minutes = Object.fromEntries(volunteers.map(p => [p.id, 0]));
  const assignedShifts = Object.fromEntries(volunteers.map(p => [p.id, []]));
  const current = {};
  const lower = Array(ordered.length + 1).fill(0);
  for (let i = ordered.length - 1; i >= 0; i--) lower[i] = lower[i + 1] + ordered[i].options[0].cost;
  let best = null, bestCost = Infinity, bestBalance = Infinity, nodes = 0, interrupted = false;
  function visit(index, cost) {
    if (interrupted || cost + lower[index] > bestCost) return;
    if (nodes >= maxNodes || performance.now() - begin >= maxMs) { interrupted = true; return; }
    nodes++;
    if (index === ordered.length) {
      const balance = Object.values(minutes).reduce((sum, n) => sum + n * n, 0);
      if (cost < bestCost || (cost === bestCost && balance < bestBalance)) { best = structuredClone(current); bestCost = cost; bestBalance = balance; }
      return;
    }
    const s = ordered[index], duration = s.end - s.start;
    for (const option of s.options) {
      if (cost + option.cost + lower[index + 1] > bestCost) continue;
      if (option.ids.some(id => minutes[id] + duration > personById.get(id).maxHours * 60 + 1e-8 || assignedShifts[id].some(other => overlap(s, other)))) continue;
      current[s.id] = option.ids;
      for (const id of option.ids) { minutes[id] += duration; assignedShifts[id].push(s); }
      visit(index + 1, cost + option.cost);
      for (const id of option.ids) { minutes[id] -= duration; assignedShifts[id].pop(); }
      delete current[s.id];
      if (interrupted) return;
    }
  }
  visit(0, 0);
  if (!best) return { status: interrupted ? 'search_limit' : 'infeasible', optimal: !interrupted, schedule: null, diagnostics: [interrupted ? 'The search limit was reached before a valid schedule was found. This does not prove the request is impossible.' : assignments.length ? 'The requested assignments conflict with availability, overlapping shifts, skill requirements or hour limits. Try changing the requested placements.' : 'Availability, overlapping shifts, skill requirements and hour limits cannot all be satisfied together. Try restoring availability or increasing an hour limit.'], nodes, elapsedMs: Math.round(performance.now() - begin) };
  const validation = checkSchedule(volunteers, shifts, best, { assignments });
  if (!validation.valid) throw new Error('Internal validation rejected the proposed schedule. The original schedule was preserved.');
  const differences = shifts.filter(s => best[s.id].some(id => !(baseline[s.id] || []).includes(id)) || (baseline[s.id] || []).some(id => !best[s.id].includes(id))).map(s => ({ shiftId: s.id, station: s.station, start: s.start, end: s.end, removed: (baseline[s.id] || []).filter(id => !best[s.id].includes(id)), added: best[s.id].filter(id => !(baseline[s.id] || []).includes(id)) }));
  return { status: 'feasible', optimal: !interrupted, schedule: best, changedAssignments: bestCost, differences, workloads: validation.workloads, nodes, elapsedMs: Math.round(performance.now() - begin), diagnostics: [] };
}
