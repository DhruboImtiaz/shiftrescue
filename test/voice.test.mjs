import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.mjs';
import { maxAudioBytes, transcribeVoice, validateVoiceInput, voiceModel } from '../src/voice.mjs';

const key = 'private-voice-test-key';
const audio = Buffer.alloc(100, 1).toString('base64');
const input = (language = 'en-US') => ({ audio, mimeType: 'audio/webm;codecs=opus', language });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const answer = text => json({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text }] }] });

test('English, Bengali and automatic language detection preserve an editable transcript', async t => {
  const cases = [['en-US', 'Assign Nadia to Registration.'], ['bn-BD', 'নাদিয়াকে রেজিস্ট্রেশনে দাও।'], ['auto', 'নাদিয়া will work on Registration.']];
  let selected;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    selected = JSON.parse(options.body);
    assert.equal(selected.store, false); assert.equal(selected.model, voiceModel);
    assert.equal(options.headers['x-goog-api-key'], key);
    assert.equal(selected.input[0].data, audio); assert.equal(selected.input[0].mime_type, 'audio/webm');
    return answer(cases.find(([language]) => JSON.stringify(selected.generation_config.transcription_config.language_codes) === JSON.stringify(language === 'auto' ? [] : [language]))[1]);
  });
  for (const [language, transcript] of cases) {
    const result = await transcribeVoice({ key }, input(language));
    assert.deepEqual(result, { transcript, language, model: voiceModel });
  }
});

test('Safari MP4 recordings are normalized to the provider audio format', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(JSON.parse(options.body).input[0].mime_type, 'audio/m4a'); return answer('A transcript.');
  });
  assert.equal((await transcribeVoice({ key }, { ...input(), mimeType: 'audio/mp4;codecs=mp4a.40.2' })).transcript, 'A transcript.');
});

test('invalid languages, encodings and audio types fail before a provider request', async t => {
  t.mock.method(globalThis, 'fetch', () => { assert.fail('Must not call the provider'); });
  for (const invalid of [{ language: 'unknown' }, { audio: '' }, { audio: 'not audio!' }, { mimeType: 'text/html' }, { audio: 'A'.repeat(136) + '=' }]) {
    await assert.rejects(transcribeVoice({ key }, { ...input(), ...invalid }));
  }
  assert.throws(() => validateVoiceInput({ ...input(), audio: Buffer.alloc(maxAudioBytes + 1).toString('base64') }), /too large/);
});

test('no speech or incomplete responses never create a transcript to submit', async t => {
  const responses = [answer(''), json({ status: 'failed', steps: [] })];
  t.mock.method(globalThis, 'fetch', async () => responses.shift());
  await assert.rejects(transcribeVoice({ key }, input()), /No speech/);
  await assert.rejects(transcribeVoice({ key }, input()), /did not finish/);
});

test('provider quota errors are not retried', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return json({ error: { message: 'Quota reached', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '30s' }] } }, 429); });
  await assert.rejects(transcribeVoice({ key }, input()), error => error.status === 429 && !!error.quota);
  assert.equal(calls, 1);
});

test('temporary speech service errors recover within the same deadline', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => { calls.push(options); return calls.length === 1 ? json({}, 503) : answer('Recovered.'); });
  assert.equal((await transcribeVoice({ key }, input())).transcript, 'Recovered.');
  assert.equal(calls.length, 2); assert.equal(calls[0].signal, calls[1].signal); assert.equal(calls[0].body, calls[1].body);
});

test('provider failures and timeouts never expose credentials', async t => {
  t.mock.method(globalThis, 'fetch', async () => json({ error: { message: key } }, 403));
  await assert.rejects(transcribeVoice({ key }, input()), error => !error.message.includes(key) && error.status === 503);
  t.mock.method(globalThis, 'fetch', async () => { throw new DOMException(key, 'TimeoutError'); });
  await assert.rejects(transcribeVoice({ key }, input()), error => !error.message.includes(key) && error.status === 504);
});

const eventId = '11111111-1111-4111-8111-111111111111';
const env = { NETLIFY: 'true', GEMINI_API_KEY: key, SUPABASE_URL: 'https://voice-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key' };
const request = (data, headers = {}) => new Request('https://shiftrescue.netlify.app/api/voice/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });

test('hosted voice input requires sign-in before sending audio to Google', async t => {
  t.mock.method(globalThis, 'fetch', () => { assert.fail('An unauthenticated recording must not leave the server'); });
  const response = await createApi(env)(request(input()));
  assert.equal(response.status, 401);
});

test('transcription uses only the owned event vocabulary and never saves assignments', async t => {
  let providerCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(typeof url === 'string' ? url : url.url).pathname;
    if (path === '/auth/v1/user') return json({ id: 'owner', email: 'owner@example.test', is_anonymous: false });
    if (path.endsWith('/shiftrescue_load_event')) return json({ id: eventId, version: 1, state: { event: 'Voice test', date: '2026-10-24', timezone: 'Asia/Dhaka', volunteers: [{ id: 'nadia', name: 'Nadia', skills: [], availability: [[600, 720]], maxHours: 2 }], shifts: [{ id: 'reg-10', station: 'Registration', start: 600, end: 720, required: 1, skills: [] }], schedule: { 'reg-10': [] }, history: [] } });
    if (path.endsWith('/interactions')) {
      providerCalls++; assert.deepEqual(JSON.parse(options.body).generation_config.transcription_config.custom_vocabulary, ['Nadia', 'nadia', 'Registration', 'reg-10']);
      return answer('Assign Nadia to Registration.');
    }
    assert.fail(`Unexpected call or save: ${path}`);
  });
  const response = await createApi(env)(request({ ...input(), eventId, vocabulary: ['ignored-client-term'] }, { cookie: 'sr_access=test-access' }));
  assert.equal(response.status, 200); assert.equal((await response.json()).transcript, 'Assign Nadia to Registration.'); assert.equal(providerCalls, 1);
});

test('an inaccessible event never supplies private vocabulary to the speech service', async t => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    const path = new URL(typeof url === 'string' ? url : url.url).pathname;
    if (path === '/auth/v1/user') return json({ id: 'owner', email: 'owner@example.test', is_anonymous: false });
    if (path.endsWith('/shiftrescue_load_event')) return json(null);
    assert.fail('Must not call the provider for an inaccessible event');
  });
  const response = await createApi(env)(request({ ...input(), eventId }, { cookie: 'sr_access=test-access' }));
  assert.equal(response.status, 404);
});

test('a new event brief can be transcribed without loading an existing event', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(typeof url === 'string' ? url : url.url).pathname;
    if (path === '/auth/v1/user') return json({ id: 'owner', email: 'owner@example.test', is_anonymous: false });
    if (path.endsWith('/interactions')) {
      assert.equal(JSON.parse(options.body).generation_config.transcription_config.custom_vocabulary, undefined);
      return answer('A new event brief.');
    }
    assert.fail('A new brief must not load or save an existing event');
  });
  const response = await createApi(env)(request(input('bn-BD'), { cookie: 'sr_access=test-access' }));
  assert.equal(response.status, 200); assert.equal((await response.json()).transcript, 'A new event brief.');
});

test('the larger voice limit does not weaken cross-site or body-size protections', async t => {
  t.mock.method(globalThis, 'fetch', () => { assert.fail('Must reject before network access'); });
  assert.equal((await createApi(env)(request(input(), { origin: 'https://other.example' }))).status, 403);
  assert.equal((await createApi(env)(request(input(), { 'content-length': '1450001' }))).status, 413);
  const oversized = request({ ...input(), audio: 'A'.repeat(1450001) });
  assert.equal((await createApi(env)(oversized)).status, 413);
});
