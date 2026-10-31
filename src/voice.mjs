import { MAX_VOLUNTEERS, MAX_SHIFTS } from './limits.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { quotaDetails, GemmaQuotaError } from './quota.mjs';

export const voiceModel = 'gemini-3.5-transcribe';
export const maxAudioBytes = 1024 * 1024;
const languages = new Set(['auto', 'en-US', 'bn-BD']);
const mimeTypes = new Map([['audio/webm', 'audio/webm'], ['audio/ogg', 'audio/ogg'], ['audio/mp4', 'audio/m4a'], ['audio/wav', 'audio/wav']]);

export function validateVoiceInput(input) {
  const mimeType = mimeTypes.get(String(input.mimeType || '').split(';')[0].trim().toLowerCase());
  if (!mimeType) throw new Error('Use a WebM, Ogg, MP4 or WAV audio recording.');
  if (!languages.has(input.language)) throw new Error('Choose English, Bengali or automatic language detection.');
  if (typeof input.audio !== 'string' || input.audio.length > Math.ceil(maxAudioBytes / 3) * 4 || input.audio.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.audio)) throw new Error('The voice recording is invalid or too large. Record a shorter message.');
  const bytes = Buffer.from(input.audio, 'base64');
  if (bytes.length < 44 || bytes.length > maxAudioBytes || bytes.toString('base64') !== input.audio) throw new Error('The voice recording is empty, invalid or too large. Please record again.');
  return { audio: input.audio, mimeType, language: input.language };
}

export async function transcribeVoice({ key }, input, vocabulary = []) {
  const { audio, mimeType, language } = validateVoiceInput(input);
  if (!key || key === 'your_google_ai_studio_key_here') throw new Error('Connect your Google AI Studio key before using voice input. You can still type your request.');
  const terms = [...new Set(vocabulary.filter(term => typeof term === 'string' && term.trim() && term.length <= 80))].slice(0, MAX_VOLUNTEERS * 2 + MAX_SHIFTS * 2);
  const signal = AbortSignal.timeout(45000);
  const body = JSON.stringify({ model: voiceModel, store: false, input: [{ type: 'audio', data: audio, mime_type: mimeType }], generation_config: { transcription_config: { language_codes: language === 'auto' ? [] : [language], ...(terms.length ? { custom_vocabulary: terms } : {}) } } });
  const timeout = () => Object.assign(new Error('Voice transcription took too long. Your text and saved schedule are unchanged; please try again.'), { status: 504 });
  let payload;
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body, signal });
      payload = await response.json().catch(error => { if (signal.aborted) throw error; return {}; });
    } catch (error) {
      if (signal.aborted || ['AbortError', 'TimeoutError'].includes(error.name)) throw timeout();
      if (attempt === 2) throw Object.assign(new Error('Could not reach the speech service. Your text and saved schedule are unchanged; please retry or type your request.'), { status: 503 });
    }
    if (response?.ok) break;
    if (response?.status === 429) throw new GemmaQuotaError(quotaDetails(payload, response.headers));
    if (response && ![408, 500, 502, 503, 504].includes(response.status)) throw Object.assign(new Error(`Speech transcription failed (HTTP ${response.status}). Check Google model access, or type your request. Your schedule is unchanged.`), { status: response.status === 401 || response.status === 403 ? 503 : 400 });
    if (attempt === 2) throw Object.assign(new Error('The speech service is temporarily unavailable. Please retry or type your request. Your schedule is unchanged.'), { status: 503 });
    try { await delay(500 * 2 ** attempt, undefined, { signal }); } catch { throw timeout(); }
  }
  if (payload.status !== 'completed') throw new Error('The speech service did not finish the transcript. Please record again or type your request.');
  const transcript = (payload.steps || []).filter(step => step.type === 'model_output').flatMap(step => step.content || []).filter(part => part.type === 'text').map(part => part.text || '').join(' ').trim();
  if (!transcript) throw new Error('No speech was recognized. Please record again or type your request.');
  if (transcript.length > 8000) throw new Error('The transcript is too long. Record a shorter message.');
  return { transcript, language, model: voiceModel };
}
