import '../test-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EmailJsClient } from './emailjs.js';
import { AppError } from '../errors.js';
import { env } from '../../config/env.js';

const request = { toEmail: 'alice@example.com', name: 'Alice', otp: '123456', expiryMinutes: 5, kind: 'verify' };
test('EmailJS payload matches the provided template and keeps keys on the server', async (t) => {
  const fake = t.mock.method(globalThis, 'fetch', async () => new Response('OK', { status: 200 }));
  await new EmailJsClient().sendOtp(request);
  const init = fake.mock.calls[0].arguments[1];
  assert(init && typeof init.body === 'string');
  const payload = JSON.parse(init.body) as { service_id: string; template_id: string; accessToken: string; template_params: Record<string, unknown> };
  assert.equal(payload.service_id, env.EMAILJS_SERVICE_ID);
  assert.equal(payload.template_id, env.EMAILJS_TEMPLATE_ID);
  assert.equal(payload.accessToken, env.EMAILJS_PRIVATE_KEY);
  assert.deepEqual(payload.template_params, { app_name: 'Brightloop', to_email: request.toEmail, name: request.name, otp: request.otp,
    expiry_minutes: request.expiryMinutes, purpose: 'verify your email' });
});
for (const scenario of [
  { status: 403, text: 'API calls are disabled for non-browser applications', reason: 'SERVER_REQUESTS_DISABLED' },
  { status: 422, text: 'The recipients address is empty', reason: 'RECIPIENT_TEMPLATE_INVALID' },
  { status: 400, text: 'The Public Key is invalid', reason: 'PUBLIC_KEY_INVALID' },
]) {
  test(`EmailJS ${scenario.reason} is reported without raw provider text or secrets`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(scenario.text, { status: scenario.status }));
    await assert.rejects(new EmailJsClient().sendOtp(request), (error: unknown) => {
      assert(error instanceof AppError);
      assert.equal(error.status, 503);
      assert.equal(error.code, 'EMAIL_DELIVERY_FAILED');
      assert.deepEqual(error.details, { providerStatus: scenario.status, reason: scenario.reason });
      return true;
    });
  });
}
