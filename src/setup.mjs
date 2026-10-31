import { MAX_VOLUNTEERS, MAX_SHIFTS, MAX_PEOPLE_PER_SHIFT, MAX_ASSIGNMENTS } from './limits.mjs';
import { parseTime, validateData, checkSchedule } from './scheduler.mjs';

// Shared by the model boundary, review form and save endpoint. Unknown is null;
// [] means the coordinator explicitly recorded no skills / no availability.
export function reviewSetupDraft(input) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const invalid = () => { throw new Error('The event draft contains invalid structured data. Edit your description and try again.'); };
  if (!object(input) || !Array.isArray(input.volunteers) || input.volunteers.length > MAX_VOLUNTEERS || !Array.isArray(input.shifts) || input.shifts.length > MAX_SHIFTS) invalid();
  const text = (value, max) => {
    if (value === null) return null;
    if (typeof value !== 'string' || value.length > max) invalid();
    return value.trim() || null;
  };
  const number = (value, max, integer = false) => {
    if (value === null) return null;
    if (!Number.isFinite(value) || value < 0 || value > max || (integer && (!Number.isInteger(value) || value < 1))) invalid();
    return value;
  };
  const skills = value => {
    if (value === null) return null;
    if (!Array.isArray(value) || value.length > 8 || value.some(s => typeof s !== 'string' || !/^[a-z-]{1,30}$/.test(s))) invalid();
    return [...new Set(value)];
  };
  const time = value => {
    if (value === null) return null;
    parseTime(value); return value;
  };
  const draft = {
    event: text(input.event, 100), date: text(input.date, 10),
    volunteers: input.volunteers.map(p => {
      if (!object(p)) invalid();
      if (p.availability !== null && (!Array.isArray(p.availability) || p.availability.length > 20 || p.availability.some(a => !Array.isArray(a) || a.length !== 2 || a.some(t => t === null)))) invalid();
      return { name: text(p.name, 60), skills: skills(p.skills), maxHours: number(p.maxHours, 24), availability: p.availability === null ? null : p.availability.map(a => a.map(time)) };
    }),
    shifts: input.shifts.map(s => {
      if (!object(s)) invalid();
      return { station: text(s.station, 80), start: time(s.start), end: time(s.end), required: number(s.required, MAX_PEOPLE_PER_SHIFT, true), skills: skills(s.skills) };
    })
  };
  const assignments = input.assignments ?? [];
  if (Array.isArray(assignments) && assignments.length > MAX_ASSIGNMENTS) throw new Error(`An event supports at most ${MAX_ASSIGNMENTS} placements across ${MAX_SHIFTS} shifts.`);
  if (!Array.isArray(assignments) || assignments.some(a => !object(a) || !Number.isInteger(a.volunteerIndex) || a.volunteerIndex < 0 || a.volunteerIndex >= draft.volunteers.length || !Number.isInteger(a.shiftIndex) || a.shiftIndex < 0 || a.shiftIndex >= draft.shifts.length)) invalid();
  draft.assignments = assignments.map(({ volunteerIndex, shiftIndex }) => ({ volunteerIndex, shiftIndex }));
  const issues = [];
  if (new Set(assignments.map(a => `${a.volunteerIndex}:${a.shiftIndex}`)).size !== assignments.length) issues.push('Remove duplicate shift assignments.');
  if (!draft.event) issues.push('Add an event name.');
  if (!draft.date) issues.push('Choose an event date.');
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(Date.parse(draft.date)) || new Date(draft.date).toISOString().slice(0, 10) !== draft.date) issues.push('Choose a valid event date.');
  if (!draft.volunteers.length) issues.push('Add at least one named volunteer.');
  if (!draft.shifts.length) issues.push('Add at least one shift.');
  const names = new Set();
  draft.volunteers.forEach((p, i) => {
    const label = p.name || `Volunteer ${i + 1}`;
    if (!p.name) issues.push(`Add a name for volunteer ${i + 1}.`);
    else if (names.has(p.name.toLowerCase())) issues.push(`Use distinct names for ${p.name} so later requests can identify the right person.`);
    names.add(p.name?.toLowerCase());
    if (p.skills === null) issues.push(`${label}: confirm their skills, or enter “none”.`);
    if (p.availability === null) issues.push(`${label}: add availability, or enter “none” if unavailable all day.`);
    else if (p.availability.some(([a, b]) => parseTime(a) >= parseTime(b))) issues.push(`${label}: availability must end after it starts.`);
    if (p.maxHours === null) issues.push(`${label}: set a maximum number of working hours.`);
  });
  draft.shifts.forEach((s, i) => {
    const label = s.station || `Shift ${i + 1}`;
    if (!s.station) issues.push(`Add a station or task for shift ${i + 1}.`);
    if (s.start === null || s.end === null) issues.push(`${label}: provide exact start and end times.`);
    else if (parseTime(s.start) >= parseTime(s.end)) issues.push(`${label}: the shift must finish after it starts on the same day.`);
    if (s.required === null) issues.push(`${label}: choose 1–${MAX_PEOPLE_PER_SHIFT} people required.`);
    if (s.skills === null) issues.push(`${label}: confirm required skills, or enter “none”.`);
  });
  return { draft, issues };
}

export function compileSetupDraft(input) {
  const { draft, issues } = reviewSetupDraft(input);
  if (issues.length) throw new Error(issues.join(' '));
  const colors = ['#7864bb', '#bb7b45', '#4c8c7b', '#4c7da6'];
  const volunteers = draft.volunteers.map((p, i) => ({ ...p, id: `v-${i + 1}`, color: colors[i % colors.length], availability: p.availability.map(a => a.map(parseTime)) }));
  const shifts = draft.shifts.map((s, i) => ({ ...s, id: `s-${i + 1}`, start: parseTime(s.start), end: parseTime(s.end) }));
  validateData(volunteers, shifts);
  const schedule = Object.fromEntries(shifts.map(s => [s.id, []]));
  for (const a of draft.assignments) schedule[shifts[a.shiftIndex].id].push(volunteers[a.volunteerIndex].id);
  const check = checkSchedule(volunteers, shifts, schedule, { allowPartial: true });
  if (!check.valid) throw new Error(check.errors.join(' '));
  return { event: draft.event, date: draft.date, timezone: 'Asia/Dhaka', volunteers, shifts, schedule, history: [] };
}
