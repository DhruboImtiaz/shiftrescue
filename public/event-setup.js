import { reviewSetupDraft, compileSetupDraft } from '/setup.mjs';
import { checkSchedule } from '/scheduler.mjs';
import { initPhotoInput } from '/photo.js';

export function initEventSetup({ api, context, setBusy, onCreated, onGemmaSuccess, onGemmaError, requestSignIn, requestConnection }) {
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let result = null, owner = null;
  const photo = initPhotoInput({ onChange: invalidateDraft, onState: refresh });
  const storageKey = () => `shiftrescue-setup-description-${context().auth.user?.id || 'local'}`;
  const skillsText = value => value === null ? '' : value.join(', ') || 'none';
  const field = (label, key, value, options = '') => `<label>${label}<input data-field="${key}" value="${escape(value)}" ${options}></label>`;
  function open() {
    const { auth, busy } = context();
    if (busy) return;
    if (auth.configured && !auth.user) { requestSignIn(); return; }
    if (owner !== (auth.user?.id || 'local')) {
      photo.clear(false);
      owner = auth.user?.id || 'local'; result = null; $('#setup-review').classList.add('hidden'); $('#setup-review-form').reset();
      try { $('#setup-description').value = sessionStorage.getItem(storageKey()) || ''; } catch { $('#setup-description').value = ''; }
    }
    $('#setup-message').textContent = ''; refresh(); $('#setup-dialog').showModal(); $('#setup-description').focus();
  }
  function refresh() {
    const { busy, gemmaIssue } = context();
    const remaining = gemmaIssue?.retryAt ? Math.max(0, Date.parse(gemmaIssue.retryAt) - Date.now()) : 0;
    $('#draft-event-button').disabled = busy || photo.processing || remaining > 0;
    $('#confirm-setup').disabled = busy;
    $('#setup-description-count').textContent = `${$('#setup-description').value.length.toLocaleString()} / 8,000 characters`;
    const warning = $('#setup-gemma-status');
    warning.classList.toggle('hidden', !gemmaIssue);
    if (gemmaIssue) {
      const retry = gemmaIssue.retryAt ? new Date(gemmaIssue.retryAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' }) + ' Dhaka' : null;
      warning.textContent = `${gemmaIssue.isQuota ? 'Gemma limit reached. ' : ''}${gemmaIssue.message} ${retry ? `${gemmaIssue.resetSource === 'daily-window' ? 'Expected refresh' : 'Google’s retry time'}: ${retry}.${remaining ? '' : ' You can retry now.'}` : gemmaIssue.isQuota ? 'Google did not provide a refresh time.' : ''} Your description is kept. You can still edit and save a draft already returned by Gemma.`;
    }
    $('#setup-description').disabled = busy;
    photo.disable(busy);
    $('#setup-dialog').querySelectorAll('.setup-add, .setup-remove, #setup-review-form input').forEach(el => { el.disabled = busy; });
    if (result) {
      $('#setup-add-person').disabled = busy || $('#setup-people').querySelectorAll('.setup-person').length >= 12;
      $('#setup-add-shift').disabled = busy || $('#setup-shifts').querySelectorAll('.setup-shift-draft').length >= 8;
    }
  }
  function readDraft() {
    const value = (row, key) => row.querySelector(`[data-field="${key}"]`).value.trim();
    const skills = raw => !raw ? null : raw.toLowerCase() === 'none' ? [] : [...new Set(raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))];
    const number = raw => raw === '' ? null : Number(raw);
    const draft = { event: $('#setup-event-name').value.trim() || null, date: $('#setup-event-date').value || null, volunteers: [], shifts: [], assignments: [] };
    $('#setup-people').querySelectorAll('.setup-person').forEach(row => {
      const raw = value(row, 'availability');
      draft.volunteers.push({ name: value(row, 'name') || null, skills: skills(value(row, 'skills')), maxHours: number(value(row, 'maxHours')), availability: !raw ? null : raw.toLowerCase() === 'none' ? [] : raw.split(',').map(a => a.trim().split(/[-–]/).map(t => t.trim())) });
    });
    $('#setup-shifts').querySelectorAll('.setup-shift-draft').forEach(row => {
      draft.shifts.push({ station: value(row, 'station') || null, start: value(row, 'start') || null, end: value(row, 'end') || null, required: number(value(row, 'required')), skills: skills(value(row, 'skills')) });
    });
    $('#setup-assignments').querySelectorAll('input:checked').forEach(input => draft.assignments.push({ volunteerIndex: Number(input.dataset.volunteer), shiftIndex: Number(input.dataset.shift) }));
    return draft;
  }
  function renderAssignments(draft) {
    $('#setup-assignments').innerHTML = draft.shifts.map((s, shiftIndex) => `<fieldset class="setup-entry assignment-preview"><legend>${escape(s.station || `Shift ${shiftIndex + 1}`)} · ${escape(s.start || '?')}–${escape(s.end || '?')}</legend>${draft.volunteers.map((p, volunteerIndex) => `<label class="checkbox-label"><input type="checkbox" data-volunteer="${volunteerIndex}" data-shift="${shiftIndex}" ${draft.assignments?.some(a => a.shiftIndex === shiftIndex && a.volunteerIndex === volunteerIndex) ? 'checked' : ''}>${escape(p.name || `Volunteer ${volunteerIndex + 1}`)}</label>`).join('') || '<p>Add volunteers to choose assignments.</p>'}</fieldset>`).join('');
  }
  function validateReview() {
    const box = $('#setup-review-issues');
    const preview = $('#setup-schedule-preview'); preview.replaceChildren();
    try {
      const draft = readDraft(), { issues } = reviewSetupDraft(draft);
      if (!issues.length) {
        try {
          const state = compileSetupDraft(draft), check = checkSchedule(state.volunteers, state.shifts, state.schedule, { allowPartial: true });
          preview.innerHTML = `<div class="setup-review-notice complete"><strong>No assignment conflicts.</strong> ${draft.assignments.length} assignment${draft.assignments.length === 1 ? '' : 's'} will be saved.</div>${check.warnings.length ? `<div class="setup-review-notice"><strong>You can save with these gaps:</strong><ul>${check.warnings.map(w => `<li>${escape(w)}</li>`).join('')}</ul></div>` : ''}`;
        } catch (error) { issues.push(error.message); }
      }
      box.innerHTML = issues.length ? `<strong>Complete these details before creating the event:</strong><ul>${issues.map(issue => `<li>${escape(issue)}</li>`).join('')}</ul>` : '<strong>All required fields are complete.</strong> Review the details below, then create the event. You can fill shifts one at a time.';
      box.classList.toggle('complete', !issues.length);
      return issues.length === 0;
    } catch (error) { box.textContent = error.message; box.classList.remove('complete'); return false; }
  }
  function renderReview() {
    const draft = result.draft;
    $('#setup-review').classList.remove('hidden');
    $('#setup-summary').textContent = result.message;
    $('#setup-model').textContent = `Draft interpreted by ${result.model}. All times are in Dhaka (GMT+6).`;
    $('#setup-questions').innerHTML = result.questions.length ? `<strong>Gemma needs clarification:</strong><ul>${result.questions.map(q => `<li>${escape(q)}</li>`).join('')}</ul>` : '';
    $('#setup-questions').classList.toggle('hidden', !result.questions.length);
    $('#setup-resolved-label').classList.toggle('hidden', !result.questions.length);
    $('#setup-event-name').value = draft.event || ''; $('#setup-event-date').value = draft.date || '';
    $('#setup-people').innerHTML = draft.volunteers.map((p, i) => `<fieldset class="setup-person setup-entry"><legend>Volunteer ${i + 1}</legend><div class="setup-fields">${field('Name', 'name', p.name, 'maxlength="60" autocomplete="off"')}${field('Skills (or none)', 'skills', skillsText(p.skills), 'maxlength="250" placeholder="first-aid, or none"')}${field('Availability (or none)', 'availability', p.availability === null ? '' : p.availability.map(a => a.join('-')).join(', ') || 'none', 'maxlength="500" placeholder="10:00-12:00, 14:00-16:00"')}${field('Maximum working hours', 'maxHours', p.maxHours, 'type="number" min="0" max="24" step="any"')}</div><button type="button" class="button subtle small setup-remove" data-kind="volunteers" data-index="${i}">Remove volunteer ${i + 1}</button></fieldset>`).join('');
    $('#setup-shifts').innerHTML = draft.shifts.map((s, i) => `<fieldset class="setup-shift-draft setup-entry"><legend>Shift ${i + 1}</legend><div class="setup-fields">${field('Station or task', 'station', s.station, 'maxlength="80"')}${field('People required', 'required', s.required, 'type="number" min="1" max="3" step="1"')}${field('Start (24-hour)', 'start', s.start, 'maxlength="5" placeholder="10:00"')}${field('End (24-hour)', 'end', s.end, 'maxlength="5" placeholder="12:00"')}${field('Required skills (or none)', 'skills', skillsText(s.skills), 'maxlength="250" placeholder="first-aid, or none"')}</div><button type="button" class="button subtle small setup-remove" data-kind="shifts" data-index="${i}">Remove shift ${i + 1}</button></fieldset>`).join('');
    $('#setup-add-person').disabled = draft.volunteers.length >= 12;
    $('#setup-add-shift').disabled = draft.shifts.length >= 8;
    renderAssignments(draft);
    validateReview();
  }
  $('#event-use-gemma').addEventListener('click', () => { $('#event-dialog').close(); open(); });
  $('#setup-close').addEventListener('click', () => { if (!context().busy) $('#setup-dialog').close(); });
  $('#setup-dialog').addEventListener('cancel', event => { if (context().busy) event.preventDefault(); });
  function invalidateDraft() {
    result = null; $('#setup-review').classList.add('hidden'); $('#setup-resolved').checked = false; $('#setup-message').textContent = '';
    refresh();
  }
  $('#setup-description').addEventListener('input', () => {
    invalidateDraft();
    try { sessionStorage.setItem(storageKey(), $('#setup-description').value); } catch {}
  });
  $('#setup-description-form').addEventListener('submit', async event => {
    event.preventDefault(); const { auth, connection, busy } = context();
    if (busy || photo.processing) return;
    if (auth.configured && !auth.user) { $('#setup-dialog').close(); requestSignIn(); return; }
    if (!connection.configured) { $('#setup-dialog').close(); requestConnection(); return; }
    const request = $('#setup-description').value.trim();
    if (!request && !photo.image) { $('#setup-message').textContent = 'Add a photo or describe the event, people and shifts first.'; return; }
    setBusy(true, $('#draft-event-button')); $('#setup-message').textContent = photo.image ? 'Gemma is reading your photo and notes…' : 'Gemma is reading your event description…';
    try {
      result = await api(photo.image ? '/api/setup/photo' : '/api/setup/interpret', { request, ...(photo.image ? { image: photo.image } : {}) });
      onGemmaSuccess(); $('#setup-message').textContent = ''; $('#setup-resolved').checked = false; renderReview();
    } catch (error) { onGemmaError(error); $('#setup-message').textContent = error.message; }
    finally { setBusy(false); }
  });
  $('#setup-review-form').addEventListener('input', event => {
    $('#setup-save-message').textContent = '';
    if (!event.target.closest('#setup-assignments')) renderAssignments(readDraft());
    validateReview();
  });
  $('#setup-review-form').addEventListener('click', event => {
    const button = event.target.closest('.setup-remove, .setup-add');
    if (!button || context().busy) return;
    $('#setup-save-message').textContent = '';
    const draft = readDraft();
    if (button.classList.contains('setup-remove')) {
      const index = Number(button.dataset.index), key = button.dataset.kind === 'volunteers' ? 'volunteerIndex' : 'shiftIndex';
      draft[button.dataset.kind].splice(index, 1);
      draft.assignments = draft.assignments.filter(a => a[key] !== index).map(a => ({ ...a, [key]: a[key] > index ? a[key] - 1 : a[key] }));
    }
    else if (button.id === 'setup-add-person' && draft.volunteers.length < 12) draft.volunteers.push({ name: null, skills: null, availability: null, maxHours: null });
    else if (button.id === 'setup-add-shift' && draft.shifts.length < 8) draft.shifts.push({ station: null, start: null, end: null, required: null, skills: null });
    result.draft = draft; renderReview();
  });
  $('#setup-review-form').addEventListener('submit', async event => {
    event.preventDefault(); if (context().busy || !result) return;
    const message = $('#setup-save-message');
    if (!validateReview()) { message.textContent = 'Finish the missing or invalid details above. No event has been saved.'; return; }
    if (result.questions.length && !$('#setup-resolved').checked) { message.textContent = 'Resolve Gemma’s questions in the draft and confirm the checkbox before continuing.'; return; }
    const draft = readDraft();
    try { compileSetupDraft(draft); } catch (error) { message.textContent = error.message; return; }
    setBusy(true, $('#confirm-setup')); message.textContent = 'Saving your reviewed event…';
    let saved;
    try { saved = await api('/api/setup/create', { draft }); }
    catch (error) { message.textContent = error.message; }
    finally { setBusy(false); }
    if (!saved) return;
    result = null; $('#setup-review').classList.add('hidden'); $('#setup-dialog').close();
    message.textContent = '';
    photo.clear(false); $('#setup-description').value = ''; try { sessionStorage.removeItem(storageKey()); } catch {}
    await onCreated(saved);
  });
  return { open, refresh, clear() { photo.clear(false); owner = null; result = null; $('#setup-description').value = ''; $('#setup-review').classList.add('hidden'); } };
}
