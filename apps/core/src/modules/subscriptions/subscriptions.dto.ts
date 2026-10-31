import {
  SubscriptionAction, SubscriptionStatus,
  type PaymentTermDto, type SubscriptionDiscountDto, type SubscriptionDto, type SubscriptionInvoiceSummaryDto,
  type SubscriptionLineDto, type SubscriptionListItemDto, type SubscriptionStatusHistoryDto,
} from '@brightloop/shared';
import { isAdmin, isCustomer, type Actor } from '../../core/utils/actor.js';
import type {
  CustomerLabel, InvoiceSummaryRow, Labels, PaymentTermLabel, PlanLabel, StatusHistoryRow,
  SubscriptionLineRow, SubscriptionRow,
} from './subscriptions.repository.js';

export type TransitionAction = 'SEND_QUOTATION' | 'CONFIRM' | 'ACTIVATE' | 'PAUSE' | 'RESUME' | 'CLOSE' | 'RENEW';

const { DRAFT, QUOTATION, CONFIRMED, ACTIVE, PAUSED, CLOSED } = SubscriptionStatus;

/** The state machine (backend plan section 1): the statuses each workflow action may start from. */
export const ACTION_SOURCES: Record<TransitionAction, readonly SubscriptionStatus[]> = {
  SEND_QUOTATION: [DRAFT],
  CONFIRM: [QUOTATION],
  ACTIVATE: [CONFIRMED],
  PAUSE: [ACTIVE],
  RESUME: [PAUSED],
  CLOSE: [DRAFT, QUOTATION, CONFIRMED, ACTIVE, PAUSED],
  RENEW: [ACTIVE, CLOSED],
};

type PlanFlags = Pick<PlanLabel, 'pausable' | 'closable' | 'renewable'>;

const CUSTOMER_ACTIONS: readonly SubscriptionAction[] = [
  SubscriptionAction.PAUSE, SubscriptionAction.RESUME, SubscriptionAction.CLOSE, SubscriptionAction.RENEW,
];

/** Actions the actor may take now, from the state machine, the plan flags and the actor's role. */
export function allowedActionsFor(
  status: SubscriptionStatus,
  plan: PlanFlags | undefined,
  actor: Actor,
): SubscriptionAction[] {
  const flags: PlanFlags = plan ?? { pausable: false, closable: false, renewable: false };
  const actions: SubscriptionAction[] = [SubscriptionAction.EDIT];
  switch (status) {
    case DRAFT:
      actions.push(SubscriptionAction.SEND_QUOTATION, SubscriptionAction.CLOSE);
      if (isAdmin(actor)) actions.push(SubscriptionAction.DELETE);
      break;
    case QUOTATION:
      actions.push(SubscriptionAction.CONFIRM, SubscriptionAction.CLOSE);
      break;
    case CONFIRMED:
      actions.push(SubscriptionAction.ACTIVATE, SubscriptionAction.CLOSE);
      break;
    case ACTIVE:
      if (flags.pausable) actions.push(SubscriptionAction.PAUSE);
      if (flags.closable) actions.push(SubscriptionAction.CLOSE);
      if (flags.renewable) actions.push(SubscriptionAction.RENEW);
      actions.push(SubscriptionAction.GENERATE_INVOICE);
      break;
    case PAUSED:
      actions.push(SubscriptionAction.RESUME);
      if (flags.closable) actions.push(SubscriptionAction.CLOSE);
      break;
    case CLOSED:
      if (flags.renewable) actions.push(SubscriptionAction.RENEW);
      break;
  }
  return isCustomer(actor) ? actions.filter((action) => CUSTOMER_ACTIONS.includes(action)) : actions;
}

export function toLineDto(row: SubscriptionLineRow, labels: Labels): SubscriptionLineDto {
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    productId: row.productId,
    productName: labels.products.get(row.productId) ?? `Product #${row.productId}`,
    variantId: row.variantId,
    variantLabel: row.variantId === null ? null : labels.variants.get(row.variantId) ?? null,
    taxId: row.taxId,
    taxName: row.taxId === null ? null : labels.taxes.get(row.taxId) ?? null,
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    taxRate: row.taxRate,
    taxAmount: row.taxAmount,
    amount: row.amount,
    sortOrder: row.sortOrder,
  };
}

export function toHistoryDto(row: StatusHistoryRow, labels: Labels): SubscriptionStatusHistoryDto {
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    changedById: row.changedById,
    changedByName: row.changedById === null ? null : labels.users.get(row.changedById) ?? null,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

export function toListItemDto(
  row: SubscriptionRow,
  labels: Labels,
  actor: Actor,
  lines?: SubscriptionLineDto[],
): SubscriptionListItemDto {
  const plan = labels.plans.get(row.planId);
  return {
    id: row.id,
    number: row.number,
    customerId: row.customerId,
    customerName: labels.customers.get(row.customerId)?.name ?? '',
    planId: row.planId,
    planName: plan?.name ?? '',
    templateId: row.templateId,
    paymentTermId: row.paymentTermId,
    status: row.status,
    startDate: row.startDate,
    expiryDate: row.expiryDate,
    quotationValidUntil: row.quotationValidUntil,
    nextBillingDate: row.nextBillingDate,
    lastBilledUntil: row.lastBilledUntil,
    confirmedAt: row.confirmedAt,
    activatedAt: row.activatedAt,
    pausedAt: row.pausedAt,
    closedAt: row.closedAt,
    closeReason: row.closeReason,
    renewedFromId: row.renewedFromId,
    subtotal: row.subtotal,
    taxTotal: row.taxTotal,
    total: row.total,
    recurringAmount: row.recurringAmount,
    notes: row.notes,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    allowedActions: allowedActionsFor(row.status, plan, actor),
    ...(lines === undefined ? {} : { lines }),
  };
}

export interface DetailParts {
  lines: SubscriptionLineRow[];
  history: StatusHistoryRow[];
  discounts: SubscriptionDiscountDto[];
  invoices: InvoiceSummaryRow[];
  paymentTerm: PaymentTermLabel | null;
}

function toPaymentTermDto(term: PaymentTermLabel): PaymentTermDto {
  return {
    id: term.id, name: term.name, dueDays: term.dueDays, isDefault: term.isDefault, isActive: term.isActive,
    createdAt: term.createdAt, updatedAt: term.updatedAt,
  };
}

function toInvoiceSummaryDto(row: InvoiceSummaryRow): SubscriptionInvoiceSummaryDto {
  return {
    id: row.id, number: row.number, status: row.status, total: row.total, issueDate: row.issueDate, dueDate: row.dueDate,
  };
}

export function toSubscriptionDto(
  row: SubscriptionRow,
  labels: Labels,
  actor: Actor,
  parts: DetailParts,
): SubscriptionDto {
  const customer: CustomerLabel = labels.customers.get(row.customerId)
    ?? { id: row.customerId, name: '', companyName: null, email: '' };
  const plan = labels.plans.get(row.planId);
  const lines = parts.lines.map((line) => toLineDto(line, labels));
  return {
    ...toListItemDto(row, labels, actor, lines),
    customer: { id: customer.id, name: customer.name, companyName: customer.companyName, email: customer.email },
    plan: { id: row.planId, name: plan?.name ?? '', billingPeriod: plan?.billingPeriod ?? 'MONTHLY' },
    paymentTerm: parts.paymentTerm === null ? null : toPaymentTermDto(parts.paymentTerm),
    lines,
    statusHistory: parts.history.map((entry) => toHistoryDto(entry, labels)),
    discounts: parts.discounts,
    invoices: parts.invoices.map(toInvoiceSummaryDto),
  };
}
