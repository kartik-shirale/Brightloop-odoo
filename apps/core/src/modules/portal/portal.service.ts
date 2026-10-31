import {
  Role,
  type ListMeta, type PortalInvoiceDto, type PortalInvoiceListItemDto, type PortalInvoicePrintDto,
  type PortalPaymentDto, type PortalProfileDto, type PortalSubscriptionDto, type PortalSubscriptionListItemDto,
  type PortalSummaryDto, type RoleDto, type SubscriptionDto,
} from '@brightloop/shared';
import { forbidden } from '../../core/errors.js';
import type { Actor } from '../../core/utils/actor.js';
import { businessToday } from '../../core/utils/dates.js';
import type { CustomerRecord, CustomersGateway } from '../customers/customers.gateway.js';
import type { CustomersService } from '../customers/customers.service.js';
import type { InvoicesService } from '../invoices/invoices.service.js';
import type { PaymentsService } from '../payments/payments.service.js';
import type { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import {
  toPortalInvoiceDto, toPortalInvoiceListItemDto, toPortalInvoicePrintDto, toPortalPaymentDto, toPortalProfileDto,
  toPortalSubscriptionDto, toPortalSubscriptionListItemDto, toPortalSummaryDto,
} from './portal.dto.js';
import type { PortalSummaryRow } from './portal.repository.js';
import type {
  ListPortalInvoicesParams, ListPortalPaymentsParams, ListPortalSubscriptionsParams, PortalCloseSubscriptionInput,
  UpdatePortalProfileInput,
} from './portal.schema.js';

/** Invoices shown on the subscription detail page; the invoice list has the full history. */
const RECENT_INVOICES = 5;

/** The authenticated account calling the portal. The customer id is never taken from the request. */
export interface PortalCaller {
  userId: number;
  role: RoleDto;
  /** Login email of the account, shown on the profile. */
  email: string;
}

/**
 * The slices of the owning services the portal calls. Each already scopes a CUSTOMER actor
 * inside its queries (own rows only, no DRAFT subscriptions, CONFIRMED or PAID invoices only).
 */
export type PortalCustomersPort = Pick<CustomersGateway, 'getOrCreateForUser'> & Pick<CustomersService, 'updateOwnProfile'>;
export type PortalSubscriptionsPort = Pick<SubscriptionsService, 'list' | 'get' | 'pause' | 'resume' | 'close' | 'renew'>;
export type PortalInvoicesPort = Pick<InvoicesService, 'list' | 'get' | 'print'>;
export type PortalPaymentsPort = Pick<PaymentsService, 'list'>;
export interface PortalSummaryReader {
  summary(customerId: number, today: Date): Promise<PortalSummaryRow>;
}

/**
 * Customer self-service. Holds no business rules of its own: it resolves the caller's
 * customer through `getOrCreateForUser`, builds a CUSTOMER actor carrying that id, calls the
 * owning service, and maps the result through an explicit portal allowlist. Ownership, plan
 * flags, state transitions and audit entries stay in the owning services.
 */
export class PortalService {
  constructor(
    private readonly customers: PortalCustomersPort,
    private readonly subscriptions: PortalSubscriptionsPort,
    private readonly invoices: PortalInvoicesPort,
    private readonly payments: PortalPaymentsPort,
    private readonly summaries: PortalSummaryReader,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  // ------------------------------------------------------------- profile

  async getProfile(caller: PortalCaller): Promise<PortalProfileDto> {
    const { customer } = await this.resolve(caller);
    return toPortalProfileDto(customer, caller.email);
  }

  /** Email is not changeable here. The customers service writes the audit entry. */
  async updateProfile(caller: PortalCaller, input: UpdatePortalProfileInput, ip?: string): Promise<PortalProfileDto> {
    const { actor } = await this.resolve(caller);
    const customer = await this.customers.updateOwnProfile(actor, input, ip);
    return toPortalProfileDto(customer, caller.email);
  }

  // ------------------------------------------------------------- summary

  async summary(caller: PortalCaller): Promise<PortalSummaryDto> {
    const { customer } = await this.resolve(caller);
    return toPortalSummaryDto(await this.summaries.summary(customer.id, businessToday(this.clock())));
  }

  // ------------------------------------------------------- subscriptions

  async listSubscriptions(
    caller: PortalCaller,
    query: ListPortalSubscriptionsParams,
  ): Promise<{ subscriptions: PortalSubscriptionListItemDto[]; meta: ListMeta }> {
    const { actor } = await this.resolve(caller);
    const result = await this.subscriptions.list(actor, {
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.planId === undefined ? {} : { planId: query.planId }),
    });
    return { subscriptions: result.subscriptions.map(toPortalSubscriptionListItemDto), meta: result.meta };
  }

  async getSubscription(caller: PortalCaller, id: number): Promise<PortalSubscriptionDto> {
    const { actor } = await this.resolve(caller);
    return this.withRecentInvoices(actor, await this.subscriptions.get(actor, id));
  }

  async pauseSubscription(caller: PortalCaller, id: number, ip?: string): Promise<PortalSubscriptionDto> {
    const { actor } = await this.resolve(caller);
    return this.withRecentInvoices(actor, await this.subscriptions.pause(actor, id, ip));
  }

  async resumeSubscription(caller: PortalCaller, id: number, ip?: string): Promise<PortalSubscriptionDto> {
    const { actor } = await this.resolve(caller);
    return this.withRecentInvoices(actor, await this.subscriptions.resume(actor, id, ip));
  }

  async closeSubscription(
    caller: PortalCaller,
    id: number,
    input: PortalCloseSubscriptionInput,
    ip?: string,
  ): Promise<PortalSubscriptionDto> {
    const { actor } = await this.resolve(caller);
    const closed = await this.subscriptions.close(actor, id, input.reason === undefined ? {} : { reason: input.reason }, ip);
    return this.withRecentInvoices(actor, closed);
  }

  /** The customer's request is the approval, so the renewal is created ACTIVE (auto-activate path). */
  async renewSubscription(caller: PortalCaller, id: number, ip?: string): Promise<PortalSubscriptionDto> {
    const { actor } = await this.resolve(caller);
    const renewed = await this.subscriptions.renew(actor, id, {}, { autoActivate: true, ip });
    return this.withRecentInvoices(actor, renewed);
  }

  // ------------------------------------------------------------ invoices

  async listInvoices(
    caller: PortalCaller,
    query: ListPortalInvoicesParams,
  ): Promise<{ invoices: PortalInvoiceListItemDto[]; meta: ListMeta }> {
    const { actor } = await this.resolve(caller);
    const result = await this.invoices.list(actor, {
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.overdue === undefined ? {} : { overdue: query.overdue }),
      ...(query.outstanding === undefined ? {} : { outstanding: query.outstanding }),
      ...(query.subscriptionId === undefined ? {} : { subscriptionId: query.subscriptionId }),
      ...(query.issueFrom === undefined ? {} : { issueFrom: query.issueFrom }),
      ...(query.issueTo === undefined ? {} : { issueTo: query.issueTo }),
      ...(query.dueFrom === undefined ? {} : { dueFrom: query.dueFrom }),
      ...(query.dueTo === undefined ? {} : { dueTo: query.dueTo }),
    });
    return { invoices: result.invoices.map(toPortalInvoiceListItemDto), meta: result.meta };
  }

  async getInvoice(caller: PortalCaller, id: number): Promise<PortalInvoiceDto> {
    const { actor } = await this.resolve(caller);
    return toPortalInvoiceDto(await this.invoices.get(actor, id));
  }

  async printInvoice(caller: PortalCaller, id: number): Promise<PortalInvoicePrintDto> {
    const { actor } = await this.resolve(caller);
    return toPortalInvoicePrintDto(await this.invoices.print(actor, id));
  }

  // ------------------------------------------------------------ payments

  async listPayments(
    caller: PortalCaller,
    query: ListPortalPaymentsParams,
  ): Promise<{ payments: PortalPaymentDto[]; meta: ListMeta }> {
    const { actor } = await this.resolve(caller);
    const result = await this.payments.list(actor, {
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      ...(query.invoiceId === undefined ? {} : { invoiceId: query.invoiceId }),
      ...(query.method === undefined ? {} : { method: query.method }),
      ...(query.paidFrom === undefined ? {} : { paidFrom: query.paidFrom }),
      ...(query.paidTo === undefined ? {} : { paidTo: query.paidTo }),
    });
    return { payments: result.payments.map(toPortalPaymentDto), meta: result.meta };
  }

  // ------------------------------------------------------------- helpers

  /**
   * The CUSTOMER actor for this caller. The customer id always comes from
   * `getOrCreateForUser`, never from the request. Routes already require CUSTOMER;
   * this is the service-layer check.
   */
  private async resolve(caller: PortalCaller): Promise<{ actor: Actor; customer: CustomerRecord }> {
    if (caller.role !== Role.CUSTOMER) throw forbidden('Only customer accounts can use the portal');
    const customer = await this.customers.getOrCreateForUser(caller.userId);
    return { actor: { userId: caller.userId, role: caller.role, customerId: customer.id }, customer };
  }

  private async withRecentInvoices(actor: Actor, subscription: SubscriptionDto): Promise<PortalSubscriptionDto> {
    const recent = await this.invoices.list(actor, {
      page: 1, limit: RECENT_INVOICES, sortBy: 'issueDate', sortOrder: 'desc', subscriptionId: subscription.id,
    });
    return toPortalSubscriptionDto(subscription, recent.invoices.map(toPortalInvoiceListItemDto));
  }
}
