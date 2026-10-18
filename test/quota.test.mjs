import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPacificMidnight, quotaDetails } from '../src/quota.mjs';
const now = Date.parse('2026-10-18T08:00:00Z');
const details = value => ({ error: { details: value } });
const daily = { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '100' }] };

test('daily quota refresh follows Pacific time, including DST boundaries', () => {
  for (const [at, expected] of [
    ['2026-10-18T08:00:00Z', '2026-10-19T07:00:00.000Z'],
    ['2026-12-18T08:00:00Z', '2026-12-19T08:00:00.000Z'],
    ['2026-03-08T07:59:00Z', '2026-03-08T08:00:00.000Z'],
    ['2026-11-01T06:59:00Z', '2026-11-01T07:00:00.000Z']
  ]) assert.equal(new Date(nextPacificMidnight(Date.parse(at))).toISOString(), expected);
});
test('Google RetryInfo becomes an exact retry timestamp', () => {
  const quota = quotaDetails(details([{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '43.5s' }]), new Headers(), now);
  assert.equal(quota.retryAt, '2026-10-18T08:00:43.500Z'); assert.equal(quota.resetSource, 'provider');
});
test('Retry-After supports seconds and HTTP dates', () => {
  assert.equal(quotaDetails({}, new Headers({ 'Retry-After': '60' }), now).retryAt, '2026-10-18T08:01:00.000Z');
  assert.equal(quotaDetails({}, new Headers({ 'Retry-After': 'Sun, 18 Oct 2026 08:02:00 GMT' }), now).retryAt, '2026-10-18T08:02:00.000Z');
});
test('daily quota uses the longer reset window instead of a shorter retry suggestion', () => {
  const quota = quotaDetails(details([daily]), new Headers({ 'Retry-After': '45' }), now);
  assert.equal(quota.kind, 'daily'); assert.equal(quota.retryAt, '2026-10-19T07:00:00.000Z');
});
test('missing reset information is explicitly unknown', () => {
  const quota = quotaDetails({}, new Headers(), now);
  assert.equal(quota.retryAt, null); assert.equal(quota.resetSource, 'unknown');
});
test('zero quota does not promise that waiting will restore model access', () => {
  const quota = quotaDetails(details([{ ...daily, violations: [{ quotaId: 'RequestsPerDay', quotaValue: '0' }] }]), new Headers({ 'Retry-After': '60' }), now);
  assert.equal(quota.kind, 'unavailable'); assert.equal(quota.retryAt, null);
});
