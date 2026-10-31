/**
 * READ-ONLY. The portal owns no table. This repository only aggregates the customer's own
 * `Subscription` and `Invoice` rows for `GET /portal/summary`, the same documented
 * read-only exception as the reports repository (backend plan section 4). It never writes.
 * Every query carries the `customerId` condition itself.
 */

import { InvoiceStatus, SubscriptionStatus } from '@brightloop/shared';
import { and, type ModelAccessor } from '@prisma/orm-family-sql/orm-client';
import { prisma } from '../../config/prisma.js';
import type { Contract } from '../../prisma/contract.d.js';

export interface PortalSummaryRow {
  activeSubscriptions: number;
  /** Earliest `nextBillingDate` over the customer's ACTIVE subscriptions. */
  nextBillingDate: string | null;
  /** Sum of `amountDue` over CONFIRMED invoices. */
  outstandingAmount: number;
  overdueCount: number;
  overdueAmount: number;
}

type InvoiceAccessor = ModelAccessor<Contract, 'Invoice', 'public'>;
type SubscriptionAccessor = ModelAccessor<Contract, 'Subscription', 'public'>;

export class PortalRepository {
  /** Four independent aggregates in parallel. `today` is the business today at UTC midnight. */
  async summary(customerId: number, today: Date): Promise<PortalSummaryRow> {
    const active = (sub: SubscriptionAccessor) =>
      and(sub.customerId.eq(customerId), sub.status.eq(SubscriptionStatus.ACTIVE), sub.deletedAt.isNull());
    const unpaid = (invoice: InvoiceAccessor) =>
      and(invoice.customerId.eq(customerId), invoice.status.eq(InvoiceStatus.CONFIRMED), invoice.amountDue.gt(0));

    const [activeCount, next, outstanding, overdue] = await Promise.all([
      prisma.orm.public.Subscription.where(active).aggregate((agg) => ({ n: agg.count() })),
      prisma.orm.public.Subscription
        .where((sub) => and(active(sub), sub.nextBillingDate.isNotNull()))
        .orderBy([(sub) => sub.nextBillingDate.asc(), (sub) => sub.id.asc()])
        .limit(1)
        .all(),
      prisma.orm.public.Invoice.where(unpaid).aggregate((agg) => ({ amount: agg.sum('amountDue') })),
      prisma.orm.public.Invoice
        .where((invoice) => and(unpaid(invoice), invoice.dueDate.lt(today.toISOString())))
        .aggregate((agg) => ({ n: agg.count(), amount: agg.sum('amountDue') })),
    ]);

    return {
      activeSubscriptions: activeCount.n,
      nextBillingDate: next[0]?.nextBillingDate ?? null,
      outstandingAmount: Number(outstanding.amount ?? 0),
      overdueCount: overdue.n,
      overdueAmount: Number(overdue.amount ?? 0),
    };
  }
}
