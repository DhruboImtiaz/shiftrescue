import { MAX_EVENT_BYTES } from './limits.mjs';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { checkSchedule, validateData } from './scheduler.mjs';
import { AVATAR_BUCKET, serializeProfile, validateProfile } from './profile.mjs';
import { validatePhoto } from './photo.mjs';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function validateEventState(state) {
  if (!state || typeof state.event !== 'string' || !state.event.trim() || state.event.length > 100 || typeof state.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(state.date) || !Number.isFinite(Date.parse(state.date)) || new Date(state.date).toISOString().slice(0, 10) !== state.date || state.timezone !== 'Asia/Dhaka') throw new AppError('Provide an event name, a valid date and the Asia/Dhaka timezone.');
  if (Buffer.byteLength(JSON.stringify({ event: state.event, date: state.date, timezone: state.timezone, volunteers: state.volunteers, shifts: state.shifts, schedule: state.schedule })) > MAX_EVENT_BYTES) throw new AppError('Event data is too large. Shorten the team or shift details.', 413);
  validateData(state.volunteers, state.shifts, state.schedule, { allowEmpty: true });
  const validation = checkSchedule(state.volunteers, state.shifts, state.schedule, { allowPartial: true });
  if (!validation.valid) throw new AppError(`A schedule cannot be saved while its rules are broken: ${validation.errors[0]}`);
  return state;
}
export function readCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => { const at = part.indexOf('='); if (at < 0) return ['', '']; try { return [part.slice(0, at).trim(), decodeURIComponent(part.slice(at + 1))]; } catch { return ['', '']; } }).filter(([key]) => key));
}
export function sessionCookies(session, secure = false) {
  const suffix = `; HttpOnly; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
  if (!session) return [`sr_access=; Max-Age=0${suffix}`, `sr_refresh=; Max-Age=0${suffix}`];
  return [`sr_access=${encodeURIComponent(session.access_token)}; Max-Age=${Math.min(Number(session.expires_in || 3600), 86400)}${suffix}`, `sr_refresh=${encodeURIComponent(session.refresh_token)}; Max-Age=2592000${suffix}`];
}
export function safeUser(user) { return user ? { id: user.id, email: user.email || '' } : null; }

export function cloudService({ url, key, secure = false, createSupabaseClient = createClient }) {
  const configured = !!url && !!key;
  const refreshes = new Map();
  const client = token => {
    if (!configured) throw new AppError('Supabase has not been configured on the server.', 503);
    return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}) });
  };
  function fail(error) {
    if (!error) return;
    const conflict = error.code === 'PT409';
    throw new AppError(conflict ? 'A newer event version is already saved. Refresh the saved copy before trying again.' : error.message || 'Supabase could not complete the request.', conflict ? 409 : error.code === 'PT404' ? 404 : error.code === '42501' ? 403 : 400);
  }
  const sessionUnavailable = () => new AppError('Could not verify your session right now. Please retry; your saved events are unchanged.', 503);
  const temporaryAuthError = error => error && ![400, 401, 403, 422].includes(error.status);
  async function session(req, res, required = false) {
    if (!configured) { if (required) throw new AppError('Connect Supabase before signing in.', 503); return null; }
    const cookies = readCookies(req.headers.cookie), access = cookies.sr_access, refresh = cookies.sr_refresh;
    if (access) {
      let result;
      try { result = await client().auth.getUser(access); } catch { throw sessionUnavailable(); }
      const { data, error } = result;
      if (temporaryAuthError(error)) throw sessionUnavailable();
      if (!error && data.user && !data.user.is_anonymous) return { user: data.user, access, refresh, db: client(access) };
    }
    if (refresh) {
      let pending = refreshes.get(refresh);
      if (!pending) {
        pending = client().auth.refreshSession({ refresh_token: refresh });
        refreshes.set(refresh, pending);
        const timer = setTimeout(() => refreshes.delete(refresh), 20000); timer.unref();
      }
      let result;
      try { result = await pending; } catch { refreshes.delete(refresh); throw sessionUnavailable(); }
      const { data, error } = result;
      if (error) refreshes.delete(refresh);
      if (temporaryAuthError(error)) throw sessionUnavailable();
      if (!error && data.session && !data.user?.is_anonymous) {
        res.setHeader('Set-Cookie', sessionCookies(data.session, secure));
        return { user: data.user, access: data.session.access_token, refresh: data.session.refresh_token, db: client(data.session.access_token) };
      }
    }
    if (access || refresh) res.setHeader('Set-Cookie', sessionCookies(null, secure));
    if (required) throw new AppError('Sign in to access your saved events.', 401);
    return null;
  }
  async function login(input, res, signup = false) {
    if (typeof input.email !== 'string' || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 200) throw new AppError('Enter a valid email address and a password of at least 8 characters.');
    const credentials = { email: input.email.trim(), password: input.password };
    if (signup) {
      const { name, username, phone } = validateProfile(input);
      credentials.options = { data: { name, username, phone } };
    }
    const { data, error } = signup ? await client().auth.signUp(credentials) : await client().auth.signInWithPassword(credentials);
    if (signup && error?.code === 'unexpected_failure') throw new AppError('Could not create this account. Try a different username, or sign in if you already have an account.');
    fail(error);
    if (data.session) res.setHeader('Set-Cookie', sessionCookies(data.session, secure));
    return { user: data.session ? safeUser(data.user) : null, confirmationRequired: !data.session, message: data.session ? 'Signed in. Your saved events are ready.' : 'Check your email to confirm your account, then return here and sign in. If you already have an account, use Sign in.' };
  }
  async function logout(req, res) {
    try {
      const active = await session(req, res);
      if (active?.refresh) {
        const instance = client();
        const { error } = await instance.auth.setSession({ access_token: active.access, refresh_token: active.refresh });
        if (!error) await instance.auth.signOut({ scope: 'local' });
      }
    } catch { /* Explicit local sign-out must work even during an Auth outage. */ }
    finally { res.setHeader('Set-Cookie', sessionCookies(null, secure)); }
  }
  async function profileRow(active) {
    const { data, error } = await active.db.from('shiftrescue_profiles').select('name,username,phone,bio,avatar_path,updated_at').eq('id', active.user.id).single();
    fail(error); return data;
  }
  async function profile(active) { return serializeProfile(await profileRow(active), active.user.email || ''); }
  async function saveProfile(active, input) {
    const fields = validateProfile(input), previous = await profileRow(active);
    const bucket = active.db.storage.from(AVATAR_BUCKET);
    let uploaded = null;
    if (Object.hasOwn(input, 'image')) {
      if (input.image === null) fields.avatar_path = null;
      else {
        if (!input.image) throw new AppError('Choose a profile photo or use Remove photo.');
        const image = validatePhoto(input.image);
        const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[image.mimeType];
        uploaded = `${active.user.id}/${randomUUID()}.${extension}`;
        const { error } = await bucket.upload(uploaded, Buffer.from(image.data, 'base64'), { contentType: image.mimeType, upsert: false });
        fail(error); fields.avatar_path = uploaded;
      }
    }
    let saved, rejected = false;
    try {
      const { data, error } = await active.db.from('shiftrescue_profiles').update(fields).eq('id', active.user.id).select('name,username,phone,bio,avatar_path,updated_at').single();
      rejected = ['23505', '23514', '42501'].includes(error?.code);
      if (error?.code === '23505') throw new AppError('That username is already taken. Choose another one.', 409);
      fail(error); saved = data;
    } catch (error) {
      // A lost response can follow a successful write. Only clean up uploads
      // when the database explicitly confirms it rejected the update.
      if (uploaded && rejected) await bucket.remove([uploaded]).catch(() => {});
      throw error;
    }
    // Delete the old photo only after the profile points to its replacement.
    if (Object.hasOwn(fields, 'avatar_path') && previous.avatar_path && previous.avatar_path !== fields.avatar_path) await bucket.remove([previous.avatar_path]).catch(() => {});
    return serializeProfile(saved, active.user.email || '');
  }
  async function avatar(active) {
    const row = await profileRow(active);
    if (!row.avatar_path) throw new AppError('No profile photo has been added.', 404);
    const { data, error } = await active.db.storage.from(AVATAR_BUCKET).download(row.avatar_path);
    fail(error); return data;
  }
  async function changeEmail(active, input, res) {
    if (typeof input.email !== 'string' || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw new AppError('Enter a valid email address.');
    const instance = client();
    const { error, data } = await instance.auth.setSession({ access_token: active.access, refresh_token: active.refresh });
    fail(error);
    if (data.session) res.setHeader('Set-Cookie', sessionCookies(data.session, secure));
    const result = await instance.auth.updateUser({ email: input.email.trim() }); fail(result.error);
    return { user: safeUser(result.data.user), message: result.data.user.email === input.email.trim() ? 'Email address updated.' : 'Check your inbox to confirm the email change. Supabase may ask you to confirm from both your current and new address. Your current email stays active until confirmation.' };
  }
  async function list(active, { deleted = false } = {}) {
    const events = [];
    for (let offset = 0; ; offset += 200) {
      let query = active.db.from('shiftrescue_events').select('id,owner_id,name,event_date,timezone,version,updated_at,deleted_at');
      query = deleted ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);
      const { data, error } = await query.order('updated_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 199);
      fail(error); events.push(...data.map(e => ({ ...e, role: e.owner_id === active.user?.id ? 'owner' : 'shared' })));
      if (data.length < 200) return events;
    }
  }
  async function load(active, id) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('Invalid event ID.');
    const { data, error } = await active.db.rpc('shiftrescue_load_event', { p_event_id: id }); fail(error);
    if (!data) throw new AppError('That event does not exist or is not available to your account.', 404);
    validateEventState(data.state); return data;
  }
  async function save(active, id, version, state, activity = null) {
    validateEventState(state);
    if (id && (!Number.isSafeInteger(version) || version < 1)) throw new AppError('A valid event version is required before saving.');
    const { data, error } = await active.db.rpc('shiftrescue_save_event', { p_event_id: id || null, p_expected_version: version || 0, p_state: { event: state.event, date: state.date, timezone: state.timezone, volunteers: state.volunteers, shifts: state.shifts, schedule: state.schedule }, p_activity: activity });
    fail(error); validateEventState(data.state); return data;
  }
  async function setDeleted(active, id, version, deleted) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id) || !Number.isSafeInteger(version) || version < 1) throw new AppError('Refresh the event before deleting or restoring it.');
    const { data, error } = await active.db.rpc('shiftrescue_set_event_deleted', { p_event_id: id, p_expected_version: version, p_deleted: deleted });
    fail(error); return data;
  }
  async function collaboration(active, operation, params = {}) {
    const { data, error } = await active.db.rpc(`shiftrescue_${operation}`, params);
    fail(error);
    if (data?.error) throw new AppError(data.error, [400, 403, 404, 409, 429].includes(data.status) ? data.status : 400);
    return data;
  }
  async function requestAccess(active, input) {
    if (typeof input.code !== 'string' || input.code.length > 40 || !/^[A-Fa-f0-9\s-]{12,40}$/.test(input.code) || input.code.replace(/[\s-]/g, '').length !== 12 || !['viewer', 'editor'].includes(input.role)) throw new AppError('Enter a valid event code and choose view or edit access.');
    return collaboration(active, 'request_access', { p_code: input.code, p_role: input.role });
  }
  async function sharing(active, id, input) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('Invalid event ID.');
    if (!input) return collaboration(active, 'event_sharing', { p_event_id: id });
    if (input.action === 'rotate') return collaboration(active, 'rotate_event_code', { p_event_id: id });
    if (typeof input.userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.userId) || !['viewer', 'editor', 'reject', 'remove'].includes(input.decision)) throw new AppError('Choose a person and a valid access decision.');
    return collaboration(active, 'decide_access', { p_event_id: id, p_user_id: input.userId, p_decision: input.decision });
  }
  async function requesterAvatar(active, id, userId) {
    const row = await collaboration(active, 'requester_avatar', { p_event_id: id, p_user_id: userId });
    if (!row?.avatarPath) throw new AppError('No profile photo has been added.', 404);
    const { data, error } = await active.db.storage.from(AVATAR_BUCKET).download(row.avatarPath);
    fail(error); return data;
  }
  return { configured, session, login, logout, profile, saveProfile, avatar, changeEmail, list, load, save, setDeleted, requestAccess, sharing, requesterAvatar, eventStatus: async (active, id) => { const result = await collaboration(active, 'event_status', { p_event_id: id }); if (!result) throw new AppError('This event is no longer available to your account.', 404); return result; }, myRequests: active => collaboration(active, 'my_requests') };
}
