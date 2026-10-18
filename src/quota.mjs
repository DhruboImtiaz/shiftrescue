export function nextPacificMidnight(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  const p = Object.fromEntries(parts.map(v => [v.type, v.value]));
  const candidate = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + 1, 8);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(candidate));
  return candidate - hour * 3600000;
}

export function quotaDetails(payload, headers, now = Date.now()) {
  const details = payload?.error?.details || [];
  const violations = details.flatMap(d => Array.isArray(d.violations) ? d.violations : []);
  const zero = violations.some(v => Number(v.quotaValue) === 0 && v.quotaValue !== undefined);
  const daily = violations.some(v => /per.?day|daily/i.test(`${v.quotaId || ''} ${v.quotaMetric || ''}`));
  const candidates = [];
  const after = headers?.get?.('retry-after');
  if (after) { const ms = /^\d+(\.\d+)?$/.test(after) ? now + Number(after) * 1000 : Date.parse(after); if (Number.isFinite(ms) && ms > now) candidates.push(ms); }
  for (const d of details) {
    if (String(d['@type']).endsWith('google.rpc.RetryInfo')) {
      const match = String(d.retryDelay || '').match(/^(\d+(?:\.\d+)?)s$/);
      if (match) candidates.push(now + Number(match[1]) * 1000);
    }
  }
  if (daily && !zero) candidates.push(nextPacificMidnight(now));
  const retryAt = !zero && candidates.length ? new Date(Math.max(...candidates)).toISOString() : null;
  return { kind: zero ? 'unavailable' : daily ? 'daily' : 'rate', retryAt, resetSource: zero ? 'unknown' : daily ? 'daily-window' : retryAt ? 'provider' : 'unknown', message: zero ? 'Gemma is unavailable because Google reports a quota of zero for this model. A time-based refresh is not confirmed; check model access and quota in AI Studio.' : daily ? 'Gemma’s daily quota has been reached. Daily request quotas refresh at midnight Pacific time. Availability may still depend on other limits.' : 'Gemma’s request or token limit has been reached. Your message and schedule have been kept.' };
}
export class GemmaQuotaError extends Error {
  constructor(quota) { super(quota.message); this.status = 429; this.quota = quota; }
}
