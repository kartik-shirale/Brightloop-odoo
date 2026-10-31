import '../core/test-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import Redis from 'ioredis';
import { RedisKvStore } from './redis.js';
import { env } from './env.js';
import { hmacOtp } from '../core/utils/hash.js';

test('Docker Redis: atomic OTP consume, attempts, expiry, cooldown and counter TTL', async (t) => {
  const client = new Redis(env.REDIS_URL, { lazyConnect: true, connectTimeout: 3000, retryStrategy: () => null });
  await client.connect();
  const kv = new RedisKvStore(client);
  const prefix = `app:test:${randomUUID()}`;
  const keys = ['otp', 'attempts', 'counter', 'cooldown', 'expiry', 'grant'].map((key) => `${prefix}:${key}`);
  t.after(async () => {
    try { await client.del(...keys); } finally { client.disconnect(); }
  });
  const [otp, attempts, counter, cooldown, expiry, grant] = keys;
  const record = JSON.stringify({ digest: hmacOtp('123456'), attempts: 0 });
  await kv.set(otp, record, 300);
  assert.deepEqual((await Promise.all([kv.verifyOtp(otp, hmacOtp('123456'), 5), kv.verifyOtp(otp, hmacOtp('123456'), 5)])).sort(), [0, 1]);
  await kv.set(attempts, record, 300);
  const wrong = await Promise.all(Array.from({ length: 5 }, () => kv.verifyOtp(attempts, hmacOtp('654321'), 5)));
  assert.deepEqual(wrong.sort(), [-1, -2, -3, -4, -5]);
  assert.equal(await kv.verifyOtp(attempts, hmacOtp('123456'), 5), 0);
  assert.deepEqual((await Promise.all([kv.setIfAbsent(cooldown, '1', 60), kv.setIfAbsent(cooldown, '1', 60)])).sort(), [false, true]);
  const counts = await Promise.all(Array.from({ length: 20 }, () => kv.incr(counter, 60)));
  assert.equal(Math.max(...counts), 20);
  assert((await kv.ttl(counter)) > 0);
  await kv.set(grant, '42', 300);
  const grants = await Promise.all([kv.take(grant), kv.take(grant)]);
  assert.equal(grants.filter((value) => value === '42').length, 1);
  assert.equal(grants.filter((value) => value === null).length, 1);
  await kv.set(expiry, record, 1);
  await setTimeout(1100);
  assert.equal(await kv.verifyOtp(expiry, hmacOtp('123456'), 5), 0);
});
