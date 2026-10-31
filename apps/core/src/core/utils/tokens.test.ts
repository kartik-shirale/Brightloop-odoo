import '../test-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { generateRefreshToken, signAccessToken, verifyAccessToken } from './tokens.js';
test('JWT round trip, tampering and expiry', () => {
  const token = signAccessToken({ sub: 42, role: 'CUSTOMER', sid: 7 });
  const payload = verifyAccessToken(token);
  assert.equal(payload?.sub, '42');
  assert.equal(payload?.role, 'CUSTOMER');
  assert.equal(payload?.sid, 7);
  assert.equal(verifyAccessToken(`${token}x`), null);
  assert.equal(verifyAccessToken('invalid'), null);
  assert.equal(verifyAccessToken(jwt.sign({ sub: '42', role: 'CUSTOMER', sid: 7 }, env.JWT_ACCESS_SECRET,
    { expiresIn: -1 })), null);
});
test('signed JWTs with invalid claims are rejected', () => {
  for (const claims of [{ sub: 'x', role: 'CUSTOMER', sid: 1 }, { sub: '1', role: 'ROOT', sid: 1 },
    { sub: '1', role: 'CUSTOMER', sid: -1 }]) {
    assert.equal(verifyAccessToken(jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: '15m' })), null);
  }
});
test('refresh tokens contain 48 random bytes', () => {
  const token = generateRefreshToken();
  assert.match(token, /^[0-9a-f]{96}$/);
  assert.notEqual(token, generateRefreshToken());
});
