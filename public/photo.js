// Photos stay in memory until the coordinator explicitly asks for a draft.
export function initPhotoInput({ onChange, onState }) {
  const $ = selector => document.querySelector(selector);
  let image = null, processing = false, generation = 0;
  const inputs = ['#setup-photo-file', '#setup-photo-camera'].map($);
  function clear(notify = true) {
    generation++; image = null; processing = false;
    inputs.forEach(input => { input.value = ''; });
    $('#setup-photo-preview').classList.add('hidden'); $('#setup-photo-image').removeAttribute('src');
    $('#setup-photo-name').textContent = ''; $('#setup-photo-message').textContent = '';
    $('#setup-photo-message').classList.remove('success');
    if (notify) onChange();
  }
  async function choose(file) {
    if (!file) return;
    clear(false); const version = generation; processing = true; onChange(); onState();
    $('#setup-photo-message').textContent = 'Preparing your photo…';
    let bitmap;
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG or WebP photo. Export HEIC photos as JPG first.');
      if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('Choose a photo smaller than 20 MB.');
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000) throw new Error('This photo is too large. Crop it to the roster and try again.');
      const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser could not prepare the photo. Try another browser or enter the details in text.');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let url;
      for (const quality of [0.92, 0.82, 0.7]) {
        url = canvas.toDataURL('image/jpeg', quality);
        if ((url.length - url.indexOf(',') - 1) * 3 / 4 <= 2 * 1024 * 1024) break;
      }
      const data = url.split(',')[1];
      if (!data || data.length * 3 / 4 > 2 * 1024 * 1024) throw new Error('Crop the photo to the roster or choose a smaller image.');
      if (version !== generation) return;
      image = { mimeType: 'image/jpeg', data };
      $('#setup-photo-image').src = url; $('#setup-photo-name').textContent = file.name || 'Camera photo';
      $('#setup-photo-preview').classList.remove('hidden');
      $('#setup-photo-message').textContent = 'Photo ready. Check that names and times are readable before creating the draft.';
      $('#setup-photo-message').classList.add('success');
    } catch (error) {
      if (version === generation) $('#setup-photo-message').textContent = error.message.startsWith('Choose ') || error.message.startsWith('Crop ') || error.message.startsWith('This ') ? error.message : 'This image could not be read. Choose another photo or enter the details in text.';
    } finally {
      bitmap?.close();
      if (version === generation) { processing = false; inputs.forEach(input => { input.value = ''; }); onState(); }
    }
  }
  $('#setup-upload-photo').addEventListener('click', () => inputs[0].click());
  $('#setup-take-photo').addEventListener('click', () => inputs[1].click());
  inputs.forEach(input => input.addEventListener('change', () => choose(input.files?.[0])));
  $('#setup-remove-photo').addEventListener('click', () => clear());
  return {
    get image() { return image; }, get processing() { return processing; }, clear,
    disable(busy) { [...inputs, $('#setup-upload-photo'), $('#setup-take-photo'), $('#setup-remove-photo')].forEach(el => { el.disabled = busy || processing; }); }
  };
}
