const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const concepts = ['product', 'people', 'mission'];
function showConcept(name, remember = true) {
  if (!concepts.includes(name)) name = 'product';
  $$('[data-page]').forEach(page => { page.hidden = page.dataset.page !== name; });
  $$('[data-concept]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.concept === name)));
  const labels = { product: 'Product-first', people: 'People-first', mission: 'Mission control' };
  document.title = `${labels[name]} — ShiftRescue landing page draft`;
  if (remember) {
    const url = new URL(location.href); url.searchParams.set('concept', name); url.hash = '';
    history.pushState(null, '', url); window.scrollTo(0, 0);
  }
}
$$('[data-concept]').forEach(button => button.addEventListener('click', () => showConcept(button.dataset.concept)));
window.addEventListener('popstate', () => showConcept(new URL(location.href).searchParams.get('concept'), false));
showConcept(new URL(location.href).searchParams.get('concept'), false);

let repaired = false;
$('[data-demo="product"]').addEventListener('click', () => {
  repaired = !repaired;
  $('[data-demo-slot]').classList.toggle('needs-cover', !repaired); $('[data-demo-slot]').classList.toggle('repaired', repaired);
  $('[data-demo-initial]').textContent = repaired ? 'A' : 'N';
  $('[data-demo-initial]').classList.toggle('sage', repaired); $('[data-demo-initial]').classList.toggle('rose', !repaired);
  $('[data-demo-name]').textContent = repaired ? 'Arif' : 'Nadia';
  $('[data-demo-detail]').textContent = repaired ? 'Available · first-aid trained' : 'Can’t make this shift';
  $('[data-demo-check]').textContent = repaired ? '✓' : '!';
  $('[data-demo-status]').textContent = repaired ? 'Replacement preview' : '1 change to review';
  $('[data-demo-status]').classList.toggle('repaired', repaired);
  $('[data-demo="product"]').innerHTML = repaired ? 'Replay the example <span aria-hidden="true">↺</span>' : 'Preview a replacement <span aria-hidden="true">↗</span>';
  $('[data-demo-result]').textContent = repaired ? 'Arif can cover this shift. The rest of the example stays the same.' : 'Your saved schedule stays unchanged until you approve.';
});
let missionPreview = false;
$('[data-demo="mission"]').addEventListener('click', () => {
  missionPreview = !missionPreview;
  $('[data-demo="mission"]').innerHTML = missionPreview ? 'Replay the example <span aria-hidden="true">↺</span>' : 'Preview this change <span aria-hidden="true">↗</span>';
  $('.mission-demo-result').textContent = missionPreview ? 'PREVIEW READY / Nadia → Arif. No other assignments changed. You decide whether to save.' : 'An example, not a saved event.';
});

// Reuse the existing same-origin account API. These drafts keep the marketing
// page behind the dialog; an authenticated user continues to the workspace.
let mode = 'signin', submitting = false, account = null;
const dialog = $('#landing-auth');
function setMode(next) {
  if (submitting) return;
  mode = next === 'signup' ? 'signup' : 'signin';
  const signup = mode === 'signup';
  $('#landing-signup-fields').hidden = !signup;
  $$('#landing-signup-fields input').forEach(input => { input.disabled = !signup; input.required = signup; });
  $$('[data-auth-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.authMode === mode)));
  $('#landing-auth-title').textContent = signup ? 'Make it your next good day.' : 'Welcome back.';
  $('.auth-intro').textContent = signup ? 'Create an account to start planning your event.' : 'Sign in to open your volunteer workspace.';
  $('#landing-password').autocomplete = signup ? 'new-password' : 'current-password';
  $('#landing-password').value = '';
  $('#landing-auth-submit').textContent = signup ? 'Create your account ↗' : 'Sign in to your workspace ↗';
  $('#landing-auth-message').textContent = '';
  $('#landing-auth-message').classList.remove('success');
}
$$('[data-auth-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.authMode)));
fetch('/api/auth/session', { cache: 'no-store', signal: AbortSignal.timeout(5000) }).then(async response => {
  if (!response.ok) return;
  account = (await response.json()).user || null;
  if (account) $$('[data-auth="signin"]').forEach(button => { button.innerHTML = 'Open workspace <span aria-hidden="true">↗</span>'; });
}).catch(() => {});
$$('[data-auth]').forEach(button => button.addEventListener('click', () => {
  if (account) { location.assign('/'); return; }
  setMode(button.dataset.auth); dialog.showModal();
  (mode === 'signup' ? $('#landing-name') : $('#landing-email')).focus();
}));
$('#landing-auth-close').addEventListener('click', () => { if (!submitting) dialog.close(); });
dialog.addEventListener('cancel', event => { if (submitting) event.preventDefault(); });
dialog.addEventListener('close', () => { $('#landing-password').value = ''; });
$('#landing-auth-form').addEventListener('submit', async event => {
  event.preventDefault(); if (submitting) return;
  const data = { email: $('#landing-email').value.trim(), password: $('#landing-password').value };
  if (mode === 'signup') Object.assign(data, { name: $('#landing-name').value, username: $('#landing-username').value, phone: $('#landing-phone').value });
  const requestMode = mode;
  submitting = true; $('#landing-auth-fields').disabled = true; $('#landing-auth-close').disabled = true;
  $$('[data-auth-mode]').forEach(button => { button.disabled = true; });
  $('#landing-auth-message').textContent = mode === 'signup' ? 'Creating your account…' : 'Opening your workspace…';
  $('#landing-auth-message').classList.remove('success');
  $('#landing-password').value = '';
  try {
    const response = await fetch(`/api/auth/${requestMode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not reach your account. Please try again.');
    if (result.confirmationRequired) {
      submitting = false; setMode('signin');
      $('#landing-auth-message').textContent = result.message || 'Check your email to confirm your account, then sign in here.';
      $('#landing-auth-message').classList.add('success');
      $$('#landing-signup-fields input').forEach(input => { input.value = ''; });
    } else if (result.user) { location.assign('/'); }
    else throw new Error('Could not verify your account. Please try signing in again.');
  } catch (error) { $('#landing-auth-message').textContent = error.message === 'Failed to fetch' ? 'Could not connect. Check your connection and try again.' : error.message; }
  finally {
    submitting = false; $('#landing-auth-fields').disabled = false; $('#landing-auth-close').disabled = false;
    $$('[data-auth-mode]').forEach(button => { button.disabled = false; });
  }
});
