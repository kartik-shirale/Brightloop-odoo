import '../../core/test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.EMAILJS_INVOICE_TEMPLATE_ID = 'invoice-template';

const message = {
  toEmail: 'alice@example.com', name: 'Alice', invoiceNumber: 'INV-2026-000001', total: 'INR 1,180.00',
  dueDate: '2026-11-15', portalUrl: 'http://localhost:3000/portal/invoices/1',
};

test('sendInvoice uses the invoice template with the documented params and keeps failures sanitized', async (t) => {
  const { EmailJsClient } = await import('../../core/mail/emailjs.js');
  const { AppError } = await import('../../core/errors.js');
  const fake = t.mock.method(globalThis, 'fetch', async () => new Response('OK', { status: 200 }));
  await new EmailJsClient().sendInvoice(message);
  const init = fake.mock.calls[0]?.arguments[1];
  assert(init && typeof init.body === 'string');
  const payload = JSON.parse(init.body) as { template_id: string; accessToken: string; template_params: Record<string, unknown> };
  assert.equal(payload.template_id, 'invoice-template');
  assert.equal(payload.accessToken, 'test');
  assert.deepEqual(payload.template_params, {
    to_email: message.toEmail, name: message.name, invoice_number: message.invoiceNumber, total: message.total,
    due_date: message.dueDate, portal_url: message.portalUrl,
  });

  t.mock.method(globalThis, 'fetch', async () => new Response('The recipients address is empty secret-body', { status: 422 }));
  await assert.rejects(new EmailJsClient().sendInvoice(message), (error: unknown) => {
    assert(error instanceof AppError);
    assert.equal(error.status, 503);
    assert.deepEqual(error.details, { providerStatus: 422, reason: 'RECIPIENT_TEMPLATE_INVALID' });
    assert.ok(!JSON.stringify(error).includes('secret-body'));
    return true;
  });
});
