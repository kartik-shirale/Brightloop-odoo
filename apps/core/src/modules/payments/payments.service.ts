import type { ListMeta, PaymentDto, PaymentListItemDto } from '@brightloop/shared';
import { forbidden, notFound, validationError } from '../../core/errors.js';
import {
  isAdmin, isCustomer, isStaffOrAdmin, requireCustomerId, type Actor,
} from '../../core/utils/actor.js';
import { businessToday } from '../../core/utils/dates.js';
import { invoiceNotPayable, overpayment, rethrowDbError } from '../../core/utils/domain-errors.js';
import { listMetaFor } from '../../core/utils/pagination.js';
import type { AuditGateway } from '../audit/audit.gateway.js';
import { toPaymentDto, toPaymentListItemDto } from './payments.dto.js';
import type {
  CreatePaymentOutcome, PaymentRecord, PaymentRow, PaymentScope, PaymentsRepository,
} from './payments.repository.js';
import type { CreatePaymentInput, ListPaymentsParams, UpdatePaymentInput } from './payments.schema.js';

const PAYMENT_NOT_FOUND = 'Payment not found';
const INVOICE_NOT_FOUND = 'Invoice not found';

/** A customer reads only their own payments on CONFIRMED or PAID invoices. */
function readScope(actor: Actor): PaymentScope {
  return isCustomer(actor) ? { customerId: requireCustomerId(actor), visibleInvoicesOnly: true } : {};
}

function paymentSnapshot(row: PaymentRow): Record<string, unknown> {
  return {
    id: row.id, invoiceId: row.invoiceId, customerId: row.customerId, method: row.method, amount: row.amount,
    paymentDate: row.paymentDate, reference: row.reference, note: row.note, recordedById: row.recordedById,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

export class PaymentsService {
  constructor(
    private readonly repository: PaymentsRepository,
    private readonly audit: AuditGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** ADMIN and STAFF see everything. A CUSTOMER actor is forced to their own customerId. */
  async list(actor: Actor, query: ListPaymentsParams): Promise<{ payments: PaymentListItemDto[]; meta: ListMeta }> {
    const scope = readScope(actor);
    const effective = scope.customerId === undefined ? query : { ...query, customerId: scope.customerId };
    const [rows, total] = await Promise.all([
      this.repository.list(effective, scope),
      this.repository.count(effective, scope),
    ]);
    return { payments: rows.map(toPaymentListItemDto), meta: listMetaFor(total, query.page, query.limit) };
  }

  /** Another customer's payment is a 404, so existence does not leak. */
  async get(actor: Actor, id: number): Promise<PaymentDto> {
    const row = await this.repository.findById(id, readScope(actor));
    if (row === null) throw notFound(PAYMENT_NOT_FOUND);
    return toPaymentDto(row);
  }

  /** ADMIN and STAFF. The balance and the payment row change in one repository transaction. */
  async create(actor: Actor, input: CreatePaymentInput, ip?: string): Promise<PaymentDto> {
    this.assertStaffOrAdmin(actor);
    if (input.paymentDate.getTime() > businessToday(this.now()).getTime()) {
      throw validationError('Validation failed', [{ field: 'paymentDate', message: 'paymentDate cannot be in the future' }]);
    }
    let outcome: CreatePaymentOutcome;
    try {
      outcome = await this.repository.create(input, actor.userId);
    } catch (error) {
      return rethrowDbError(error, { foreignKey: INVOICE_NOT_FOUND });
    }
    switch (outcome.kind) {
      case 'invoice-missing':
        throw notFound(INVOICE_NOT_FOUND);
      case 'not-payable':
        throw invoiceNotPayable(`Invoice is ${outcome.status} and cannot receive payments`);
      case 'overpayment':
        throw overpayment(`Payment amount exceeds the amount due (${outcome.amountDue} paise)`);
      case 'created':
        break;
    }
    const { payment, invoice } = outcome;
    await this.audit.record({
      actor, action: 'payment.create', entityType: 'Payment', entityId: payment.id, ip,
      metadata: {
        invoiceId: payment.invoiceId, invoiceNumber: payment.invoiceNumber, method: payment.method,
        amount: payment.amount, paymentDate: payment.paymentDate, reference: payment.reference,
        invoiceStatusAfter: invoice.status, amountDueAfter: invoice.amountDue,
      },
    });
    return toPaymentDto(payment);
  }

  /** ADMIN and STAFF. Only `reference` and `note` change. */
  async update(actor: Actor, id: number, patch: UpdatePaymentInput, ip?: string): Promise<PaymentDto> {
    this.assertStaffOrAdmin(actor);
    const existing = await this.repository.findById(id);
    if (existing === null) throw notFound(PAYMENT_NOT_FOUND);
    const row = await this.repository.update(id, patch);
    if (row === null) throw notFound(PAYMENT_NOT_FOUND);
    await this.audit.record({
      actor, action: 'payment.update', entityType: 'Payment', entityId: id, ip,
      metadata: {
        invoiceId: existing.invoiceId, changes: patch,
        previous: {
          ...(patch.reference !== undefined ? { reference: existing.reference } : {}),
          ...(patch.note !== undefined ? { note: existing.note } : {}),
        },
      },
    });
    return toPaymentDto(row);
  }

  /** ADMIN only. Reverses the balance; the full deleted payment is kept in the audit metadata. */
  async remove(actor: Actor, id: number, ip?: string): Promise<void> {
    if (!isAdmin(actor)) throw forbidden('Only an administrator can delete a payment');
    const existing: PaymentRecord | null = await this.repository.findById(id);
    if (existing === null) throw notFound(PAYMENT_NOT_FOUND);
    const result = await this.repository.remove(id);
    if (result === null) throw notFound(PAYMENT_NOT_FOUND);
    await this.audit.record({
      actor, action: 'payment.delete', entityType: 'Payment', entityId: id, ip,
      metadata: {
        payment: paymentSnapshot(result.payment),
        invoiceNumber: existing.invoiceNumber,
        invoiceStatusAfter: result.invoice.status,
        amountDueAfter: result.invoice.amountDue,
      },
    });
  }

  private assertStaffOrAdmin(actor: Actor): void {
    if (!isStaffOrAdmin(actor)) throw forbidden('You do not have permission to change payments');
  }
}
