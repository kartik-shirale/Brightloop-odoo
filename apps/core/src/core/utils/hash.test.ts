import '../test-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateOtp, hashPassword, hmacOtp, safeEqual, sha256, verifyPassword } from './hash.js';
test('password hashes round trip with unique salts', async () => {
  const hash = await hashPassword('Secure123');
  assert(await verifyPassword('Secure123', hash));
  assert(!await verifyPassword('wrong', hash));
  assert.notEqual(hash, await hashPassword('Secure123'));
});
test('OTP helpers produce secure-format codes and stable HMAC digests', () => {
  for (let i = 0; i < 50; i++) assert.match(generateOtp(), /^\d{6}$/);
  assert.match(hmacOtp('123456'), /^[0-9a-f]{64}$/);
  assert.equal(hmacOtp('123456'), hmacOtp('123456'));
  assert.notEqual(hmacOtp('123456'), hmacOtp('654321'));
  assert(safeEqual('abc', 'abc'));
  assert(!safeEqual('abc', 'abd'));
  assert(!safeEqual('abc', 'abcd'));
  assert.match(sha256('test'), /^[0-9a-f]{64}$/);
});
