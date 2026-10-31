import '../../core/test-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryKvStore } from '../../config/redis.js';
import { env } from '../../config/env.js';
import { hmacOtp } from '../../core/utils/hash.js';
import { OtpService } from './otp.service.js';

const email = 'alice@example.com';
function setup() {
  const kv = new MemoryKvStore();
  const sent: string[] = [];
  const service = new OtpService({ async sendOtp(input) { sent.push(input.otp); } }, kv);
  return { kv, sent, service };
}
test('stores only the digest with a five-minute TTL; enforces resend cooldown', async () => {
  const { kv, sent, service } = setup();
  await service.issue('verify', email, 'Alice');
  const key = `app:auth:otp:verify:${email}`;
  const record = JSON.parse((await kv.get(key))!);
  assert.equal(record.digest, hmacOtp(sent[0]));
  assert.equal(await kv.ttl(key), 300);
  await assert.rejects(service.issue('verify', email, 'Alice'), { status: 429 });
});
test('concurrent issue requests send exactly one code', async () => {
  const { sent, service } = setup();
  const results = await Promise.allSettled([service.issue('verify', email, 'Alice'), service.issue('verify', email, 'Alice')]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(sent.length, 1);
});
test('correct OTP can be consumed exactly once, including concurrent requests', async () => {
  const { sent, service } = setup();
  await service.issue('verify', email, 'Alice');
  const results = await Promise.allSettled([service.verify('verify', email, sent[0]), service.verify('verify', email, sent[0])]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  await assert.rejects(service.verify('verify', email, sent[0]), { status: 400 });
});
test('five wrong attempts invalidate the correct OTP', async () => {
  const { sent, service } = setup();
  await service.issue('verify', email, 'Alice');
  const wrong = sent[0] === '000000' ? '000001' : '000000';
  for (let i = 0; i < env.OTP_MAX_ATTEMPTS; i++) await assert.rejects(service.verify('verify', email, wrong), { status: 400 });
  await assert.rejects(service.verify('verify', email, sent[0]), { status: 400 });
});
test('actual expiry, resend replacement, daily cap and purpose isolation', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const { sent, service } = setup();
  await service.issue('verify', email, 'Alice');
  await assert.rejects(service.verify('reset', email, sent[0]), { status: 400 });
  t.mock.timers.tick(301000);
  await assert.rejects(service.verify('verify', email, sent[0]), { status: 400 });
  for (let i = 1; i < env.OTP_DAILY_LIMIT; i++) {
    await service.issue('verify', email, 'Alice');
    t.mock.timers.tick(61000);
  }
  await assert.rejects(service.issue('verify', email, 'Alice'), { status: 429 });
});
test('resend replaces the previous code', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const { kv, sent, service } = setup();
  await service.issue('verify', email, 'Alice');
  t.mock.timers.tick(61000);
  await service.issue('verify', email, 'Alice');
  assert.equal(JSON.parse((await kv.get(`app:auth:otp:verify:${email}`))!).digest, hmacOtp(sent[1]));
  await service.verify('verify', email, sent[1]);
});
test('delivery failure releases cooldown and removes unusable OTP', async () => {
  const kv = new MemoryKvStore();
  const service = new OtpService({ async sendOtp() { throw new Error('mail offline'); } }, kv);
  await assert.rejects(service.issue('verify', email, 'Alice'), /mail offline/);
  assert.equal(await kv.get(`app:auth:otp:verify:${email}`), null);
  assert.equal(await kv.get(`app:auth:otp:cooldown:verify:${email}`), null);
});
