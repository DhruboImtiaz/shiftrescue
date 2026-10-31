const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const roleLabel = role => role === 'editor' ? 'Edit' : 'View';

export function initCollaboration({ api, context, setBusy, onChanged, onOpen, notify }) {
  let sharing = null, loading = false, generation = 0, requestSnapshot = '';
  let expandedProfiles = new Set();
  function render() {
    const { auth, currentEvent, busy } = context();
    $('#join-event').classList.toggle('hidden', !auth.user);
    $('#share-event').classList.toggle('hidden', currentEvent?.role !== 'owner');
    $('#join-event').disabled = busy;
    $('#share-event').disabled = busy;
    $('#share-code').value = sharing?.code?.match(/.{1,4}/g)?.join('-') || '';
    $('#sharing-controls').disabled = busy || loading;
    $('#copy-event-code').disabled = busy || loading || !sharing;
    $('#reset-event-code').disabled = busy || loading || !sharing;
  }
  function personCard(p, pending) {
    const id = sharing.eventId;
    const photo = p.hasAvatar ? `<img src="/api/events/${escape(id)}/people/${escape(p.userId)}/avatar?v=${encodeURIComponent(p.profileUpdatedAt)}" alt="${escape(p.name || p.username || 'Member')}'s profile photo" loading="lazy">` : '';
    return `<article class="sharing-person"><div class="sharing-person-heading"><span class="sharing-avatar"><span aria-hidden="true">${escape((p.name || p.username || '?').slice(0, 1).toUpperCase())}</span>${photo}</span><div><strong>${escape(p.name || p.username || 'Coordinator')}</strong><small>${p.username ? `@${escape(p.username)}` : 'Username not added'}</small><span class="badge neutral">${pending ? `Requests ${roleLabel(p.requestedRole).toLowerCase()} access` : `${roleLabel(p.role)} access`}</span></div></div><details data-profile="${escape(p.userId)}" ${expandedProfiles.has(p.userId) ? 'open' : ''}><summary>View profile</summary><p class="sharing-bio">${escape(p.bio || 'No bio added.')}</p></details><div class="sharing-person-actions">${pending ? `<button type="button" class="button subtle small" data-person="${escape(p.userId)}" data-decision="viewer">Give view access</button><button type="button" class="button primary small" data-person="${escape(p.userId)}" data-decision="editor">Give edit access</button><button type="button" class="button subtle small danger" data-person="${escape(p.userId)}" data-decision="reject">Reject</button>` : `<label>Access<select data-person="${escape(p.userId)}" aria-label="Access for ${escape(p.name || p.username || 'member')}"><option value="viewer" ${p.role === 'viewer' ? 'selected' : ''}>View</option><option value="editor" ${p.role === 'editor' ? 'selected' : ''}>Edit</option></select></label><button type="button" class="button subtle small danger" data-person="${escape(p.userId)}" data-decision="remove">Remove access</button>`}</div></article>`;
  }
  function renderSharing() {
    expandedProfiles = new Set([...document.querySelectorAll('#sharing-controls details[open]')].map(el => el.dataset.profile));
    $('#share-requests').innerHTML = sharing.requests.map(p => personCard(p, true)).join('') || '<p class="fine-print">No pending requests.</p>';
    $('#share-members').innerHTML = sharing.members.map(p => personCard(p, false)).join('') || '<p class="fine-print">You are the only person with access.</p>';
    $('#share-request-count').textContent = sharing.requests.length;
    document.querySelectorAll('.sharing-avatar img').forEach(img => img.addEventListener('error', () => img.remove(), { once: true }));
    render();
  }
  async function loadSharing() {
    const id = context().currentEvent?.id, ticket = ++generation;
    if (!id) return;
    loading = true; render();
    try {
      const result = await api(`/api/events/${id}/sharing`);
      if (ticket !== generation || context().currentEvent?.id !== id) return;
      if (JSON.stringify(sharing) !== JSON.stringify(result)) { sharing = result; renderSharing(); }
    } finally { if (ticket === generation) { loading = false; render(); } }
  }
  async function loadRequests() {
    const userId = context().auth.user?.id;
    const { requests } = await api('/api/access/requests');
    if (context().auth.user?.id !== userId || !$('#join-dialog').open) return;
    const snapshot = JSON.stringify(requests); if (requestSnapshot === snapshot) return; requestSnapshot = snapshot;
    $('#my-access-requests').innerHTML = requests.map(r => `<div class="access-request-status"><div><strong>${escape(r.event)}</strong><small>${r.status === 'pending' ? `${roleLabel(r.requestedRole)} access requested · Pending approval` : r.status === 'approved' ? `${roleLabel(r.grantedRole)} access approved` : r.status === 'rejected' ? 'Request declined' : 'Access removed'}${r.status !== 'approved' && r.role === 'viewer' ? ' · You still have view access' : ''}</small></div>${['owner', 'editor', 'viewer'].includes(r.role) ? `<button type="button" class="button subtle small" data-open-event="${escape(r.eventId)}">Open event</button>` : ''}</div>`).join('') || '<p class="fine-print">Your access requests will appear here.</p>';
  }
  $('#share-event').addEventListener('click', async () => {
    sharing = null; requestSnapshot = ''; $('#share-requests').replaceChildren(); $('#share-members').replaceChildren();
    $('#share-message').textContent = 'Loading sharing…'; $('#share-dialog').showModal();
    try { await loadSharing(); $('#share-message').textContent = ''; } catch (error) { $('#share-message').textContent = error.message; }
  });
  $('#share-refresh').addEventListener('click', async () => {
    try { await loadSharing(); $('#share-message').textContent = ''; } catch (error) { $('#share-message').textContent = error.message; }
  });
  $('#copy-event-code').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#share-code').value); $('#share-message').textContent = 'Code copied. Send it to someone you want to invite.'; }
    catch { $('#share-code').select(); $('#share-message').textContent = 'Select and copy the event code above.'; }
  });
  async function changeAccess(input) {
    if (context().busy || !sharing || context().currentEvent?.id !== sharing.eventId) return;
    const id = sharing.eventId;
    setBusy(true); $('#share-message').textContent = 'Updating sharing…';
    let saved = false;
    try {
      sharing = await api(`/api/events/${id}/sharing`, input); saved = true; renderSharing();
      await onChanged(id);
      $('#share-message').textContent = input.action === 'rotate' ? 'New code ready. The old code no longer accepts requests. Existing access is unchanged.' : 'Access updated.';
    } catch (error) { $('#share-message').textContent = `${saved ? 'Sharing was updated, but the workspace could not refresh. ' : ''}${error.message}`; }
    finally { setBusy(false); }
  }
  $('#reset-event-code').addEventListener('click', () => { if (confirm('Reset this event code? Previous codes will stop accepting requests. Existing members keep their access.')) changeAccess({ action: 'rotate' }); });
  $('#sharing-controls').addEventListener('click', event => {
    const button = event.target.closest('[data-decision]'); if (!button) return;
    if (button.dataset.decision === 'remove' && !confirm('Remove this person’s access to the event?')) return;
    changeAccess({ userId: button.dataset.person, decision: button.dataset.decision });
  });
  $('#sharing-controls').addEventListener('change', event => {
    if (event.target.matches('select[data-person]')) changeAccess({ userId: event.target.dataset.person, decision: event.target.value });
  });
  $('#join-event').addEventListener('click', async () => {
    $('#join-message').textContent = ''; $('#join-dialog').showModal();
    try { await loadRequests(); } catch (error) { $('#join-message').textContent = error.message; }
  });
  $('#join-form').addEventListener('submit', async event => {
    event.preventDefault(); if (context().busy) return;
    setBusy(true); $('#join-fields').disabled = true;
    try {
      const result = await api('/api/access/request', { code: $('#join-code').value.trim(), role: $('#join-role').value });
      $('#join-message').textContent = result.message; await loadRequests();
      if (result.role) await onChanged();
    } catch (error) { $('#join-message').textContent = error.message; }
    finally { setBusy(false); $('#join-fields').disabled = false; }
  });
  $('#my-access-requests').addEventListener('click', async event => {
    const button = event.target.closest('[data-open-event]'); if (!button || context().busy) return;
    try { await onOpen(button.dataset.openEvent); $('#join-dialog').close(); } catch (error) { $('#join-message').textContent = error.message; }
  });
  return { render, async refresh() {
    if (!context().auth.user || context().busy || loading) return;
    try {
      if ($('#share-dialog').open && document.activeElement?.tagName !== 'SELECT') await loadSharing();
      if ($('#join-dialog').open) await loadRequests();
    } catch (error) { ($('#share-dialog').open ? $('#share-message') : $('#join-message')).textContent = error.message; }
  }, reset() { generation++; sharing = null; loading = false; requestSnapshot = ''; expandedProfiles.clear(); $('#my-access-requests').replaceChildren(); $('#share-requests').replaceChildren(); $('#share-members').replaceChildren(); $('#join-code').value = ''; $('#join-message').textContent = ''; $('#share-message').textContent = ''; $('#share-dialog').close(); $('#join-dialog').close(); render(); } };
}
