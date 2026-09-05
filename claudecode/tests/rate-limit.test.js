import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { ApiLimiter, retryAfterDeadline } from '../rootfs/usr/share/claudecode-addon/usage-bridge/rate-limit.js';
import { fetchUsage } from '../rootfs/usr/share/claudecode-addon/usage-bridge/usage.js';
const bridge = new URL('../rootfs/usr/share/claudecode-addon/usage-bridge/', import.meta.url);
async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-limiter-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test('one-hour 429 minimum, exponential backoff and longer server wait survive restarts', async t => {
  const file = path.join(await directory(t), 'state.json');
  let now = 1800000000000;
  const restart = () => new ApiLimiter(file, 300000, () => now);
  let limiter = restart();
  assert.equal(await limiter.claim(), true);
  await limiter.rateLimited('10');
  now += 3599999;
  limiter = restart();
  assert.equal(await limiter.claim(), false);
  now++;
  assert.equal(await limiter.claim(), true);
  await limiter.rateLimited('10800');
  now += 7200000;
  limiter = restart();
  assert.equal(await limiter.claim(), false);
  now += 3600000;
  assert.equal(await limiter.claim(), true);
  await limiter.success({session_used_percent: 1});
  now += 300000;
  assert.equal(await limiter.claim(), true);
  await limiter.rateLimited(null);
  assert.equal(limiter.state.next_allowed_at, now + 3600000);
});
test('idle interval persists and never shortens configured or 429 limits', async t => {
  const file = path.join(await directory(t), 'state.json');
  let now = 1800000000000;
  let limiter = new ApiLimiter(file, 300000, () => now);
  for (let i = 0; i < 7; i++) {
    assert.equal(await limiter.claim(), true);
    await limiter.success({session_used_percent: 10, captured_at: i});
    now += 300000;
  }
  limiter = new ApiLimiter(file, 300000, () => now);
  assert.equal(await limiter.claim(), false);
  assert.equal(limiter.diagnostics().polling_interval, 600);
  now += 300000;
  assert.equal(await limiter.claim(), true);
  await limiter.success({session_used_percent: 11});
  assert.equal(limiter.diagnostics().polling_interval, 300);
  now += 300000;
  assert.equal(await limiter.claim(), true);
  await limiter.rateLimited(null);
  now += 600000;
  limiter = new ApiLimiter(file, 60000, () => now);
  assert.equal(await limiter.claim(), false);
  assert.equal(limiter.diagnostics().api_status, 'rate_limited');
  const slow = new ApiLimiter(path.join(await directory(t), 'slow'), 900000, () => now);
  for (let i = 0; i < 8; i++) {
    assert.equal(await slow.claim(), true);
    await slow.success({session_used_percent: 10});
    assert.equal(slow.diagnostics().polling_interval, 900);
    now += 900000;
  }
});
test('Retry-After supports seconds and HTTP dates, ignores invalid values', () => {
  const now = Date.UTC(2026, 8, 5);
  assert.equal(retryAfterDeadline('7200', now), now + 7200000);
  assert.equal(retryAfterDeadline(new Date(now + 7200000).toUTCString(), now), now + 7200000);
  for (const value of [null, '', 'invalid']) assert.equal(retryAfterDeadline(value, now), 0);
});
test('legacy state is respected and unreadable state prevents requests', async t => {
  const file = path.join(await directory(t), 'state.json');
  await fs.writeFile(file, JSON.stringify({requested_at: 1000000}));
  assert.equal(await new ApiLimiter(file, 300000, () => 1000001).claim(), false);
  await fs.writeFile(file, '{broken');
  await assert.rejects(new ApiLimiter(file, 300000).claim());
});
test('fetchUsage preserves HTTP 429 Retry-After without a real API call', async t => {
  const dir = await directory(t);
  await fs.writeFile(path.join(dir, '.credentials.json'), JSON.stringify({claudeAiOauth: {accessToken: 'test-only', expiresAt: Date.now() + 3600000}}));
  t.mock.method(globalThis, 'fetch', async () => new Response('', {status: 429, headers: {'Retry-After': '7200'}}));
  await assert.rejects(fetchUsage({claudeHome: dir}), e => e.status === 429 && e.retryAfter === '7200');
});
test('poll stays offline without data during cooldown and handles 429 then recovery', async () => {
  const source = await fs.readFile(new URL('index.js', bridge), 'utf8');
  const pollCode = source.slice(source.indexOf('async function poll()'), source.indexOf('client.on("connect"'));
  let allowed = false, official = null, fail = true, backoffs = 0, successes = 0, calls = 0;
  const availability = [], published = [];
  const context = vm.createContext({
    cachedState: null, baseTopic: "test", polling: false, lastError: null, rateLimitLogged: false,
    console: {log() {}, error() {}},
    limiter: {state: {}, diagnostics: () => ({}), claim: async () => allowed, rateLimited: async value => {assert.equal(value, '900'); backoffs++;}, success: async () => successes++},
    readStatuslineState: async () => official,
    fetchUsage: async () => {calls++; if (fail) throw Object.assign(new Error('429'), {status:429, retryAfter:'900'}); return {status:'ok'};},
    statuslineOnlyState: x => x, applyStatuslineState: x => x,
    config: {}, client: {publish: (topic, payload) => published.push(payload)},
    availability: x => availability.push(x), process: {exit: () => assert.fail('unexpected exit')},
  });
  vm.runInContext(pollCode, context);
  await context.poll(); assert.equal(availability.at(-1), 'offline'); assert.equal(calls, 0);
  official = {weekly: {used_percent: 12}};
  await context.poll(); assert.equal(availability.at(-1), 'online'); assert.ok(published.some(p => p.includes('weekly')));
  official = null; allowed = true;
  await context.poll(); assert.equal(backoffs, 1); assert.equal(availability.at(-1), 'offline');
  allowed = false;
  await context.poll(); assert.equal(availability.at(-1), 'offline'); assert.equal(calls, 1);
  allowed = true; fail = false;
  await context.poll(); assert.equal(successes, 1); assert.equal(availability.at(-1), 'online');
});

test('30-second local checks cannot bypass the API interval', async t => {
  const file = path.join(await directory(t), 'ticks.json');
  let now = 1800000000000;
  const limiter = new ApiLimiter(file, 300000, () => now);
  let requests = 0;
  for (let i = 0; i < 20; i++) {
    if (await limiter.claim()) { requests++; await limiter.success({session_used_percent: i}); }
    now += 30000;
  }
  assert.equal(requests, 2);
});

test('diagnostic discovery remains independent of usage availability', async () => {
  const { discoveryMessages } = await import(new URL('entities.js', bridge));
  const messages = discoveryMessages({deviceId:'test',deviceName:'Test',discoveryPrefix:'homeassistant',stateTopic:'test/state',availabilityTopic:'test/availability'});
  const diagnostics = messages.map(m => JSON.parse(m.payload)).filter(m => m.state_topic === 'test/diagnostics');
  assert.equal(diagnostics.length, 3);
  for (const sensor of diagnostics) {
    assert.equal(sensor.availability, undefined);
    assert.equal(sensor.expire_after, 120);
  }
});
