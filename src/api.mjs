import { demo, scenarios } from './demo.mjs';
import { editSchedule, checkSchedule, repairSchedule, retainValidAssignments, validateChanges, validateData } from './scheduler.mjs';
import { callGemma, interpretRequest, interpretEventSetup, validateModel } from './gemma.mjs';
import { compileSetupDraft } from './setup.mjs';
import { cloudService, AppError, safeUser, validateEventState } from './cloud.mjs';
import { proposalTokens } from './proposals.mjs';
import { transcribeVoice, validateVoiceInput } from './voice.mjs';

export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Cache-Control': 'no-store'
};
export function normalizeSetup(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Provide the event setup to save.');
  const next = structuredClone(input);
  validateData(next.volunteers, next.shifts, null, { allowEmpty: true });
  const ids = new Set(next.volunteers.map(p => p.id));
  next.schedule = Object.fromEntries(next.shifts.map(s => [s.id, [...new Set((next.schedule?.[s.id] || []).filter(id => ids.has(id)))].slice(0, s.required)]));
  next.schedule = retainValidAssignments(next.volunteers, next.shifts, next.schedule);
  validateEventState(next);
  return next;
}

// Both the local server and Netlify call this same Web Request/Response handler.
export function createApi(env = process.env, { saveConnection } = {}) {
  let config = { key: env.GEMINI_API_KEY || '', model: env.GEMMA_MODEL || 'gemma-4-26b-a4b-it' };
  let verified = false;
  const cloud = cloudService({ url: env.SUPABASE_URL, key: env.SUPABASE_PUBLISHABLE_KEY, secure: env.COOKIE_SECURE === 'true' || !!env.NETLIFY });
  const tokens = proposalTokens(env.PROPOSAL_SECRET);
  const hosted = !!env.NETLIFY;
  return async function handle(request) {
    const headers = new Headers({ ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' });
    const res = { setHeader(key, value) { headers.delete(key); for (const part of Array.isArray(value) ? value : [value]) headers.append(key, part); } };
    const req = { headers: Object.fromEntries(request.headers) };
    const send = (status, data) => new Response(JSON.stringify(data), { status, headers });
    try {
      const url = new URL(request.url), pathname = url.pathname;
      if (request.method === 'POST') {
        if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) throw new AppError('Requests must come from this app.', 403);
        if (request.headers.get('sec-fetch-site') === 'cross-site') throw new AppError('Cross-site requests are not allowed.', 403);
        if (!String(request.headers.get('content-type') || '').startsWith('application/json')) throw new AppError('Expected an application/json request.', 415);
        const bodyLimit = pathname === '/api/setup/photo' ? 2900000 : pathname === '/api/voice/transcribe' ? 1450000 : 80000;
        if (Number(request.headers.get('content-length')) > bodyLimit) throw new AppError('Request is too large.', 413);
        const reader = request.body?.getReader(); let size = 0; const chunks = [];
        if (reader) while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > bodyLimit) { await reader.cancel(); throw new AppError('Request is too large.', 413); } chunks.push(Buffer.from(chunk.value)); }
        let input; try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new AppError('Invalid JSON request.'); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Expected a JSON object.');
        if (pathname === '/api/voice/transcribe') {
          const active = cloud.configured || hosted ? await cloud.session(req, res, true) : null;
          validateVoiceInput(input);
          const stored = input.eventId ? await cloud.load(active, input.eventId) : null;
          const vocabulary = stored ? [...stored.state.volunteers.flatMap(p => [p.name, p.id]), ...stored.state.shifts.flatMap(s => [s.station, s.id])] : [];
          return send(200, await transcribeVoice(config, input, vocabulary));
        }
        if (pathname === '/api/auth/signin' || pathname === '/api/auth/signup') return send(200, await cloud.login(input, res, pathname.endsWith('/signup')));
        if (pathname === '/api/auth/signout') { await cloud.logout(req, res); return send(200, { signedOut: true }); }
        if (pathname === '/api/events') {
          const active = await cloud.session(req, res, true);
          const initial = input.state || { volunteers: [], shifts: [], schedule: {} };
          const state = normalizeSetup({ ...initial, event: String(input.name || '').trim(), date: input.date, timezone: 'Asia/Dhaka' });
          return send(201, await cloud.save(active, null, 0, state));
        }
        const action = pathname.match(/^\/api\/events\/([0-9a-f-]{36})\/(apply|setup)$/i);
        if (action) {
          const active = await cloud.session(req, res, true), id = action[1];
          if (action[2] === 'apply') {
            const proof = tokens.read(input.proposalId, active.user.id, id);
            const check = checkSchedule(proof.state.volunteers, proof.state.shifts, proof.state.schedule, { assignments: proof.assignments || [], allowPartial: proof.mode === 'incremental' });
            if (!check.valid) throw new AppError('The preview failed final validation.', 409);
            return send(200, await cloud.save(active, id, proof.version, proof.state, proof.activity));
          }
          await cloud.load(active, id);
          const state = normalizeSetup(input.state);
          return send(200, await cloud.save(active, id, input.expectedVersion, state, { kind: 'setup', title: 'Event setup updated', text: 'Volunteer, shift or event settings changed. Unaffected assignments were kept; any invalid placements became open places.', source: 'team', differences: [] }));
        }
        if (pathname === '/api/connection') {
          if (hosted || cloud.configured || !saveConnection) throw new AppError('The Gemma key is managed in the server’s private environment settings.', 403);
          if (typeof input.key !== 'string' || input.key.length < 15 || input.key.length > 500 || /\s/.test(input.key)) throw new AppError('Enter your Google AI Studio API key.');
          const proposed = { key: input.key, model: validateModel(input.model) };
          await callGemma(proposed, 'Reply with the single word READY.');
          await saveConnection(proposed); config = proposed; verified = true;
          return send(200, { configured: true, verified: true, model: config.model });
        }
        if (pathname === '/api/test-connection') {
          if (cloud.configured || hosted) await cloud.session(req, res, true);
          await callGemma(config, 'Reply with the single word READY.'); verified = true;
          return send(200, { configured: true, verified, model: config.model });
        }
        if (pathname === '/api/setup/interpret' || pathname === '/api/setup/photo') {
          if (cloud.configured || hosted) await cloud.session(req, res, true);
          const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
          const photo = pathname.endsWith('/photo');
          if (photo && !input.image) throw new AppError('Choose a photo of your event or roster.');
          const result = await interpretEventSetup(config, photo ? input.request ?? '' : input.request, today, photo ? { image: input.image } : {});
          verified = true; return send(200, result);
        }
        if (pathname === '/api/setup/create') {
          const active = await cloud.session(req, res, true);
          const state = compileSetupDraft(input.draft);
          validateEventState(state);
          return send(201, await cloud.save(active, null, 0, state, { kind: 'setup', title: 'Event created from reviewed Gemma draft', text: 'The coordinator reviewed the event, volunteers, shifts and any imported assignments before saving.', source: 'gemma', differences: [] }));
        }
        if (pathname === '/api/interpret') {
          const active = cloud.configured || hosted ? await cloud.session(req, res, true) : null;
          const stored = input.eventId ? await cloud.load(active, input.eventId) : null;
          const people = stored?.state.volunteers || input.volunteers, shifts = stored?.state.shifts || input.shifts;
          const schedule = stored?.state.schedule || input.schedule || Object.fromEntries(shifts.map(s => [s.id, []]));
          validateData(people, shifts, schedule);
          const result = await interpretRequest(config, input.request, people, shifts, stored?.state.date || input.date || demo.date, schedule);
          verified = true; return send(200, result);
        }
        if (pathname === '/api/repair') {
          const active = input.eventId ? await cloud.session(req, res, true) : null;
          const stored = input.eventId ? await cloud.load(active, input.eventId) : null;
          if (stored && stored.version !== input.expectedVersion) throw new AppError('This event changed in another tab. Refresh the cloud copy before finding cover.', 409);
          const people = input.volunteers || stored?.state.volunteers, shifts = stored?.state.shifts || input.shifts, baseline = stored?.state.schedule || input.schedule;
          validateData(people, shifts, baseline);
          const changes = input.changes ?? [];
          validateChanges(changes, people, shifts);
          const result = changes.length ? editSchedule(people, shifts, baseline, changes) : { ...repairSchedule(people, shifts, baseline), mode: 'complete', volunteers: people, assignments: [] };
          const { volunteers, assignments } = result;
          if (stored && result.schedule) {
            const text = typeof input.requestText === 'string' ? input.requestText.slice(0, 3000) : 'Volunteer schedule updated.';
            const source = ['gemma', 'scenario', 'team'].includes(input.source) ? input.source : 'team';
            result.proposalId = tokens.issue({ userId: active.user.id, eventId: stored.id, version: stored.version, mode: result.mode, assignments, state: { ...stored.state, volunteers, schedule: result.schedule, history: [] }, activity: { kind: 'repair', title: `${result.changedAssignments} assignment${result.changedAssignments === 1 ? '' : 's'} updated${result.mode === 'incremental' ? result.complete ? ' · schedule complete' : ' · work in progress' : ' · all constraints satisfied'}`, text, source, differences: result.differences } });
          }
          return send(200, result);
        }
        return send(404, { error: 'Endpoint not found.' });
      }
      if (request.method !== 'GET') return send(405, { error: 'Method not supported.' });
      if (pathname === '/api/demo') return send(200, { ...demo, scenarios });
      if (pathname === '/api/status') return send(200, { configured: !!config.key && config.key !== 'your_google_ai_studio_key_here', verified, model: config.model, managed: hosted || cloud.configured });
      if (pathname === '/api/auth/session') return send(200, { configured: cloud.configured, user: safeUser((await cloud.session(req, res))?.user) });
      if (pathname === '/api/events') return send(200, { events: await cloud.list(await cloud.session(req, res, true)) });
      const event = pathname.match(/^\/api\/events\/([0-9a-f-]{36})$/i);
      if (event) return send(200, await cloud.load(await cloud.session(req, res, true), event[1]));
      return send(404, { error: 'Endpoint not found.' });
    } catch (error) {
      const status = error.status || 400;
      return send(status, { error: String(error.message).split(config.key || '\0').join('[redacted]'), ...(error.quota ? { quota: error.quota } : {}) });
    }
  };
}
