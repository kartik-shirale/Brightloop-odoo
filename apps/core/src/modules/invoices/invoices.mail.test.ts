import '../../core/test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';

const message = {
  toEmail: 'alice@example.com', name: 'Alice', invoiceNumber: 'INV-2026-000001', total: 'INR 1,180.00',
  dueDate: '2026-11-15', portalUrl: 'http://localhost:3000/portal/invoices/1',
};

test('sendInvoice without a configured template fails with a clear 503 and never calls the provider', async (t) => {
  delete process.env.EMAILJS_INVOICE_TEMPLATE_ID;
  const { EmailJsClient } = await import('../../core/mail/emailjs.js');
  const { AppError } = await import('../../core/errors.js');
  const fake = t.mock.method(globalThis, 'fetch', async () => new Response('OK', { status: 200 }));
  await assert.rejects(new EmailJsClient().sendInvoice(message), (error: unknown) => {
    assert(error instanceof AppError);
    assert.equal(error.status, 503);
    assert.match(error.message, /EMAILJS_INVOICE_TEMPLATE_ID/);
    return true;
  });
  assert.equal(fake.mock.calls.length, 0);
});
