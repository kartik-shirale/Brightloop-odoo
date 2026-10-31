/** Compile-only regression checks, including intentional invalid consumer input. */
import {
  BillingPeriod, InvoiceStatus, Role, SubscriptionAction, SubscriptionStatus,
  type ApiContracts, type ApiFailure, type ApiListSuccess, type ApiSuccess,
  type AuthResult, type CreateCustomerRequest, type CreateDiscountRequest,
  type CreatePaymentRequest, type CreateProductRequest, type CreateStaffRequest,
  type CreateSubscriptionRequest, type CreateTaxRequest, type DiscountDto,
  type InvoiceDto, type InvoicePrintDto, type ListBillingRunsQuery,
  type ListInvoicesQuery, type ListPortalInvoicesQuery, type ListPortalSubscriptionsQuery,
  type LoginDto, type LoginRequest, type Paise, type PortalInvoiceDto,
  type PortalProfileDto, type PortalSubscriptionDto, type ProductAdminDto,
  type ProductDto, type ProductDtoFor, type ProposedApiContracts,
  type RequestBodyFor, type RequestFor, type RequestParamsFor, type ResponseFor,
  type ResponseDataFor, type StaffDto, type SubscriptionDto, type SubscriptionLineInput,
  type SuccessResponseFor, type TaxDto, type UpdateCustomerRequest,
  type UpdatePaymentRequest, type UpdatePortalProfileRequest,
  type UpdateSubscriptionRequest, type UserDto,
} from '../src/index.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type HasNo<T, K extends PropertyKey> = Extract<keyof T, K> extends never ? true : false;
export type ContractAssertions = [
  Assert<Equal<LoginRequest, LoginDto>>,
  Assert<HasNo<UserDto, 'passwordHash' | 'deletedAt'>>,
  Assert<Equal<StaffDto['role'], 'STAFF'>>,
  Assert<HasNo<CreateStaffRequest, 'role' | 'isActive' | 'emailVerifiedAt'>>,
  Assert<HasNo<CreateCustomerRequest, 'userId'>>,
  Assert<HasNo<CreateDiscountRequest, 'usedCount'>>,
  Assert<HasNo<CreatePaymentRequest, 'customerId' | 'recordedById'>>,
  Assert<HasNo<UpdatePaymentRequest, 'invoiceId' | 'amount' | 'paymentDate'>>,
  Assert<HasNo<SubscriptionLineInput, 'unitPrice' | 'taxRate' | 'amount'>>,
  Assert<HasNo<UpdateSubscriptionRequest, 'status' | 'number' | 'subtotal' | 'total' | 'createdById'>>,
  Assert<HasNo<ProductDto, 'costPrice'>>,
  Assert<Equal<ProductDtoFor<'ADMIN'>, ProductAdminDto>>,
  Assert<Equal<ProductDtoFor<'STAFF'>, ProductDto>>,
  Assert<HasNo<PortalProfileDto, 'userId' | 'notes'>>,
  Assert<HasNo<UpdatePortalProfileRequest, 'email' | 'userId' | 'notes'>>,
  Assert<HasNo<PortalSubscriptionDto, 'notes' | 'createdById' | 'statusHistory' | 'customerId'>>,
  Assert<HasNo<PortalInvoiceDto, 'notes' | 'createdById' | 'billingRunId' | 'cancelReason'>>,
  Assert<HasNo<InvoicePrintDto, 'notes' | 'createdById' | 'billingRunId'>>,
  Assert<Equal<Extract<PortalInvoiceDto['status'], 'DRAFT' | 'CANCELLED'>, never>>,
  Assert<Equal<Extract<PortalSubscriptionDto['status'], 'DRAFT'>, never>>,
  Assert<Equal<Extract<PortalSubscriptionDto['allowedActions'][number], 'ACTIVATE' | 'DELETE'>, never>>,
  Assert<Equal<SubscriptionDto['allowedActions'][number], SubscriptionAction>>,
  Assert<Equal<RequestBodyFor<'POST /api/v1/subscriptions'>, CreateSubscriptionRequest>>,
  Assert<Equal<ResponseDataFor<'POST /api/v1/invoices/generate'>, InvoiceDto>>,
  Assert<Equal<SuccessResponseFor<'GET /api/v1/taxes'>, ApiListSuccess<TaxDto>>>,
  Assert<Equal<RequestParamsFor<'PATCH /api/v1/products/:productId/variants/:variantId'>, { productId: number; variantId: number }>>,
  Assert<Equal<Extract<keyof ApiContracts, 'DELETE /api/v1/invoices/:id'>, never>>,
  Assert<Equal<Extract<keyof ApiContracts, 'GET /api/v1/discounts/:id/subscriptions'>, never>>,
  Assert<Equal<keyof ProposedApiContracts, 'GET /api/v1/discounts/:id/subscriptions'>>,
  Assert<Equal<DiscountDto['usedCount'], number>>,
  Assert<Equal<Paise, number>>,
];

// A backend mapper can return exactly the same payload a frontend API client consumes.
export const taxPayload = {
  id: 1, name: 'GST 18%', type: 'PERCENTAGE', rate: 1800, isActive: true,
  createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z',
} satisfies TaxDto;
export const backendResponse = { success: true, message: 'Tax fetched', data: taxPayload } satisfies SuccessResponseFor<'GET /api/v1/taxes/:id'>;
export const frontendResponse: ApiSuccess<TaxDto> = backendResponse;
export const createTax = { name: 'GST 18%', type: 'PERCENTAGE', rate: 1800 } satisfies CreateTaxRequest;
export const invoiceQuery = { status: [InvoiceStatus.CONFIRMED], overdue: true, sortBy: 'dueDate', sortOrder: 'asc' } satisfies ListInvoicesQuery;
export const createSubscription = {
  customerId: 1, planId: 2, startDate: '2026-11-05',
  lines: [{ productId: 3, quantity: 1, taxId: null }],
} satisfies RequestBodyFor<'POST /api/v1/subscriptions'>;
export const subscriptionRequest = { body: createSubscription } satisfies RequestFor<'POST /api/v1/subscriptions'>;
export const variantRequest = { params: { productId: 1, variantId: 2 }, body: { extraPrice: 100 } } satisfies RequestFor<'PATCH /api/v1/products/:productId/variants/:variantId'>;
export const clearNullable = { notes: null, phone: null } satisfies UpdateCustomerRequest;
export const renew = { params: { id: 1 } } satisfies RequestFor<'POST /api/v1/subscriptions/:id/renew'>;
export const refresh = {} satisfies RequestFor<'POST /api/v1/auth/refresh'>;
export const emptyListQuery = {} satisfies RequestFor<'GET /api/v1/invoices'>;
export const validationFailure = { success: false, message: 'Invalid', error: { code: 'VALIDATION_ERROR', details: [{ field: 'name', message: 'Required' }] } } satisfies ApiFailure;
export const diagnosticFailure = { success: false, message: 'Internal error', error: { code: 'INTERNAL_ERROR', details: { fingerprint: 'abc123' } } } satisfies ApiFailure;
export const wireEnums = [Role.ADMIN, BillingPeriod.MONTHLY, SubscriptionStatus.ACTIVE];

// These must keep failing; a disappearing error indicates a widened/unsafe contract.
// @ts-expect-error A customer cannot request another customer's scope.
export const foreignScope: ListPortalInvoicesQuery = { customerId: 99 };
// @ts-expect-error Drafts are never visible in portal subscriptions.
export const portalDrafts: ListPortalSubscriptionsQuery = { status: ['DRAFT'] };
// @ts-expect-error Cancelled invoices are never visible in the portal.
export const portalCancelled: ListPortalInvoicesQuery = { status: ['CANCELLED'] };
// @ts-expect-error Roles are assigned by the server.
export const privilegedSignup: CreateStaffRequest = { name: 'Staff', email: 's@example.com', password: 'Password!9', role: 'ADMIN' };
// @ts-expect-error A payment cannot change its amount after creation.
export const alterPayment: UpdatePaymentRequest = { amount: 100 };
// @ts-expect-error Product prices are numeric paise, not decimal strings.
export const decimalProduct: CreateProductRequest = { name: 'Test', type: 'SERVICE', salesPrice: '9.99', costPrice: 0 };
// @ts-expect-error Runtime timestamp serialization must happen before building a DTO.
export const dateObject: TaxDto = { ...taxPayload, createdAt: new Date() };
// @ts-expect-error Wrong nested parameter name.
export const badVariantParams: RequestFor<'PATCH /api/v1/products/:productId/variants/:variantId'> = { params: { id: 1 }, body: {} };
// @ts-expect-error Preview requires subscriptionId.
export const missingPreviewQuery: RequestFor<'GET /api/v1/invoices/preview'> = {};
// @ts-expect-error Lists cannot accept arbitrary sorting columns.
export const invalidSort: ListInvoicesQuery = { sortBy: 'passwordHash' };
// @ts-expect-error Billing runs have startedAt, not createdAt.
export const missingSchemaField: ListBillingRunsQuery = { sortBy: 'createdAt' };
// @ts-expect-error List responses always contain pagination metadata.
export const noPagination: ApiListSuccess<TaxDto> = { success: true, message: 'Fetched', data: [] };
// @ts-expect-error Required payload must not disappear into optional data.
export const missingPayload: ApiSuccess<AuthResult> = { success: true, message: 'Logged in' };
// @ts-expect-error Private user linking is server-owned.
export const linkCustomer: CreateCustomerRequest = { name: 'A', email: 'a@example.com', userId: 1 };
// @ts-expect-error A GET has no JSON request body.
export const getWithBody: RequestFor<'GET /api/v1/taxes'> = { body: {} };
// @ts-expect-error Unknown methods/paths are rejected by endpoint helpers.
export type UnsupportedEndpoint = ResponseFor<'DELETE /api/v1/invoices/:id'>;
