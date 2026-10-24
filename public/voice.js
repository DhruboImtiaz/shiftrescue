const maxAudioBytes = 1024 * 1024;
const formats = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/wav'];
const micIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';

// A recording only appends editable text. Interpreting, previewing and saving
// remain separate coordinator actions.
export function initVoiceInputs({ api, context, setBusy, requestSignIn, requestConnection }) {
  const supported = !!(globalThis.isSecureContext && navigator.mediaDevices?.getUserMedia && globalThis.MediaRecorder);
  const mimeType = supported ? formats.find(type => MediaRecorder.isTypeSupported(type)) : null;
  let active = null;
  const widgets = ['request-input', 'setup-description'].map(id => {
    const input = document.getElementById(id), panel = document.createElement('div');
    panel.className = 'voice-input';
    panel.innerHTML = `<div class="voice-controls"><button type="button" class="button subtle small voice-record" aria-pressed="false">${micIcon}<span>Tap to talk</span></button><label class="sr-only" for="${id}-voice-language">Voice language</label><select id="${id}-voice-language" aria-label="${id === 'request-input' ? 'Request' : 'Event brief'} voice language"><option value="auto">Auto detect</option><option value="en-US">English</option><option value="bn-BD">বাংলা (বাংলাদেশ)</option></select><button type="button" class="button subtle small voice-cancel hidden">Cancel recording</button></div><p class="voice-help">English or বাংলা · up to 30 seconds. When you stop, audio is sent to Google for transcription. Review the text before sending it to Gemma.</p><p class="voice-status" role="status" aria-live="polite"></p><div class="voice-overflow hidden"></div>`;
    input.after(panel);
    const widget = { input, panel, button: panel.querySelector('.voice-record'), language: panel.querySelector('select'), cancel: panel.querySelector('.voice-cancel'), status: panel.querySelector('.voice-status'), overflow: panel.querySelector('.voice-overflow') };
    widget.button.addEventListener('click', () => {
      if (active?.widget === widget && active.phase === 'recording') stop(active);
      else start(widget);
    });
    widget.cancel.addEventListener('click', cancel);
    input.closest('dialog')?.addEventListener('close', () => { if (active?.widget === widget) cancel(); });
    return widget;
  });
  function refresh() {
    for (const widget of widgets) {
      const own = active?.widget === widget, recording = own && active.phase === 'recording';
      widget.button.disabled = !mimeType || (!!context().busy && !recording);
      widget.button.setAttribute('aria-pressed', String(recording));
      widget.button.classList.toggle('recording', recording);
      widget.button.querySelector('span').textContent = recording ? 'Stop & transcribe' : own ? active.phase === 'permission' ? 'Waiting for microphone…' : 'Transcribing…' : 'Tap to talk';
      widget.language.disabled = !!context().busy;
      widget.cancel.classList.toggle('hidden', !own);
      widget.cancel.textContent = own && active.phase === 'transcribing' ? 'Cancel transcription' : 'Cancel recording';
      if (!mimeType) widget.status.textContent = 'Voice recording is unavailable in this browser. Try a current Chrome or Safari browser, or type your request.';
    }
  }
  function release(job) {
    clearInterval(job.timer);
    job.stream?.getTracks().forEach(track => track.stop());
  }
  function finish(job, message) {
    release(job);
    if (active !== job) return;
    active = null; setBusy(false); job.widget.status.textContent = message; refresh();
  }
  function cancel() {
    const job = active; if (!job) return;
    active = null; job.controller.abort();
    if (job.recorder?.state === 'recording') job.recorder.stop();
    release(job); setBusy(false); job.widget.status.textContent = 'Recording cancelled. Your text is unchanged.'; refresh();
  }
  function stop(job) {
    if (active !== job || job.phase !== 'recording') return;
    job.phase = 'transcribing'; clearInterval(job.timer); job.recorder.stop();
    job.widget.status.textContent = 'Transcribing your recording… Your schedule has not changed.'; refresh();
  }
  async function complete(job) {
    release(job); if (active !== job) return;
    try {
      const blob = new Blob(job.chunks, { type: job.recorder.mimeType || mimeType });
      if (!blob.size || blob.size > maxAudioBytes) throw new Error('The recording is empty or too large. Please record a shorter message.');
      const audio = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('Could not read the recording. Please try again.')); reader.readAsDataURL(blob);
      });
      if (active !== job) return;
      const result = await api('/api/voice/transcribe', { audio, mimeType: blob.type, language: job.language, eventId: job.eventId }, { signal: job.controller.signal });
      if (active !== job) return;
      const text = job.widget.input.value.trimEnd(), next = text ? `${text}\n${result.transcript}` : result.transcript;
      if (next.length > job.widget.input.maxLength) {
        job.widget.overflow.textContent = result.transcript; job.widget.overflow.classList.remove('hidden');
        finish(job, 'This transcript will not fit in the text box. Your existing text is kept. Copy the part you need from the transcript below.'); return;
      }
      job.widget.input.value = next;
      job.widget.input.dispatchEvent(new Event('input', { bubbles: true }));
      finish(job, 'Transcript added. Check names and times, edit if needed, then send it to Gemma. Nothing has been saved.'); job.widget.input.focus();
    } catch (error) { if (active === job) finish(job, error.message || 'Could not transcribe the recording. Your text is unchanged.'); }
  }
  async function start(widget) {
    if (context().busy || !mimeType) return;
    const { auth, connection, eventId } = context();
    if (auth.configured && !auth.user) { requestSignIn(); return; }
    if (!connection.configured) { requestConnection(); return; }
    const job = { widget, phase: 'permission', language: widget.language.value, eventId: widget.input.id === 'request-input' ? eventId : undefined, controller: new AbortController(), chunks: [], bytes: 0 };
    active = job; widget.overflow.classList.add('hidden'); widget.overflow.textContent = ''; widget.status.textContent = 'Allow microphone access to record. You can cancel at any time.'; setBusy(true); refresh();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (active !== job) { stream.getTracks().forEach(track => track.stop()); return; }
      job.stream = stream;
      job.recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
      job.recorder.ondataavailable = event => {
        if (active !== job || !event.data.size) return;
        job.chunks.push(event.data); job.bytes += event.data.size;
        if (job.bytes > maxAudioBytes) { cancel(); widget.status.textContent = 'The recording became too large. Your text is unchanged. Try a shorter message.'; }
      };
      job.recorder.onstop = () => complete(job);
      job.recorder.onerror = () => { cancel(); widget.status.textContent = 'Recording failed. Please retry or type your request.'; };
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (active === job && job.phase === 'recording') { cancel(); widget.status.textContent = 'The microphone disconnected. Please record again.'; } }));
      job.recorder.start(250); job.phase = 'recording'; job.started = Date.now();
      const tick = () => {
        const seconds = Math.floor((Date.now() - job.started) / 1000);
        widget.status.textContent = `Recording ${seconds} / 30 seconds… Tap Stop & transcribe when finished.`;
        if (seconds >= 30) stop(job);
      };
      job.timer = setInterval(tick, 500); tick(); refresh();
    } catch (error) {
      if (active !== job) return;
      const message = error.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser’s site settings to use voice, or type your request.' : error.name === 'NotFoundError' ? 'No microphone was found. Connect one or type your request.' : 'The microphone could not start. Check your browser and microphone, or type your request.';
      finish(job, message);
    }
  }
  window.addEventListener('pagehide', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  refresh(); return { refresh, cancel };
}
