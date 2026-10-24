import { createClient } from '@supabase/supabase-js';
import { checkSchedule, validateData } from './scheduler.mjs';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function validateEventState(state) {
  if (!state || typeof state.event !== 'string' || !state.event.trim() || state.event.length > 100 || typeof state.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(state.date) || !Number.isFinite(Date.parse(state.date)) || new Date(state.date).toISOString().slice(0, 10) !== state.date || state.timezone !== 'Asia/Dhaka') throw new AppError('Provide an event name, a valid date and the Asia/Dhaka timezone.');
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
    throw new AppError(conflict ? 'A newer event version is already saved. Reload the cloud copy before applying this repair.' : error.message || 'Supabase could not complete the request.', conflict ? 409 : 400);
  }
  async function session(req, res, required = false) {
    if (!configured) { if (required) throw new AppError('Connect Supabase before signing in.', 503); return null; }
    const cookies = readCookies(req.headers.cookie), access = cookies.sr_access, refresh = cookies.sr_refresh;
    if (access) {
      const { data, error } = await client().auth.getUser(access);
      if (!error && data.user && !data.user.is_anonymous) return { user: data.user, access, refresh, db: client(access) };
    }
    if (refresh) {
      let pending = refreshes.get(refresh);
      if (!pending) {
        pending = client().auth.refreshSession({ refresh_token: refresh });
        refreshes.set(refresh, pending);
        const timer = setTimeout(() => refreshes.delete(refresh), 20000); timer.unref();
      }
      const { data, error } = await pending;
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
    const { data, error } = signup ? await client().auth.signUp(credentials) : await client().auth.signInWithPassword(credentials);
    fail(error);
    if (data.session) res.setHeader('Set-Cookie', sessionCookies(data.session, secure));
    return { user: data.session ? safeUser(data.user) : null, confirmationRequired: !data.session, message: data.session ? 'Signed in. Your saved events are ready.' : 'Check your email to confirm your account, then return here and sign in. If you already have an account, use Sign in.' };
  }
  async function logout(req, res) {
    const active = await session(req, res);
    try {
      if (active?.refresh) {
        const instance = client();
        const { error } = await instance.auth.setSession({ access_token: active.access, refresh_token: active.refresh });
        if (!error) await instance.auth.signOut({ scope: 'local' });
      }
    } finally { res.setHeader('Set-Cookie', sessionCookies(null, secure)); }
  }
  async function list(active) {
    const { data, error } = await active.db.from('shiftrescue_events').select('id,name,event_date,timezone,version,updated_at').order('updated_at', { ascending: false }).limit(50);
    fail(error); return data;
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
  return { configured, session, login, logout, list, load, save };
}
