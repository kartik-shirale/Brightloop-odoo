import { prisma } from './config/prisma.js';

const orm = prisma.orm.public;
try {
  const subs = await orm.Subscription.where((s) => s.number.ilike('SPIKE-M10%')).all();
  const subIds = subs.map((s) => s.id);
  const customers = await orm.Customer.where((c) => c.name.eq('SPIKE-M10')).all();
  const customerIds = customers.map((c) => c.id);
  const found = { subs: subIds.length, customers: customerIds.length, invoices: 0 };
  if (subIds.length > 0) {
    const invoices = await orm.Invoice.where((i) => i.subscriptionId.in(subIds)).all();
    found.invoices = invoices.length;
    const invoiceIds = invoices.map((i) => i.id);
    if (invoiceIds.length > 0) {
      await orm.DiscountUsage.where((u) => u.invoiceId.in(invoiceIds)).deleteAll();
      await orm.InvoiceLine.where((l) => l.invoiceId.in(invoiceIds)).deleteAll();
      await orm.Invoice.where((i) => i.id.in(invoiceIds)).deleteAll();
    }
    await orm.DiscountUsage.where((u) => u.subscriptionId.in(subIds)).deleteAll();
    await orm.SubscriptionLine.where((l) => l.subscriptionId.in(subIds)).deleteAll();
    await orm.Subscription.where((s) => s.id.in(subIds)).deleteAll();
  }
  await orm.Discount.where((d) => d.name.eq('SPIKE-M10')).deleteAll();
  await orm.Product.where((p) => p.name.eq('SPIKE-M10')).deleteAll();
  await orm.Plan.where((p) => p.name.eq('SPIKE-M10')).deleteAll();
  if (customerIds.length > 0) await orm.Customer.where((c) => c.id.in(customerIds)).deleteAll();
  await orm.NumberSequence.where((n) => n.key.eq('INVOICE')).deleteAll();
  const left = {
    customers: (await orm.Customer.where((c) => c.name.ilike('%spike-m10%')).all()).length,
    plans: (await orm.Plan.where((p) => p.name.ilike('%spike-m10%')).all()).length,
    products: (await orm.Product.where((p) => p.name.ilike('%spike-m10%')).all()).length,
    discounts: (await orm.Discount.where((d) => d.name.ilike('%spike-m10%')).all()).length,
    subs: (await orm.Subscription.where((s) => s.number.ilike('%spike-m10%')).all()).length,
    invoices: (await orm.Invoice.where((i) => i.customerName.ilike('%spike-m10%')).all()).length,
    sequenceRows: (await orm.NumberSequence.where((n) => n.key.eq('INVOICE')).all()).length,
    allInvoices: (await orm.Invoice.where((i) => i.id.gt(0)).aggregate((a) => ({ n: a.count() }))).n,
  };
  console.log(JSON.stringify({ found, left }));
} finally {
  await prisma.close();
}
