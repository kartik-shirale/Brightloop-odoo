/**
 * Demo data for local development: a small software company billing six business customers.
 *
 * Every record goes through the real services with an ADMIN actor, so prices, taxes, discounts,
 * totals, invoice numbers, status history and audit entries are produced exactly as the API
 * would produce them. Dates are in the past, so the data has real history: back-billed invoices,
 * paid, part-paid and overdue balances, and subscriptions in every status.
 *
 * Run from apps/core: `bun run db:seed:demo`. Refuses to run in production and stops if the demo
 * data already exists. Records created by hand are left untouched.
 */

import { pathToFileURL } from 'node:url';
import { Role, type InvoiceDto } from '@brightloop/shared';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { closeKvStore } from '../config/redis.js';
import { buildServices, type AppServices } from '../container.js';
import { logger } from '../core/logger.js';
import type { Actor } from '../core/utils/actor.js';
import { addDays, businessToday, toIsoDate } from '../core/utils/dates.js';
import { hashPassword } from '../core/utils/hash.js';
import { AuthRepository } from '../modules/auth/auth.repository.js';
import { createCustomerSchema } from '../modules/customers/customers.schema.js';
import { createDiscountSchema } from '../modules/discounts/discounts.schema.js';
import { generateInvoiceSchema } from '../modules/invoices/invoices.schema.js';
import { createPaymentTermSchema } from '../modules/payment-terms/payment-terms.schema.js';
import { createPaymentSchema } from '../modules/payments/payments.schema.js';
import { createPlanSchema } from '../modules/plans/plans.schema.js';
import { createProductSchema } from '../modules/products/products.schema.js';
import { createTemplateSchema } from '../modules/quotation-templates/quotation-templates.schema.js';
import { createStaffSchema } from '../modules/staff/staff.schema.js';
import { closeSubscriptionSchema, createFromTemplateSchema, createSubscriptionSchema } from '../modules/subscriptions/subscriptions.schema.js';
import { createTaxSchema } from '../modules/taxes/taxes.schema.js';

/** Development-only password for the demo staff and portal accounts. */
const DEMO_PASSWORD = process.env['SEED_DEMO_PASSWORD'] ?? 'Brightloop@2026';
/** Presence of this portal account means the demo data was already seeded. */
const MARKER_EMAIL = 'anil@sharmatextiles.example.com';

type PaymentMethod = 'UPI' | 'BANK_TRANSFER' | 'CARD' | 'CHEQUE';

interface Seeder {
  services: AppServices;
  admin: Actor;
  today: Date;
}

/**
 * Bills one period at a time with `asOf` = the period start, so each invoice carries its real
 * issue and due dates. Stops at today, at the expiry date, or after `maxPeriods`.
 */
async function billPeriods({ services, admin, today }: Seeder, subscriptionId: number, maxPeriods = 24): Promise<InvoiceDto[]> {
  const invoices: InvoiceDto[] = [];
  for (let index = 0; index < maxPeriods; index += 1) {
    const sub = await services.subscriptionsService.getForBilling(subscriptionId);
    const next = sub?.nextBillingDate ?? null;
    if (!sub || next === null || next > today || (sub.expiryDate !== null && next > sub.expiryDate)) break;
    invoices.push(await services.invoicesService.generate(
      admin,
      generateInvoiceSchema.parse({ subscriptionId, asOf: toIsoDate(next), autoConfirm: true }),
    ));
  }
  return invoices;
}

/** Records a payment `daysLate` days after the invoice date (never after today). */
async function pay(
  { services, admin, today }: Seeder,
  invoice: InvoiceDto,
  method: PaymentMethod,
  daysLate: number,
  share = 1,
): Promise<void> {
  const date = addDays(new Date(invoice.issueDate), daysLate);
  await services.paymentsService.create(admin, createPaymentSchema.parse({
    invoiceId: invoice.id,
    method,
    amount: Math.round(invoice.amountDue * share),
    paymentDate: toIsoDate(date > today ? today : date),
    reference: `${method === 'UPI' ? 'UPI' : method === 'CARD' ? 'CARD' : 'NEFT'}-${invoice.number.slice(-6)}`,
    ...(share < 1 ? { note: 'Part payment; balance promised next week' } : {}),
  }));
}

export async function seedDemo(): Promise<void> {
  if (env.NODE_ENV === 'production') throw new Error('Demo seed is for development only');
  const auth = new AuthRepository();
  if (await auth.findUserByEmail(MARKER_EMAIL)) {
    logger.info('Demo data already present; nothing to do');
    return;
  }
  if (!env.ADMIN_EMAIL) throw new Error('Set ADMIN_EMAIL so the seed can act as the admin');
  const adminUser = await auth.findUserByEmail(env.ADMIN_EMAIL);
  if (!adminUser) throw new Error('Start the server once (or run db:seed) to create the admin first');

  const services = buildServices();
  const admin: Actor = { userId: adminUser.id, role: Role.ADMIN };
  const ctx: Seeder = { services, admin, today: businessToday() };
  const s = services;

  // ---- Catalog ----
  const gst18 = await s.taxesService.create(admin, createTaxSchema.parse({ name: 'GST 18%', type: 'PERCENTAGE', rate: 1800 }));
  const gst5 = await s.taxesService.create(admin, createTaxSchema.parse({ name: 'GST 5%', type: 'PERCENTAGE', rate: 500 }));
  await s.paymentTermsService.create(admin, createPaymentTermSchema.parse({ name: 'Due on receipt', dueDays: 0 }));
  const net15 = await s.paymentTermsService.create(admin, createPaymentTermSchema.parse({ name: 'Net 15', dueDays: 15 }));
  const net30 = await s.paymentTermsService.create(admin, createPaymentTermSchema.parse({ name: 'Net 30', dueDays: 30 }));

  const crm = await s.productsService.create(admin, createProductSchema.parse({
    name: 'Brightloop CRM', type: 'SOFTWARE', salesPrice: 149900, costPrice: 32000,
    notes: 'Per seat, per month. Pro adds automation and API access.',
    variants: [{ attribute: 'Edition', value: 'Standard', extraPrice: 0 }, { attribute: 'Edition', value: 'Pro', extraPrice: 80000 }],
  }));
  const crmStandard = crm.variants.find(v => v.value === 'Standard')!;
  const crmPro = crm.variants.find(v => v.value === 'Pro')!;
  const storage = await s.productsService.create(admin, createProductSchema.parse({
    name: 'Cloud Storage 100 GB', type: 'ADDON', salesPrice: 49900, costPrice: 12000, notes: 'Per 100 GB block, per month.',
  }));
  const support = await s.productsService.create(admin, createProductSchema.parse({
    name: 'Priority Support', type: 'SERVICE', salesPrice: 299900, costPrice: 140000, notes: '4-hour response, named account manager.',
  }));
  const analytics = await s.productsService.create(admin, createProductSchema.parse({
    name: 'Analytics Suite', type: 'SOFTWARE', salesPrice: 249900, costPrice: 60000, notes: 'Dashboards and scheduled reports.',
  }));

  const planBase = { availableFrom: '2026-01-01', closable: true, renewable: true };
  const starter = await s.plansService.create(admin, createPlanSchema.parse({
    ...planBase, name: 'Starter Monthly', description: 'For small teams getting started.', price: 149900,
    billingPeriod: 'MONTHLY', pausable: true,
  }));
  const business = await s.plansService.create(admin, createPlanSchema.parse({
    ...planBase, name: 'Business Monthly', description: 'For growing teams that need support.', price: 499900,
    billingPeriod: 'MONTHLY', pausable: true,
  }));
  const enterprise = await s.plansService.create(admin, createPlanSchema.parse({
    ...planBase, name: 'Enterprise Yearly', description: 'Annual contract with priority support.', price: 4999900,
    billingPeriod: 'YEARLY',
  }));
  const pilot = await s.plansService.create(admin, createPlanSchema.parse({
    ...planBase, name: 'Weekly Pilot', description: 'Short paid trial; ends automatically.', price: 99900,
    billingPeriod: 'WEEKLY', autoClose: true, renewable: false,
  }));

  await s.discountsService.create(admin, createDiscountSchema.parse({
    name: 'Launch offer 10%', code: 'LAUNCH10', type: 'PERCENTAGE', value: 1000, scope: 'PRODUCT',
    startDate: '2026-01-01', endDate: '2026-12-31', usageLimit: 100, productIds: [crm.id],
  }));
  const loyalty = await s.discountsService.create(admin, createDiscountSchema.parse({
    name: 'Annual loyalty credit', code: 'LOYAL2K', type: 'FIXED', value: 200000, scope: 'SUBSCRIPTION',
    minPurchase: 1000000, startDate: '2026-01-01',
  }));

  const starterBundle = await s.quotationTemplatesService.create(admin, createTemplateSchema.parse({
    name: 'Starter bundle', planId: starter.id, validityDays: 30, notes: 'CRM Standard with extra storage.',
    lines: [{ productId: crm.id, variantId: crmStandard.id, quantity: 2 }, { productId: storage.id, quantity: 1 }],
  }));
  await s.quotationTemplatesService.create(admin, createTemplateSchema.parse({
    name: 'Business bundle', planId: business.id, validityDays: 15, notes: 'CRM Pro, support and storage for 5 seats.',
    lines: [{ productId: crm.id, variantId: crmPro.id, quantity: 5 }, { productId: support.id, quantity: 1 }, { productId: storage.id, quantity: 5 }],
  }));

  // ---- People ----
  await s.staffService.create(admin, createStaffSchema.parse({
    name: 'Priya Nair', email: 'priya.nair@brightloop.example.com', username: 'priya', password: DEMO_PASSWORD,
  }));
  // Portal logins first: creating the customer afterwards links it to the matching user.
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const [name, email] of [['Anil Sharma', MARKER_EMAIL], ['Kavya Rao', 'kavya@kavyadesign.example.com']] as const) {
    await auth.createUser({ name, email, passwordHash, role: Role.CUSTOMER, emailVerified: true });
  }
  const customer = (input: Record<string, string>) => s.customersService.create(admin, createCustomerSchema.parse({ country: 'India', ...input }));
  const sharma = await customer({ name: 'Anil Sharma', companyName: 'Sharma Textiles Pvt Ltd', email: MARKER_EMAIL, phone: '+91 98200 14523', taxId: '27AABCS1429F1Z6', addressLine1: '14 Kalbadevi Road', city: 'Mumbai', state: 'Maharashtra', postalCode: '400002' });
  const kavya = await customer({ name: 'Kavya Rao', companyName: 'Kavya Design Studio', email: 'kavya@kavyadesign.example.com', phone: '+91 99860 31277', taxId: '29AAHFK8810L1ZQ', addressLine1: '22 Indiranagar 100 Feet Road', city: 'Bengaluru', state: 'Karnataka', postalCode: '560038' });
  const northwind = await customer({ name: 'Rohit Kulkarni', companyName: 'Northwind Logistics LLP', email: 'finance@northwindlogistics.example.com', phone: '+91 20 6712 4400', taxId: '27AAKFN5521C1Z2', addressLine1: 'Plot 7, Chakan MIDC Phase II', city: 'Pune', state: 'Maharashtra', postalCode: '410501' });
  const greenleaf = await customer({ name: 'Meera Joshi', companyName: 'Greenleaf Organics', email: 'meera@greenleaforganics.example.com', phone: '+91 94140 66218', addressLine1: '5 MI Road', city: 'Jaipur', state: 'Rajasthan', postalCode: '302001' });
  const orbit = await customer({ name: 'Arjun Reddy', companyName: 'Orbit Labs', email: 'arjun@orbitlabs.example.com', phone: '+91 90000 81920', city: 'Hyderabad', state: 'Telangana', postalCode: '500081' });
  const riverbank = await customer({ name: 'Dr. Sneha Menon', companyName: 'Riverbank Clinics', email: 'admin@riverbankclinics.example.com', phone: '+91 484 230 9911', city: 'Kochi', state: 'Kerala', postalCode: '682016' });

  // ---- Subscriptions ----
  const subscribe = async (input: Record<string, unknown>) => s.subscriptionsService.create(admin, createSubscriptionSchema.parse(input));
  const activate = async (id: number): Promise<void> => {
    await s.subscriptionsService.sendQuotation(admin, id);
    await s.subscriptionsService.confirm(admin, id);
    await s.subscriptionsService.activate(admin, id);
  };

  // Sharma: Business since July, paid July-September, October overdue (Net 15).
  const sharmaSub = await subscribe({
    customerId: sharma.id, planId: business.id, startDate: '2026-07-01', paymentTermId: net15.id,
    notes: 'Signed after a two-week pilot. Billing contact: accounts team.',
    lines: [
      { productId: crm.id, variantId: crmPro.id, taxId: gst18.id, quantity: 5 },
      { productId: support.id, taxId: gst18.id, quantity: 1 },
      { productId: storage.id, taxId: gst18.id, quantity: 5 },
    ],
  });
  await activate(sharmaSub.id);
  const sharmaInvoices = await billPeriods(ctx, sharmaSub.id);
  for (const invoice of sharmaInvoices.slice(0, -1)) await pay(ctx, invoice, 'BANK_TRANSFER', 9);

  // Kavya: Starter since mid-September, September paid, October part-paid (Net 30).
  const kavyaSub = await subscribe({
    customerId: kavya.id, planId: starter.id, startDate: '2026-09-15', paymentTermId: net30.id,
    lines: [
      { productId: crm.id, variantId: crmStandard.id, taxId: gst18.id, quantity: 2 },
      { productId: storage.id, taxId: gst18.id, quantity: 1 },
    ],
  });
  await activate(kavyaSub.id);
  const [kavyaSep, kavyaOct] = await billPeriods(ctx, kavyaSub.id);
  if (kavyaSep) await pay(ctx, kavyaSep, 'UPI', 3);
  if (kavyaOct) await pay(ctx, kavyaOct, 'UPI', 5, 0.5);

  // Kavya's August pilot: weekly, billed and paid, closed when she moved to Starter.
  const pilotSub = await subscribe({
    customerId: kavya.id, planId: pilot.id, startDate: '2026-08-01', expiryDate: '2026-08-29', paymentTermId: net15.id,
    notes: 'Paid pilot before the Starter plan.',
    lines: [{ productId: crm.id, variantId: crmStandard.id, taxId: gst18.id, quantity: 1 }],
  });
  await activate(pilotSub.id);
  for (const invoice of await billPeriods(ctx, pilotSub.id)) await pay(ctx, invoice, 'CARD', 1);
  await s.subscriptionsService.close(admin, pilotSub.id, closeSubscriptionSchema.parse({ reason: 'Pilot finished; moved to Starter Monthly' }));

  // Northwind: annual Enterprise contract from April with the loyalty credit, paid by cheque.
  const northwindSub = await subscribe({
    customerId: northwind.id, planId: enterprise.id, startDate: '2026-04-01', expiryDate: '2027-03-31', paymentTermId: net30.id,
    notes: 'Annual contract, PO NW/2026/0412.',
    lines: [
      { productId: crm.id, variantId: crmPro.id, taxId: gst18.id, quantity: 20 },
      { productId: analytics.id, taxId: gst18.id, quantity: 1 },
      { productId: support.id, taxId: gst18.id, quantity: 1 },
    ],
  });
  await s.discountsService.attachSubscriptions(admin, loyalty.id, [northwindSub.id]);
  await activate(northwindSub.id);
  for (const invoice of await billPeriods(ctx, northwindSub.id)) await pay(ctx, invoice, 'CHEQUE', 21);

  // Greenleaf: Starter from June, billed and paid for three months, then paused (seasonal business).
  const greenleafSub = await subscribe({
    customerId: greenleaf.id, planId: starter.id, startDate: '2026-06-10', paymentTermId: net15.id,
    notes: 'Seasonal; pauses during the monsoon months.',
    lines: [{ productId: crm.id, variantId: crmStandard.id, taxId: gst18.id, quantity: 1 }, { productId: storage.id, taxId: gst5.id, quantity: 1 }],
  });
  await activate(greenleafSub.id);
  for (const invoice of await billPeriods(ctx, greenleafSub.id, 3)) await pay(ctx, invoice, 'UPI', 2);
  await s.subscriptionsService.pause(admin, greenleafSub.id);

  // Orbit Labs: quotation sent from the Starter bundle, waiting for the customer.
  const orbitSub = await s.subscriptionsService.createFromTemplate(admin, createFromTemplateSchema.parse({
    templateId: starterBundle.id, customerId: orbit.id, startDate: toIsoDate(addDays(ctx.today, 7)), paymentTermId: net15.id,
  }));
  await s.subscriptionsService.sendQuotation(admin, orbitSub.id);

  // Riverbank Clinics: draft still being prepared.
  await subscribe({
    customerId: riverbank.id, planId: business.id, startDate: toIsoDate(addDays(ctx.today, 15)), paymentTermId: net30.id,
    notes: 'Waiting for the clinic to confirm seat count.',
    lines: [{ productId: crm.id, variantId: crmPro.id, taxId: gst18.id, quantity: 3 }, { productId: support.id, taxId: gst18.id, quantity: 1 }],
  });

  logger.info({
    customers: 6, staff: 1, portalLogins: [MARKER_EMAIL, 'kavya@kavyadesign.example.com'],
    sharmaInvoices: sharmaInvoices.length,
  }, `Demo data seeded. Demo staff and portal password: ${DEMO_PASSWORD}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await seedDemo();
  } finally {
    await Promise.allSettled([prisma.close(), closeKvStore()]);
  }
}
