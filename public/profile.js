export function initProfile({ api, getUser, onEmailChanged }) {
  const $ = selector => document.querySelector(selector);
  let profile = null, image, saving = false, processing = false, generation = 0;
  const fields = ['name', 'username', 'phone', 'bio'];
  const message = (text, success = false) => { $('#profile-message').textContent = text; $('#profile-message').classList.toggle('success', success); };
  function paintAvatar(url) {
    const photo = $('#profile-photo');
    photo.classList.toggle('hidden', !url);
    $('#profile-initials').classList.toggle('hidden', !!url);
    if (url) photo.src = url; else photo.removeAttribute('src');
    $('#profile-initials').textContent = (profile?.name || getUser()?.email || '?').trim().slice(0, 1).toUpperCase();
  }
  function display() {
    $('#profile-name-label').textContent = profile.name || 'Complete your profile';
    $('#profile-username-label').textContent = profile.username ? `@${profile.username}` : 'Choose your username';
    $('#profile-bio-label').textContent = profile.bio || 'No bio yet.';
    $('#profile-phone-label').textContent = profile.phone || 'Add your phone number';
    $('#profile-email-label').textContent = getUser()?.email || profile.email;
    $('#profile-new-email').value = getUser()?.email || profile.email;
    paintAvatar(profile.avatarUrl);
  }
  function edit(value) {
    generation++; image = undefined; processing = false;
    $('#profile-edit').classList.toggle('hidden', !value);
    $('#profile-view').classList.toggle('hidden', value);
    $('#profile-email-form').classList.toggle('hidden', !value);
    $('#profile-email-message').textContent = '';
    $('#profile-photo-actions').classList.toggle('hidden', !value);
    if (profile) { fields.forEach(key => { $(`#profile-${key}`).value = profile[key]; }); display(); }
    $('#profile-photo-file').value = '';
    $('#profile-bio-count').textContent = `${$('#profile-bio').value.length} / 160`;
    message(''); disable(false);
    if (value) $('#profile-name').focus();
  }
  function reset() {
    generation++; profile = null; image = undefined; processing = false;
    fields.forEach(key => { $(`#profile-${key}`).value = ''; });
    $('#profile-new-email').value = '';
    ['#profile-name-label', '#profile-username-label', '#profile-bio-label', '#profile-phone-label', '#profile-email-label', '#profile-email-message'].forEach(id => { $(id).textContent = ''; });
    $('#profile-content').classList.add('hidden');
    $('#profile-photo-file').value = ''; paintAvatar(null); message('');
  }
  async function open() {
    if (saving) return;
    reset(); const version = generation, userId = getUser()?.id;
    $('#profile-retry').classList.add('hidden'); message('Opening your profile…');
    try {
      const result = await api('/api/profile');
      if (generation !== version || getUser()?.id !== userId) return;
      profile = result.profile; $('#profile-content').classList.remove('hidden'); edit(false);
    } catch (error) {
      if (generation !== version) return;
      message(error.message); $('#profile-retry').classList.remove('hidden');
    }
  }
  function disable(external) {
    const locked = external || saving || processing;
    $('#profile-fields').disabled = locked;
    $('#profile-email-fields').disabled = locked;
    ['#profile-upload', '#profile-remove', '#profile-edit-button', '#profile-cancel', '#profile-retry', '#signout-button'].forEach(id => { $(id).disabled = locked; });
    $('#profile-remove').disabled = locked || !(image === undefined ? profile?.avatarUrl : image);
    if (saving || processing) $('#auth-dialog .close-dialog').disabled = true;
    else $('#auth-dialog .close-dialog').disabled = false;
  }
  $('#profile-edit-button').addEventListener('click', () => edit(true));
  $('#profile-cancel').addEventListener('click', () => edit(false));
  $('#profile-retry').addEventListener('click', open);
  $('#profile-bio').addEventListener('input', () => { $('#profile-bio-count').textContent = `${$('#profile-bio').value.length} / 160`; });
  $('#profile-upload').addEventListener('click', () => $('#profile-photo-file').click());
  $('#profile-photo-file').addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file || saving || processing) return;
    const version = ++generation; processing = true; disable(false); message('Preparing your photo…');
    let bitmap;
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) throw new Error('Choose a JPG, PNG or WebP photo up to 20 MB.');
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000) throw new Error('This photo is too large. Crop it and try again.');
      const size = Math.min(bitmap.width, bitmap.height), canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.min(512, size);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser could not prepare your photo.');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', 0.88);
      if (version !== generation) return;
      image = { mimeType: 'image/jpeg', data: url.split(',')[1] }; paintAvatar(url);
      message('Photo ready. Save changes to use it.', true);
    } catch (error) {
      if (version === generation) message(error.message.startsWith('Choose ') || error.message.startsWith('This ') ? error.message : 'This photo could not be read. Choose another image.');
    } finally {
      bitmap?.close();
      if (version === generation) { processing = false; event.target.value = ''; disable(false); }
    }
  });
  $('#profile-remove').addEventListener('click', () => { image = null; paintAvatar(null); disable(false); message('Save changes to remove your photo.'); });
  $('#profile-form').addEventListener('submit', async event => {
    event.preventDefault(); if (saving || processing || !profile) return;
    saving = true; disable(false); message('Saving your profile…');
    try {
      const input = Object.fromEntries(fields.map(key => [key, $(`#profile-${key}`).value]));
      if (image !== undefined) input.image = image;
      const result = await api('/api/profile', input); profile = result.profile; edit(false); message('Profile saved.', true);
    } catch (error) { message(error.message); }
    finally { saving = false; disable(false); }
  });
  $('#profile-email-form').addEventListener('submit', async event => {
    event.preventDefault(); if (saving || processing) return;
    const email = $('#profile-new-email').value.trim();
    if (email === getUser()?.email) { $('#profile-email-message').textContent = 'This is already your account email.'; return; }
    saving = true; disable(false); $('#profile-email-message').textContent = 'Requesting email change…';
    try {
      const result = await api('/api/profile/email', { email });
      onEmailChanged(result.user); display(); $('#profile-email-message').textContent = result.message;
    } catch (error) { $('#profile-email-message').textContent = error.message; }
    finally { saving = false; disable(false); }
  });
  $('#auth-dialog').addEventListener('cancel', event => { if (saving || processing) event.preventDefault(); });
  $('#auth-dialog').addEventListener('close', () => { if (profile) edit(false); else generation++; });
  $('#profile-photo').addEventListener('error', () => paintAvatar(null));
  return { open, reset, disable };
}
