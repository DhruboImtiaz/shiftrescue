import { checkSchedule, clock, parseTime, retainValidAssignments, validateData } from '/scheduler.mjs';
import { initEventSetup } from '/event-setup.js';
import { initVoiceInputs } from '/voice.js';
import { recoverSavedEvent } from '/workspace.js';
import { initProfile } from '/profile.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.8 7M3 4v7h7M12 7v5l3 2"/>',
  settings: '<path d="m10 3-.5 2-2 .9-2-.6-2 3.4 1.5 1.5v2.3L3.5 14l2 3.4 2-.6 2 1 .5 2.2h4l.5-2.2 2-1 2 .6 2-3.4-1.5-1.5v-2.3l1.5-1.5-2-3.4-2 .6-2-.9L14 3z"/><circle cx="12" cy="12" r="3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
  sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4M18 4h4"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  shuffle: '<path d="m18 14 4 4-4 4M18 2l4 4-4 4M2 18h3c5 0 7-12 12-12h5M2 6h3c2 0 3 1 4 3M15 15c1 2 2 3 4 3h3"/>',
  alert: '<path d="m10.3 4-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0M12 9v4M12 17h.01"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2.5 8M3 3v7h7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M4 12h16M14 6l6 6-6 6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.check}</svg>`;
$$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });

let state, connection = { configured: false, verified: false }, interpretation = null, preview = null, busy = false, editingId = null;
let editingShiftId = null, editingAssignmentsShiftId = null, editingEvent = false, gemmaIssue = null;
let eventSetup, voiceInputs, profileUI;
let deleteTarget = null;
try { gemmaIssue = JSON.parse(sessionStorage.getItem('shiftrescue-gemma-issue')); } catch {}
let auth = { configured: false, user: null }, savedEvents = [], currentEvent = null, authMode = 'signin';
const storageKey = 'shiftrescue-draft-v2';
const selectedEventKey = userId => `shiftrescue-selected-v2-${userId}`;
function emptyWorkspace() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const date = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return { event: 'Untitled event', date: `${date.year}-${date.month}-${date.day}`, timezone: 'Asia/Dhaka', volunteers: [], shifts: [], schedule: {}, history: [] };
}
function clearWorkspace() {
  currentEvent = null; state = emptyWorkspace(); interpretation = null; preview = null;
  $('#request-input').value = '';
  try { sessionStorage.removeItem('shiftrescue-request-draft'); } catch {}
}

async function api(path, data, { signal } = {}) {
  const response = await fetch(path, data === undefined ? { signal } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal });
  const result = await response.json().catch(() => ({ error: response.status === 429 ? 'The site is receiving too many requests. Please wait before retrying.' : 'The server could not respond. Please retry.' }));
  if (!response.ok) {
    if (response.status === 401 && auth.user && !path.startsWith('/api/auth/')) {
      auth.user = null; eventSetup?.clear(); profileUI?.reset(); renderCloud();
      $('#auth-message').textContent = 'Your session ended. Sign in again to reopen your saved events. Nothing has been deleted.';
      if (!$('#auth-dialog').open) $('#auth-dialog').showModal();
    }
    const error = new Error(result.error || 'Something went wrong. Please retry.'); error.status = response.status; error.quota = result.quota; throw error;
  }
  return result;
}
function persist() {
  try {
    if (currentEvent && auth.user) localStorage.setItem(selectedEventKey(auth.user.id), currentEvent.id);
    else if (auth.user) localStorage.removeItem(selectedEventKey(auth.user.id));
    else localStorage.setItem(storageKey, JSON.stringify(state));
  } catch { notify('Browser preferences could not be saved. Your accepted cloud event remains in Supabase.'); }
}
function notify(text, error = false) { const el = $('#notice'); el.textContent = text; el.className = `notice${error ? ' error' : ''}`; }
function clearNotice() { $('#notice').classList.add('hidden'); }
function person(id, list = state.volunteers) { return list.find(p => p.id === id); }
function avatar(p) { const color = /^#[a-f\d]{6}$/i.test(p.color || '') ? p.color : '#7584b8'; return `<span class="avatar" style="background:${color}">${escape(p.name.charAt(0).toUpperCase())}</span>`; }
function setBusy(value, button = null) {
  busy = value;
  $$('#interpret-button, .edit-volunteer, .edit-assignments, #save-assignment-edits, #apply-repair, #find-cover, #save-connection, #export-button, #auth-submit, #signout-button, #new-event, #reload-event, #event-select, #create-event-button, #account-button, #generate-schedule, #add-volunteer, #add-shift, #save-volunteer, #save-shift, #delete-volunteer, #delete-shift, #edit-event, .edit-shift, #manage-setup, #event-use-gemma, #setup-close, #open-trash, #delete-event, #confirm-delete-event, .restore-event, #connection-button').forEach(b => { b.disabled = value; });
  $$('.button.busy').forEach(b => b.classList.remove('busy'));
  if (value && button) button.classList.add('busy');
  renderGemmaStatus();
  voiceInputs?.refresh();
  profileUI?.disable(value);
}
function renderConnection() {
  $('#connection-label').textContent = connection.verified ? 'Gemma connected' : connection.configured ? connection.managed ? 'Gemma configured' : 'Verify Gemma connection' : 'Connect Gemma';
  $('.status-dot').classList.toggle('connected', connection.verified);
  $('#model-input').value = connection.model || 'gemma-4-26b-a4b-it';
  $('#model-input').readOnly = !!connection.managed;
  $('#connection-private-fields').classList.toggle('hidden', !!connection.managed);
  if (connection.managed) $('#connection-description').textContent = 'Gemma is configured on the server. Your coordinator account can use it without handling or exposing the API key.';
}
function renderCloud() {
  $('#account-label').textContent = auth.user ? 'My account' : 'Sign in';
  $('#signed-in-panel').classList.toggle('hidden', !auth.user);
  $('#auth-form').classList.toggle('hidden', !!auth.user);
  const choices = currentEvent && !savedEvents.some(e => e.id === currentEvent.id) ? [{ id: currentEvent.id, name: state.event, event_date: state.date }, ...savedEvents] : savedEvents;
  $('#event-select').innerHTML = `<option value="" ${choices.length ? 'disabled' : ''}>Choose a saved event or create a new one</option>` + choices.map(e => `<option value="${escape(e.id)}">${escape(e.name)} · ${escape(e.event_date)}</option>`).join('');
  $('#event-select').value = currentEvent?.id || '';
  $('#cloud-status').textContent = currentEvent ? `Saved to Supabase · version ${currentEvent.version}` : auth.user ? 'Create an event to start your own roster' : 'Sign in to create and save your event';
  $('#cloud-status').classList.toggle('saved', !!currentEvent);
  $('#reload-event').classList.toggle('hidden', !auth.user);
  $('#edit-event').classList.toggle('hidden', !currentEvent);
  $('#open-trash').classList.toggle('hidden', !auth.user);
  $('#event-date-label').textContent = new Date(`${state.date}T00:00:00+06:00`).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'long', year: 'numeric' });
  $('#event-name-label').textContent = `${state.event} · GMT+6`;
}
function adoptCloud(data) {
  validateData(data.state.volunteers, data.state.shifts, data.state.schedule, { allowEmpty: true });

  currentEvent = { id: data.id, version: data.version };
  state = data.state; preview = null; interpretation = null;
  persist(); render(); renderPreview(); renderInterpretation();
}
async function refreshEventList() { if (auth.user) savedEvents = (await api('/api/events')).events; else savedEvents = []; renderCloud(); }
async function restoreCloud({ resume = true } = {}) {
  await refreshEventList();
  let last; try { if (resume) last = localStorage.getItem(selectedEventKey(auth.user.id)); } catch {}
  const selected = await recoverSavedEvent({ selectedId: last, events: savedEvents, load: id => api(`/api/events/${id}`) });
  if (selected) adoptCloud(selected);
  else { clearWorkspace(); persist(); render(); renderPreview(); renderInterpretation(); }
}
function workspaceStatus(mode, message = '') {
  const pending = mode !== 'ready'; document.body.classList.toggle('loading-workspace', pending);
  $('#workspace-loading').classList.toggle('hidden', !pending);
  $('#workspace-loading-message').textContent = message || 'Opening your saved workspace…';
  $('#retry-workspace').classList.toggle('hidden', mode !== 'error');
}
function setAuthMode(mode) {
  authMode = mode; $('#auth-title').textContent = mode === 'signup' ? 'Your next event starts here.' : 'Welcome back.';
  $('#auth-submit').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
  $('#signin-tab').classList.toggle('active', mode === 'signin'); $('#signup-tab').classList.toggle('active', mode === 'signup');
  $('#auth-password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('#signup-fields').classList.toggle('hidden', mode !== 'signup');
  $('#signup-fields').disabled = mode !== 'signup';
  $$('#signup-fields input').forEach(input => { input.required = mode === 'signup'; });
  $('#auth-message').textContent = '';
}
function metric(label, value, foot, symbol, color = '') { return `<article class="metric"><div><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></div><span class="metric-icon ${color}">${icon(symbol)}</span></article>`; }
function renderMetrics() {
  const check = checkSchedule(state.volunteers, state.shifts, state.schedule);
  if (!state.shifts.length) check.valid = false;
  const covered = state.shifts.filter(s => checkSchedule(state.volunteers.map(p => ({ ...p, maxHours: 24 })), [s], { [s.id]: state.schedule[s.id] }).valid).length;
  const hours = Object.values(check.workloads).reduce((a, b) => a + b, 0);
  const repairs = state.history.filter(entry => !entry.kind || entry.kind === 'repair').length;
  $('#metrics').innerHTML = metric('Shifts covered', `${covered}<span>/ ${state.shifts.length}</span>`, check.valid ? 'Every shift covered' : state.shifts.length ? 'Open places can be filled one at a time' : 'Your event starts with a blank roster', 'shield', 'green') + metric('Volunteers on the team', state.volunteers.length, 'Good people. A shared purpose.', 'users') + metric('Volunteer hours', `${hours}<span>hrs</span>`, 'Across the day’s assignments', 'clock', 'orange-bg') + metric('Changes saved', repairs, repairs ? 'Recorded in activity' : 'Ready for your first assignment', 'shuffle', 'purple');
  $('#schedule-status').textContent = check.valid ? 'All covered' : state.shifts.length ? 'In progress' : 'No shifts yet';
  $('[data-view=board] .nav-count').textContent = state.shifts.length;
  $('[data-view=team] .nav-count').textContent = state.volunteers.length;
  $('#team-count').textContent = `${state.volunteers.length} / 12 volunteers`;
  $('#generate-schedule').textContent = check.valid ? 'Check & rebalance' : 'Complete schedule';
  $('#schedule-status').className = `badge ${check.valid ? 'green' : 'rose'}`;
  $('#history-count').textContent = state.history.length;
  $('#request-input').placeholder = state.volunteers.length && state.shifts.length ? `e.g. Assign ${state.volunteers[0].name} to ${state.shifts[0].station}, ${clock(state.shifts[0].start)}–${clock(state.shifts[0].end)}.` : 'Add your team and shifts first, then describe a change.';
  $('#request-hint').textContent = state.volunteers.length && state.shifts.length ? 'Use names + shift or time' : 'Set up your event to use Gemma';
}
function renderBoard() {
  const times = [...new Set(state.shifts.map(s => s.start))].sort((a, b) => a - b);
  $('#schedule-board').innerHTML = times.map(start => `<div class="time-row flexible"><div class="time-label">${clock(start)}<small>${clock(state.shifts.find(s => s.start === start).end)}</small></div><div class="shift-cards">${state.shifts.filter(s => s.start === start).map(s => {
    const assigned = state.schedule[s.id] || [];
    const valid = checkSchedule(state.volunteers.map(p => ({ ...p, maxHours: 24 })), [s], { [s.id]: assigned }).valid;
    const latest = state.history[0]?.differences?.find(d => d.shiftId === s.id);
    return `<article class="shift ${s.station === 'Support desk' ? 'support' : ''} ${!valid ? 'invalid' : latest ? 'changed' : ''}"><div class="shift-header"><span>${escape(s.station)}</span><span class="shift-time">${clock(s.start)}–${clock(s.end)}</span></div>${assigned.map(id => {
      const p = person(id);
      return `<div class="assignment ${latest?.added.includes(id) ? 'new-person' : ''}">${avatar(p)}<span class="person-name">${escape(p.name)}</span>${latest?.added.includes(id) ? '<small>new</small>' : p.skills.includes('first-aid') ? `<span title="First-aid trained">${icon('shield')}</span>` : ''}</div>`;
    }).join('')}<div class="shift-note">${icon(valid ? 'check' : 'alert')}${assigned.length < s.required ? `${s.required - assigned.length} open place${s.required - assigned.length === 1 ? '' : 's'}` : !valid ? 'Skill coverage still needed' : `${assigned.length} of ${s.required} volunteers assigned`}</div><button class="button subtle small edit-assignments" data-shift="${escape(s.id)}">Edit assignments</button></article>`;
  }).join('')}</div></div>`).join('') || `<div class="empty-state"><h3>${currentEvent ? 'Add the first shift for your event.' : 'Your workspace starts here.'}</h3><p>${currentEvent ? 'Open Manage team & shifts to add your people, availability and staffing requirements.' : 'Create your own event, then add the volunteers and shifts you need.'}</p>${!currentEvent ? '<button id="empty-create-event" class="button primary">Create your first event</button>' : ''}</div>`;
  $$('.edit-assignments').forEach(button => button.addEventListener('click', () => openAssignmentEditor(button.dataset.shift)));
  $('#empty-create-event')?.addEventListener('click', () => $('#new-event').click());
  if (!currentEvent && !state.shifts.length) {
    const button = document.createElement('button'); button.className = 'button subtle'; button.textContent = 'Create from text or photo';
    button.addEventListener('click', () => eventSetup.open()); $('#schedule-board .empty-state').append(button);
  }
}
function renderTeam() {
  const { workloads } = checkSchedule(state.volunteers, state.shifts, state.schedule);
  $('#team-list').innerHTML = '<div class="team-row team-header"><span>VOLUNTEER</span><span>SKILLS</span><span>AVAILABILITY</span><span>HOURS</span><span></span></div>' + state.volunteers.map(p => `<div class="team-row"><div class="team-person">${avatar(p)}${escape(p.name)}</div><div class="skills">${p.skills.map(skill => `<span class="badge ${skill === 'first-aid' ? 'green' : 'neutral'}">${escape(skill)}</span>`).join('') || 'No skills recorded'}</div><span>${p.availability.length ? p.availability.map(([a, b]) => `${clock(a)}–${clock(b)}`).join(' · ') : 'Unavailable all day'}</span><div class="team-hours">${workloads[p.id]} / ${p.maxHours}h<div class="hours-bar"><span style="width:${Math.min(100, p.maxHours ? workloads[p.id] / p.maxHours * 100 : 0)}%"></span></div></div><button class="button subtle small edit-volunteer" data-person="${escape(p.id)}">Edit</button></div>`).join('');
  $$('.edit-volunteer').forEach(button => button.addEventListener('click', () => openEditor(button.dataset.person)));
}
function renderHistory() {
  $('#history-list').innerHTML = state.history.length ? state.history.map(entry => `<article class="history-entry"><span class="scenario-icon purple">${icon('shuffle')}</span><div class="history-copy"><h3>${escape(entry.title)}</h3><p>${escape(entry.text)}</p><div class="history-tag"><span class="badge ${entry.source === 'gemma' ? 'purple' : 'neutral'}">${entry.source === 'gemma' ? 'INTERPRETED BY GEMMA' : entry.source === 'team' ? 'TEAM SETTINGS' : 'SCRIPTED SCENARIO'}</span></div></div><small>${escape(new Date(entry.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit' }))} Dhaka</small></article>`).join('') : `<div class="empty-state">${icon('history')}<h3>A clear day so far.</h3><p>Applied repairs will appear here, with a record of what changed.</p></div>`;
}
function render() { renderMetrics(); renderBoard(); renderTeam(); renderShifts(); renderHistory(); renderCloud(); renderGemmaStatus(); }
function showView(view) {
  for (const name of ['board', 'team', 'history']) $(`#${name}-view`).classList.toggle('hidden', name !== view);
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  const info = { board: ['Schedule', 'A change of plans, handled.', 'Keep the event moving. We’ll help you find the cover.'], team: ['Team & shifts', 'The people behind the day.', 'Set up your real event, then generate a schedule.'], history: ['Activity', 'Every rescue leaves a trace.', 'A clear record of what changed, and why.'] }[view];
  $('#breadcrumb-view').textContent = info[0]; $('#page-title').textContent = info[1]; $('#page-subtitle').textContent = info[2];
}
function changeDescription(c, people = state.volunteers) {
  const p = person(c.volunteerId, people);
  if (c.type === 'assign' || c.type === 'unassign') {
    const shift = state.shifts.find(s => s.id === c.shiftId);
    return `${p.name}: ${c.type === 'assign' ? 'add to' : 'remove from'} ${shift.station}, ${clock(shift.start)}–${clock(shift.end)}`;
  }
  return c.type === 'max_hours' ? `${p.name}: maximum ${c.hours} working hours` : `${p.name}: unavailable ${c.start}–${c.end}`;
}
function renderInterpretation() {
  const el = $('#interpretation');
  if (!interpretation) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = `<span class="badge ${interpretation.source === 'gemma' ? 'purple' : 'neutral'}">${interpretation.source === 'gemma' ? 'GEMMA INTERPRETATION' : 'PROPOSED CHANGES'}</span><p>${interpretation.status === 'ready' ? 'Review these proposed changes. Nothing has been saved.' : escape(interpretation.message)}</p>${interpretation.changes.map(c => `<div class="change-line">${escape(changeDescription(c))}</div>`).join('')}<div class="provenance">${interpretation.source === 'gemma' ? escape(interpretation.model) : ''}</div>${interpretation.status === 'ready' ? '<button id="find-cover" class="button primary full">Preview changes</button>' : ''}`;
  $('#find-cover')?.addEventListener('click', () => runRepair(interpretation.changes, interpretation.source, interpretation.requestText || interpretation.message));
}
async function runRepair(changes, source, requestText, people = state.volunteers) {
  if (busy) return;
  clearNotice(); setBusy(true, $('#find-cover'));
  try {
    const result = await api('/api/repair', { volunteers: people, shifts: state.shifts, schedule: state.schedule, changes, eventId: currentEvent?.id, expectedVersion: currentEvent?.version, source, requestText });
    preview = { ...result, source, requestText };
    renderPreview();
    $('#repair-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { notify(error.message, true); } finally { setBusy(false); }
}
function renderPreview() {
  const el = $('#repair-panel');
  if (!preview) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const incremental = preview.mode === 'incremental';
  if (!preview.schedule) {
    const conflict = preview.status === 'infeasible' || preview.status === 'conflict';
    el.innerHTML = `<div class="eyebrow muted">${conflict ? 'ASSIGNMENT CONFLICT' : 'SEARCH LIMIT REACHED'}</div><h2>${conflict ? incremental ? 'These changes need a small adjustment.' : 'The complete schedule needs more coverage.' : 'We need more search time.'}</h2><p>${conflict ? incremental ? 'The requested changes conflict with an assignment rule. Your saved assignments are unchanged.' : 'A complete schedule cannot be generated yet. You can still add or edit individual assignments.' : 'No complete schedule was found within the search budget. This does not prove the event is impossible.'}</p><ul class="conflict-list">${preview.diagnostics.map(text => `<li>${escape(text)}</li>`).join('')}</ul><div class="repair-actions"><button id="discard-preview" class="button subtle">Dismiss</button></div>`;
  } else {
    const placements = preview.assignments || [];
    const fullCheck = checkSchedule(preview.volunteers, state.shifts, preview.schedule);
    const edits = preview.changes || placements;
    const count = preview.changedAssignments;
    const differences = preview.differences.map(d => `<div class="diff-row"><div><strong>${escape(d.station)}</strong><small>${clock(d.start)}–${clock(d.end)}</small></div><span class="removed-name">${d.removed.map(id => escape(person(id).name)).join(', ')}</span>${icon('arrow')}<span class="added-name">${d.added.map(id => escape(person(id, preview.volunteers).name)).join(', ')}</span></div>`).join('');
    el.innerHTML = `<div class="eyebrow muted">${incremental ? 'YOUR SHIFT CHANGES' : 'COMPLETE SCHEDULE PREVIEW'}</div><h2>${incremental ? 'Save this step. Keep building.' : 'Review the complete schedule.'}</h2><p>${incremental ? 'Only these changes will be saved. Other shifts can stay open.' : 'The full schedule takes effect only when you apply it.'}</p><div class="repair-summary"><span class="badge green">${icon('check')} ${incremental ? 'No assignment conflicts' : 'All rules satisfied'}</span><span class="badge ${fullCheck.valid ? 'green' : 'neutral'}">${fullCheck.valid ? 'All shifts covered' : 'Schedule in progress'}</span><span class="badge purple">${count} assignment${count === 1 ? '' : 's'} ${incremental ? 'updated' : 'replaced'}</span></div>${edits.length ? `<h3>Proposed changes</h3>${edits.map(c => `<div class="change-line">${escape(changeDescription(c, preview.volunteers))}</div>`).join('')}` : ''}${differences}${incremental && preview.warnings?.length ? `<div class="setup-review-notice"><strong>You can save now; these gaps can be filled later.</strong><ul>${preview.warnings.map(text => `<li>${escape(text)}</li>`).join('')}</ul></div>` : ''}<p class="fine-print">${incremental ? 'Adding, removing or moving one volunteer does not require a complete event schedule.' : `${preview.nodes.toLocaleString()} search states checked. ${preview.optimal ? 'Fewest changes verified; workload balance breaks ties.' : 'Valid solution; optimality is not proven.'}`}</p><div class="repair-actions"><button id="discard-preview" class="button subtle">Keep saved assignments</button><button id="apply-repair" class="button primary">${incremental ? 'Save changes' : 'Apply complete schedule'} ${icon('check')}</button></div>`;
    $('#apply-repair').addEventListener('click', async () => {
      if (busy) return;
      const check = checkSchedule(preview.volunteers, state.shifts, preview.schedule, { assignments: placements, allowPartial: incremental });
      if (!check.valid) { notify('Validation failed. Your saved assignments are unchanged.', true); return; }
      if (currentEvent) {
        setBusy(true, $('#apply-repair'));
        try {
          const saved = await api(`/api/events/${currentEvent.id}/apply`, { proposalId: preview.proposalId });
          adoptCloud(saved); await refreshEventList(); notify(incremental ? 'Changes saved. You can fill the remaining shifts whenever you are ready.' : 'Complete schedule applied and saved.');
          $('#schedule-board').scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (error) { notify(error.message, true); } finally { setBusy(false); }
        return;
      }
      state.volunteers = preview.volunteers; state.schedule = preview.schedule;
      state.history.unshift({ at: new Date().toISOString(), title: `${count} assignment${count === 1 ? '' : 's'} updated`, text: preview.requestText, source: preview.source, differences: preview.differences });
      state.history = state.history.slice(0, 50);
      preview = null; interpretation = null; render(); renderPreview(); renderInterpretation(); persist();
      notify('Changes saved on this browser. Open places can be filled later.');
      $('#schedule-board').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  $('#discard-preview').addEventListener('click', () => { preview = null; renderPreview(); });
}
function openAssignmentEditor(id) {
  if (busy) return;
  editingAssignmentsShiftId = id;
  const shift = state.shifts.find(s => s.id === id);
  $('#assignment-title').textContent = `${shift.station} · ${clock(shift.start)}–${clock(shift.end)}`;
  $('#assignment-help').textContent = `Choose up to ${shift.required} volunteer${shift.required === 1 ? '' : 's'}. You can leave places open and save other shifts later.`;
  $('#assignment-options').innerHTML = state.volunteers.map(p => `<label class="checkbox-label"><input type="checkbox" data-volunteer="${escape(p.id)}" ${(state.schedule[id] || []).includes(p.id) ? 'checked' : ''}>${escape(p.name)}</label>`).join('') || '<p>Add a volunteer in Manage team & shifts first.</p>';
  $('#assignment-message').textContent = '';
  $('#assignment-dialog').showModal();
}
$('#assignment-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const shift = state.shifts.find(s => s.id === editingAssignmentsShiftId);
  const selected = [...$('#assignment-options').querySelectorAll('input:checked')].map(el => el.dataset.volunteer);
  if (selected.length > shift.required) { $('#assignment-message').textContent = `This shift has ${shift.required} place${shift.required === 1 ? '' : 's'}. Remove a selection before previewing.`; return; }
  const before = state.schedule[shift.id] || [];
  const changes = [...before.filter(id => !selected.includes(id)).map(volunteerId => ({ type: 'unassign', volunteerId, shiftId: shift.id })), ...selected.filter(id => !before.includes(id)).map(volunteerId => ({ type: 'assign', volunteerId, shiftId: shift.id }))];
  $('#assignment-dialog').close();
  if (!changes.length) { notify('No assignment changes to save.'); return; }
  await runRepair(changes, 'team', `Updated assignments for ${shift.station}, ${clock(shift.start)}–${clock(shift.end)}.`);
});
function openEditor(id = null) {
  if (busy) return;
  if (!id && state.volunteers.length >= 12) { notify('This prototype supports up to 12 volunteers per event.', true); return; }
  editingId = id; const p = id ? person(id) : { name: '', skills: ['welcome'], availability: [[600, 960]], maxHours: 4 };
  $('#edit-title').textContent = id ? `Edit ${p.name}` : 'Add volunteer'; $('#edit-name').value = p.name;
  $('#edit-availability').value = p.availability.map(([a, b]) => `${clock(a)}-${clock(b)}`).join(', ');
  $('#edit-hours').value = p.maxHours; $('#edit-skills').value = p.skills.join(', '); $('#edit-message').textContent = '';
  $('#delete-volunteer').classList.toggle('hidden', !id); $('#edit-dialog').showModal();
}
function skillList(value) { return [...new Set(value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))]; }
function draftState(next) {
  validateData(next.volunteers, next.shifts, null, { allowEmpty: true });
  next.schedule = retainValidAssignments(next.volunteers, next.shifts, next.schedule);
  return next;
}
async function saveSetup(next) {
  next = draftState(next); setBusy(true);
  try {
    if (currentEvent) { adoptCloud(await api(`/api/events/${currentEvent.id}/setup`, { state: next, expectedVersion: currentEvent.version })); await refreshEventList(); }
    else { next.history.unshift({ at: new Date().toISOString(), kind: 'setup', title: 'Event setup updated', text: 'Updated the team or shifts.', source: 'team', differences: [] }); next.history = next.history.slice(0, 50); state = next; preview = null; interpretation = null; persist(); render(); renderPreview(); renderInterpretation(); }
    const ready = state.shifts.length && checkSchedule(state.volunteers, state.shifts, state.schedule).valid;
    notify(ready ? 'Setup saved. Every shift is covered.' : 'Setup saved. Unaffected assignments were kept. Fill open places one at a time or choose Complete schedule.');
  } finally { setBusy(false); }
}
function renderShifts() {
  $('#shift-list').innerHTML = state.shifts.map(s => `<div class="setup-shift"><div><strong>${escape(s.station)}</strong><p>${clock(s.start)}–${clock(s.end)} · ${s.required} ${s.required === 1 ? 'person' : 'people'} · ${escape(s.skills.join(', ') || 'No special skills required')}</p></div><button class="button subtle small edit-shift" data-shift="${escape(s.id)}">Edit shift</button></div>`).join('') || '<p class="section-description">No shifts yet. Add the places and times that need coverage.</p>';
  $$('.edit-shift').forEach(b => b.addEventListener('click', () => openShift(b.dataset.shift)));
}
function openShift(id = null) {
  if (busy) return;
  if (!id && state.shifts.length >= 8) { notify('This prototype supports up to 8 shifts per event.', true); return; }
  editingShiftId = id; const s = state.shifts.find(s => s.id === id) || { station: '', start: 600, end: 720, required: 2, skills: [] };
  $('#shift-title').textContent = id ? 'Edit shift' : 'Add shift'; $('#shift-station').value = s.station; $('#shift-start').value = clock(s.start); $('#shift-end').value = clock(s.end); $('#shift-required').value = s.required; $('#shift-skills').value = s.skills.join(', '); $('#shift-message').textContent = ''; $('#delete-shift').classList.toggle('hidden', !id); $('#shift-dialog').showModal();
}
function renderGemmaStatus() {
  eventSetup?.refresh();
  const box = $('#gemma-status'); if (!box) return;
  box.classList.toggle('hidden', !gemmaIssue);
  const remaining = gemmaIssue?.retryAt ? Math.max(0, Date.parse(gemmaIssue.retryAt) - Date.now()) : 0;
  $('#interpret-button').disabled = busy || remaining > 0 || !state?.volunteers.length || !state?.shifts.length;
  if (!gemmaIssue) return;
  const retry = gemmaIssue.retryAt ? new Date(gemmaIssue.retryAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) + ' Dhaka (GMT+6)' : null;
  const mins = Math.ceil(remaining / 60000);
  const refresh = !gemmaIssue.isQuota ? 'You can retry the request when the service is available.' : retry ? `${gemmaIssue.resetSource === 'daily-window' ? 'Expected daily refresh' : 'Google’s retry time'}: ${retry}. ${remaining ? `Retry in ${mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`}.` : 'The retry window has arrived. You can try your request again.'}` : 'Refresh time: Google did not supply one. Check quota and model access in AI Studio, or retry later.';
  const markup = `<strong>${gemmaIssue.isQuota ? 'Gemma limit reached' : 'Gemma could not respond'}</strong><p>${escape(gemmaIssue.message)}</p><p>${escape(refresh)}</p><p>Your saved schedule is unchanged. Team settings and the schedule generator still work.</p><button type="button" id="quota-team" class="button subtle small">Edit team manually</button>`;
  if (box.dataset.rendered === markup) return;
  box.dataset.rendered = markup; box.innerHTML = markup;
  $('#quota-team').addEventListener('click', () => showView('team'));
}
function showGemmaError(error) {
  gemmaIssue = { ...(error.quota || {}), message: error.message, isQuota: !!error.quota };
  try { sessionStorage.setItem('shiftrescue-gemma-issue', JSON.stringify(gemmaIssue)); } catch {}
  renderGemmaStatus(); connection.verified = false; renderConnection();
}
function clearGemmaError() { gemmaIssue = null; try { sessionStorage.removeItem('shiftrescue-gemma-issue'); } catch {} renderGemmaStatus(); }
setInterval(() => { if (gemmaIssue?.retryAt) renderGemmaStatus(); }, 1000);
$('#manage-setup').addEventListener('click', () => showView('team'));
$('#add-volunteer').addEventListener('click', () => openEditor());
$('#add-shift').addEventListener('click', () => openShift());
$('#generate-schedule').addEventListener('click', () => {
  if (!state.volunteers.length || !state.shifts.length) { notify('Add at least one volunteer and one shift first.', true); showView('team'); return; }
  return runRepair([], 'team', 'Generated a valid schedule from the current event setup.');
});
$('#shift-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  try {
    const next = structuredClone(state), shift = { id: editingShiftId || `s-${crypto.randomUUID().slice(0, 8)}`, station: $('#shift-station').value.trim(), start: parseTime($('#shift-start').value), end: parseTime($('#shift-end').value), required: Number($('#shift-required').value), skills: skillList($('#shift-skills').value) };
    const at = next.shifts.findIndex(s => s.id === editingShiftId); if (at < 0) next.shifts.push(shift); else next.shifts[at] = shift;
    await saveSetup(next); $('#shift-dialog').close();
  } catch (error) { $('#shift-message').textContent = error.message; }
});
$('#delete-shift').addEventListener('click', async () => {
  if (busy || !editingShiftId || !confirm('Remove this shift from the event?')) return;
  try { const next = structuredClone(state); next.shifts = next.shifts.filter(s => s.id !== editingShiftId); await saveSetup(next); $('#shift-dialog').close(); } catch (error) { $('#shift-message').textContent = error.message; }
});
$('#delete-volunteer').addEventListener('click', async () => {
  if (busy || !editingId || !confirm('Remove this volunteer? Affected assignments will become a draft.')) return;
  try { const next = structuredClone(state); next.volunteers = next.volunteers.filter(p => p.id !== editingId); await saveSetup(next); $('#edit-dialog').close(); } catch (error) { $('#edit-message').textContent = error.message; }
});
$$('.nav-item').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
$('#request-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const request = $('#request-input').value.trim();
  if (!request) { notify('Describe an assignment or availability change using a volunteer’s name and a shift or time interval.', true); $('#request-input').focus(); return; }
  if (auth.configured && !auth.user) { $('#auth-message').textContent = 'Sign in to use Gemma and save your work.'; $('#auth-dialog').showModal(); return; }
  if (!connection.configured) { $('#connection-dialog').showModal(); return; }
  clearNotice(); preview = null; interpretation = null; renderPreview(); renderInterpretation(); setBusy(true, $('#interpret-button'));
  try {
    const result = await api('/api/interpret', { request, volunteers: state.volunteers, shifts: state.shifts, schedule: state.schedule, eventId: currentEvent?.id, date: state.date });
    if ($('#request-input').value.trim() !== request) { notify('Your request changed. Choose Understand request again for the new text.'); return; }
    interpretation = { ...result, requestText: request };
    clearGemmaError(); connection.verified = true; renderConnection(); renderInterpretation();
  } catch (error) { showGemmaError(error); notify(error.message, true); } finally { setBusy(false); }
});
$('#connection-button').addEventListener('click', () => { if (auth.configured && !auth.user) { $('#auth-dialog').showModal(); return; } $('#connection-message').textContent = ''; $('#connection-dialog').showModal(); });
$$('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('#connection-dialog').addEventListener('close', () => { $('#key-input').value = ''; });
$('#connection-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const model = $('#model-input').value.trim(), key = $('#key-input').value.trim(), message = $('#connection-message');
  if (!key && !connection.configured) { message.textContent = 'Enter your API key to connect Gemma.'; return; }
  if (!key && model !== connection.model) { message.textContent = 'Enter the key again to change the model.'; return; }
  message.textContent = 'Making a real request to Gemma…'; message.classList.remove('success'); setBusy(true, $('#save-connection'));
  $('#key-input').value = '';
  try {
    const next = await api(key && !connection.managed ? '/api/connection' : '/api/test-connection', key && !connection.managed ? { key, model } : {});
    connection = { ...connection, ...next };
    clearGemmaError(); renderConnection(); message.textContent = 'Connected. Gemma responded successfully.'; message.classList.add('success');
    notify('Gemma is connected. Type a request to interpret it with your model.');
  } catch (error) { message.textContent = error.message; showGemmaError(error); } finally { setBusy(false); }
});
$('#edit-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  try {
    const next = structuredClone(state), raw = $('#edit-availability').value.trim();
    const availability = raw ? raw.split(',').map(part => { const pair = part.trim().split(/[-–]/).map(v => v.trim()); if (pair.length !== 2) throw new Error('Use intervals such as 10:00-12:00, 14:00-16:00.'); return pair.map(parseTime); }) : [];
    const p = { id: editingId || `v-${crypto.randomUUID().slice(0, 8)}`, name: $('#edit-name').value.trim(), availability, maxHours: Number($('#edit-hours').value), skills: skillList($('#edit-skills').value), color: person(editingId)?.color || '#7584b8' };
    const at = next.volunteers.findIndex(p => p.id === editingId); if (at < 0) next.volunteers.push(p); else next.volunteers[at] = p;
    await saveSetup(next); $('#edit-dialog').close();
  } catch (error) { $('#edit-message').textContent = error.message; }
});
$('#export-button').addEventListener('click', () => {
  const cell = value => { let text = String(value); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; };
  const rows = [['Date', 'Timezone', 'Station', 'Start', 'End', 'Volunteers', 'Required skills'], ...state.shifts.map(s => [state.date, state.timezone, s.station, clock(s.start), clock(s.end), state.schedule[s.id].map(id => person(id).name).join('; '), s.skills.join('; ')])];
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `shiftrescue-${state.date}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
profileUI = initProfile({ api, getUser: () => auth.user, onEmailChanged(user) { auth.user = user; } });
$('#account-button').addEventListener('click', () => { $('#auth-message').textContent = ''; renderCloud(); $('#auth-dialog').showModal(); if (auth.user) profileUI.open(); });
$('#signin-tab').addEventListener('click', () => setAuthMode('signin'));
$('#signup-tab').addEventListener('click', () => setAuthMode('signup'));
$('#auth-dialog').addEventListener('close', () => { $('#auth-password').value = ''; });
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  setBusy(true, $('#auth-submit')); $('#auth-message').textContent = authMode === 'signup' ? 'Creating your account…' : 'Signing in…';
  let authenticated = false;
  const password = $('#auth-password').value; $('#auth-password').value = '';
  try {
    const result = await api(`/api/auth/${authMode}`, { email: $('#auth-email').value.trim(), password, ...(authMode === 'signup' ? { name: $('#signup-name').value, username: $('#signup-username').value, phone: $('#signup-phone').value } : {}) });
    $$('#signup-fields input').forEach(input => { input.value = ''; });
    if (result.confirmationRequired) { setAuthMode('signin'); $('#auth-message').textContent = result.message; return; }
    auth.user = result.user; authenticated = true; workspaceStatus('loading'); clearWorkspace(); await restoreCloud(); workspaceStatus('ready'); $('#auth-dialog').close();
    notify(currentEvent ? `Signed in. Reopened “${state.event}”.` : 'Signed in. Create your first event to get started.');

  } catch (error) {
    if (authenticated) { $('#auth-dialog').close(); workspaceStatus('error', `${error.message} Your saved events have not been deleted. Try opening them again.`); }
    else $('#auth-message').textContent = error.message;
  } finally { setBusy(false); }
});
$('#signout-button').addEventListener('click', async () => {
  if (busy) return; setBusy(true, $('#signout-button'));
  try {
    await api('/api/auth/signout', {}); eventSetup.clear(); auth.user = null; profileUI.reset(); savedEvents = []; clearWorkspace();
    $('#auth-dialog').close(); render(); renderInterpretation(); renderPreview(); showView('board'); notify('Signed out. Your cloud events remain private to your account.');
  } catch (error) { notify(error.message, true); } finally { setBusy(false); }
});
$('#edit-event').addEventListener('click', () => { editingEvent = true; openEventDialog(); });
$('#delete-event').addEventListener('click', () => {
  if (busy || !currentEvent) return;
  deleteTarget = { ...currentEvent, name: state.event };
  $('#event-dialog').close(); $('#delete-event-description').textContent = `“${deleteTarget.name}” will be removed from your active events.`;
  $('#delete-event-message').textContent = ''; $('#delete-event-dialog').showModal();
});
$('#delete-event-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !deleteTarget) return;
  setBusy(true, $('#confirm-delete-event')); let removed = false;
  try {
    await api(`/api/events/${deleteTarget.id}/delete`, { expectedVersion: deleteTarget.version }); removed = true;
    savedEvents = savedEvents.filter(e => e.id !== deleteTarget.id);
    clearWorkspace(); persist(); $('#delete-event-dialog').close();
    await restoreCloud(); notify('Event moved to Trash. You can restore it from Trash.');
  } catch (error) {
    if (removed) { render(); notify(`Event moved to Trash. The event list could not refresh: ${error.message}`, true); }
    else $('#delete-event-message').textContent = error.message;
  } finally { setBusy(false); }
});
async function refreshTrash() {
  $('#trash-message').textContent = 'Loading deleted events…';
  const { events } = await api('/api/events/trash');
  $('#trash-message').textContent = '';
  $('#trash-list').innerHTML = events.length ? events.map(e => `<div class="trash-row"><div><strong>${escape(e.name)}</strong><small>${escape(e.event_date)}</small></div><button class="button subtle small restore-event" data-id="${escape(e.id)}" data-version="${e.version}">Restore event</button></div>`).join('') : '<p>Trash is empty.</p>';
}
$('#open-trash').addEventListener('click', async () => {
  if (busy || !auth.user) return;
  $('#trash-list').replaceChildren(); $('#trash-dialog').showModal(); setBusy(true);
  try { await refreshTrash(); } catch (error) { $('#trash-message').textContent = error.message; } finally { setBusy(false); }
});
$('#trash-list').addEventListener('click', async event => {
  const button = event.target.closest('.restore-event'); if (!button || busy) return;
  setBusy(true, button); let restored = false;
  try {
    adoptCloud(await api(`/api/events/${button.dataset.id}/restore`, { expectedVersion: Number(button.dataset.version) })); restored = true;
    await refreshEventList(); $('#trash-dialog').close(); notify('Event restored with its saved team, shifts and schedule.');
  } catch (error) {
    if (restored) { $('#trash-dialog').close(); notify(`Event restored, but its list could not refresh: ${error.message}`, true); }
    else $('#trash-message').textContent = error.message;
  } finally { setBusy(false); }
});
function openEventDialog() {
  $('#event-dialog h2').textContent = editingEvent ? 'Edit event & date.' : 'Make it your event.';
  $('#event-dialog .eyebrow').textContent = editingEvent ? 'EVENT SETTINGS' : 'A NEW EVENT';
  $('#event-use-gemma').classList.toggle('hidden', editingEvent);
  $('#delete-event').classList.toggle('hidden', !editingEvent || !currentEvent);
  $('#event-name').value = editingEvent ? state.event : ''; $('#event-date-input').value = state.date; $('#event-message').textContent = ''; $('#event-copy').checked = false; $('#event-copy-label').classList.toggle('hidden', editingEvent || !(state.volunteers.length || state.shifts.length)); $('#event-description').textContent = editingEvent ? 'Update the event name or date. Shift times stay in Dhaka.' : 'Create an event for your own team, shifts and schedule.'; $('#create-event-button').textContent = editingEvent ? 'Save event settings' : 'Create saved event'; $('#event-dialog').showModal();
}
$('#new-event').addEventListener('click', () => {
  if (busy) return;
  if (!auth.user) { $('#auth-dialog').showModal(); return; }
  editingEvent = false; openEventDialog();
});
$('#event-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return; setBusy(true, $('#create-event-button'));
  try {
    if (editingEvent) { await saveSetup({ ...state, event: $('#event-name').value.trim(), date: $('#event-date-input').value }); $('#event-dialog').close(); return; }
    const saved = await api('/api/events', { name: $('#event-name').value.trim(), date: $('#event-date-input').value, ...($('#event-copy').checked ? { state } : {}) });
    adoptCloud(saved); await refreshEventList(); $('#event-dialog').close(); notify('Event saved to Supabase. Accepted repairs now update this cloud event.');
  } catch (error) { $('#event-message').textContent = error.message; } finally { setBusy(false); }
});
$('#event-select').addEventListener('change', async event => {
  if (busy) return;
  const id = event.target.value;
  if (!id) { renderCloud(); return; }
  setBusy(true);
  try { adoptCloud(await api(`/api/events/${id}`)); clearNotice(); } catch (error) { notify(error.message, true); renderCloud(); } finally { setBusy(false); }
});
$('#reload-event').addEventListener('click', async () => {
  if (busy || !auth.user) return; setBusy(true, $('#reload-event'));
  try { await restoreCloud(); notify('Loaded your latest saved events from Supabase.'); } catch (error) { notify(error.message, true); } finally { setBusy(false); }
});
eventSetup = initEventSetup({
  api, context: () => ({ auth, connection, busy, gemmaIssue }), setBusy,
  onGemmaSuccess() { clearGemmaError(); connection.verified = true; renderConnection(); },
  onGemmaError: showGemmaError,
  requestSignIn() { $('#auth-message').textContent = 'Sign in to describe and save your event.'; $('#auth-dialog').showModal(); },
  requestConnection() { $('#connection-dialog').showModal(); },
  async onCreated(saved) {
    setBusy(true); adoptCloud(saved); showView('board');
    try { await refreshEventList(); } catch { notify('The event was saved, but the event list could not refresh. Reload the page if needed.', true); }
    finally { setBusy(false); }
    notify('Event saved. Add volunteers to individual shifts, or choose Complete schedule when you want a full schedule.');
  }
});
voiceInputs = initVoiceInputs({
  api, context: () => ({ auth, connection, busy, eventId: currentEvent?.id }), setBusy,
  requestSignIn() { $('#setup-dialog').close(); $('#auth-message').textContent = 'Sign in to use voice input.'; $('#auth-dialog').showModal(); },
  requestConnection() { $('#setup-dialog').close(); $('#connection-dialog').showModal(); }
});
async function init() {
  if (busy) return;
  state ||= emptyWorkspace(); workspaceStatus('loading'); setBusy(true);
  if (/access_token=|refresh_token=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  try {
    const [status, account] = await Promise.allSettled([api('/api/status'), api('/api/auth/session')]);
    if (status.status === 'fulfilled') { connection = status.value; renderConnection(); }
    if (account.status === 'rejected') throw account.reason;
    auth = account.value;
    if (auth.user) await restoreCloud();
    else {
      state = emptyWorkspace(); currentEvent = null;
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey));
        if (saved && typeof saved.event === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.date) && saved.timezone === 'Asia/Dhaka' && Array.isArray(saved.history) && saved.history.length <= 50) {
          validateData(saved.volunteers, saved.shifts, saved.schedule, { allowEmpty: true }); state = saved;
        }
      } catch { /* Invalid local drafts do not affect saved cloud events. */ }
      render();
    }
    renderConnection(); renderGemmaStatus(); workspaceStatus('ready');
    try { $('#request-input').value = sessionStorage.getItem('shiftrescue-request-draft') || ''; } catch {}
    if (status.status === 'rejected') notify('Your saved events are open, but the Gemma connection could not be checked. You can continue editing manually.', true);
  } catch (error) { workspaceStatus('error', `${error.message} Your saved events have not been deleted. Try opening them again.`); }
  finally { setBusy(false); }
}
$('#retry-workspace').addEventListener('click', init);
$('#request-input').addEventListener('input', () => { interpretation = null; preview = null; renderInterpretation(); renderPreview(); try { sessionStorage.setItem('shiftrescue-request-draft', $('#request-input').value); } catch {} });
init();
