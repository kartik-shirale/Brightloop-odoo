/**
 * Contract registry, NOT a claim that planned routes are implemented.
 * Keys include the HTTP method and full v1 path. Params are validated numeric IDs.
 * Both API clients and handlers may use RequestBodyFor/ResponseDataFor directly.
 */
import type { ApiFailure, ApiListSuccess, ApiMessageSuccess, ApiSuccess } from './common.js';
import type { ApiError } from './api.js';
import type * as Auth from './auth.js';
import type * as Audit from './audit.js';
import type * as Taxes from './taxes.js';
import type * as Terms from './payment-terms.js';
import type * as Products from './products.js';
import type * as Plans from './plans.js';
import type * as Staff from './staff.js';
import type * as Customers from './customers.js';
import type * as Discounts from './discounts.js';
import type * as Templates from './quotation-templates.js';
import type * as Subscriptions from './subscriptions.js';
import type * as Invoices from './invoices.js';
import type * as Payments from './payments.js';
import type * as Billing from './billing-runs.js';
import type * as Portal from './portal.js';
import type * as Reports from './reports.js';
import type { Role } from './enums.js';

interface Endpoint<Q = never, B = never, R = ApiMessageSuccess> {
  query: Q;
  body: B;
  response: R;
}
type Read<D> = Endpoint<never, never, ApiSuccess<D>>;
type List<D, Q> = Endpoint<Q, never, ApiListSuccess<D>>;
type Write<B, D> = Endpoint<never, B, ApiSuccess<D>>;
type Action<D> = Read<D>;
type Remove = Endpoint;

/** Explicit endpoints prevent inventing unsupported CRUD operations (e.g. invoice DELETE). */
export interface ApiContracts {
  'POST /api/v1/auth/register': Write<Auth.RegisterRequest, Auth.RegisterResultDto>;
  'POST /api/v1/auth/verify-otp': Write<Auth.VerifyOtpRequest, Auth.AuthResult>;
  'POST /api/v1/auth/resend-otp': Write<Auth.ResendOtpRequest, Auth.OtpResultDto>;
  'POST /api/v1/auth/login': Write<Auth.LoginRequest, Auth.AuthResult>;
  'POST /api/v1/auth/refresh': Write<Auth.RefreshRequest, Auth.AuthResult>;
  'POST /api/v1/auth/logout': Endpoint<never, Auth.LogoutRequest>;
  'POST /api/v1/auth/logout-all': Endpoint;
  'POST /api/v1/auth/forgot-password': Write<Auth.ForgotPasswordRequest, Auth.OtpResultDto>;
  'POST /api/v1/auth/verify-reset-otp': Write<Auth.VerifyResetOtpRequest, Auth.VerifyResetOtpResultDto>;
  'POST /api/v1/auth/reset-password': Endpoint<never, Auth.ResetPasswordRequest>;
  'GET /api/v1/auth/sessions': List<Auth.SessionDto, Auth.ListSessionsQuery>;
  'DELETE /api/v1/auth/sessions/:id': Remove;
  'GET /api/v1/users': List<Auth.UserDto, Auth.ListUsersQuery>;
  'GET /api/v1/users/stats': Read<Auth.UserStatsDto>;
  'GET /api/v1/users/me': Read<Auth.UserDto>;
  'PATCH /api/v1/users/me': Write<Auth.UpdateMeRequest, Auth.UserDto>;
  'POST /api/v1/users/me/password': Endpoint<never, Auth.ChangePasswordRequest>;
  'GET /api/v1/users/:id': Read<Auth.UserDto>;

  'GET /api/v1/audit-logs': List<Audit.AuditLogDto, Audit.ListAuditLogsQuery>;
  'GET /api/v1/taxes': List<Taxes.TaxDto, Taxes.ListTaxesQuery>;
  'GET /api/v1/taxes/:id': Read<Taxes.TaxDto>;
  'POST /api/v1/taxes': Write<Taxes.CreateTaxRequest, Taxes.TaxDto>;
  'PATCH /api/v1/taxes/:id': Write<Taxes.UpdateTaxRequest, Taxes.TaxDto>;
  'DELETE /api/v1/taxes/:id': Remove;
  'GET /api/v1/payment-terms': List<Terms.PaymentTermDto, Terms.ListPaymentTermsQuery>;
  'GET /api/v1/payment-terms/:id': Read<Terms.PaymentTermDto>;
  'POST /api/v1/payment-terms': Write<Terms.CreatePaymentTermRequest, Terms.PaymentTermDto>;
  'PATCH /api/v1/payment-terms/:id': Write<Terms.UpdatePaymentTermRequest, Terms.PaymentTermDto>;
  'DELETE /api/v1/payment-terms/:id': Remove;

  'GET /api/v1/products': List<Products.ProductDto | Products.ProductAdminDto, Products.ListProductsQuery>;
  'GET /api/v1/products/:id': Read<Products.ProductDetailDto | Products.ProductAdminDetailDto>;
  'POST /api/v1/products': Write<Products.CreateProductRequest, Products.ProductAdminDetailDto>;
  'PATCH /api/v1/products/:id': Write<Products.UpdateProductRequest, Products.ProductAdminDetailDto>;
  'DELETE /api/v1/products/:id': Remove;
  'GET /api/v1/products/:productId/variants': List<Products.ProductVariantDto, Products.ListVariantsQuery>;
  'POST /api/v1/products/:productId/variants': Write<Products.CreateVariantRequest, Products.ProductVariantDto>;
  'PATCH /api/v1/products/:productId/variants/:variantId': Write<Products.UpdateVariantRequest, Products.ProductVariantDto>;
  'DELETE /api/v1/products/:productId/variants/:variantId': Remove;

  'GET /api/v1/staff': List<Staff.StaffDto, Staff.ListStaffQuery>;
  'GET /api/v1/staff/:id': Read<Staff.StaffDto>;
  'POST /api/v1/staff': Write<Staff.CreateStaffRequest, Staff.StaffDto>;
  'PATCH /api/v1/staff/:id': Write<Staff.UpdateStaffRequest, Staff.StaffDto>;
  'DELETE /api/v1/staff/:id': Remove;
  'POST /api/v1/staff/:id/deactivate': Action<Staff.StaffDto>;
  'POST /api/v1/staff/:id/activate': Action<Staff.StaffDto>;

  'GET /api/v1/customers': List<Customers.CustomerListItemDto, Customers.ListCustomersQuery>;
  'GET /api/v1/customers/:id': Read<Customers.CustomerDto>;
  'POST /api/v1/customers': Write<Customers.CreateCustomerRequest, Customers.CustomerDto>;
  'PATCH /api/v1/customers/:id': Write<Customers.UpdateCustomerRequest, Customers.CustomerDto>;
  'DELETE /api/v1/customers/:id': Remove;
  'GET /api/v1/plans': List<Plans.PlanListItemDto, Plans.ListPlansQuery>;
  'GET /api/v1/plans/:id': Read<Plans.PlanDto>;
  'POST /api/v1/plans': Write<Plans.CreatePlanRequest, Plans.PlanDto>;
  'PATCH /api/v1/plans/:id': Write<Plans.UpdatePlanRequest, Plans.PlanDto>;
  'DELETE /api/v1/plans/:id': Remove;

  'GET /api/v1/discounts': List<Discounts.DiscountListItemDto, Discounts.ListDiscountsQuery>;
  'GET /api/v1/discounts/:id': Read<Discounts.DiscountDto>;
  'POST /api/v1/discounts': Write<Discounts.CreateDiscountRequest, Discounts.DiscountDto>;
  'PATCH /api/v1/discounts/:id': Write<Discounts.UpdateDiscountRequest, Discounts.DiscountDto>;
  'DELETE /api/v1/discounts/:id': Remove;
  'PUT /api/v1/discounts/:id/products': Write<Discounts.SetDiscountProductsRequest, Discounts.DiscountDto>;
  'POST /api/v1/discounts/:id/subscriptions': Write<Discounts.AttachDiscountSubscriptionsRequest, Discounts.DiscountDto>;
  'DELETE /api/v1/discounts/:id/subscriptions/:subscriptionId': Remove;
  'GET /api/v1/discounts/:id/usages': List<Discounts.DiscountUsageDto, Discounts.ListDiscountUsagesQuery>;

  'GET /api/v1/quotation-templates': List<Templates.QuotationTemplateListItemDto, Templates.ListQuotationTemplatesQuery>;
  'GET /api/v1/quotation-templates/:id': Read<Templates.QuotationTemplateDto>;
  'POST /api/v1/quotation-templates': Write<Templates.CreateQuotationTemplateRequest, Templates.QuotationTemplateDto>;
  'PATCH /api/v1/quotation-templates/:id': Write<Templates.UpdateQuotationTemplateRequest, Templates.QuotationTemplateDto>;
  'DELETE /api/v1/quotation-templates/:id': Remove;

  'GET /api/v1/subscriptions': List<Subscriptions.SubscriptionListItemDto, Subscriptions.ListSubscriptionsQuery>;
  'GET /api/v1/subscriptions/:id': Read<Subscriptions.SubscriptionDto>;
  'POST /api/v1/subscriptions': Write<Subscriptions.CreateSubscriptionRequest, Subscriptions.SubscriptionDto>;
  'POST /api/v1/subscriptions/from-template': Write<Subscriptions.CreateSubscriptionFromTemplateRequest, Subscriptions.SubscriptionDto>;
  'PATCH /api/v1/subscriptions/:id': Write<Subscriptions.UpdateSubscriptionRequest, Subscriptions.SubscriptionDto>;
  'DELETE /api/v1/subscriptions/:id': Remove;
  'POST /api/v1/subscriptions/:id/send-quotation': Action<Subscriptions.SubscriptionDto>;
  'POST /api/v1/subscriptions/:id/confirm': Action<Subscriptions.SubscriptionDto>;
  'POST /api/v1/subscriptions/:id/activate': Action<Subscriptions.SubscriptionDto>;
  'POST /api/v1/subscriptions/:id/pause': Action<Subscriptions.SubscriptionDto>;
  'POST /api/v1/subscriptions/:id/resume': Action<Subscriptions.SubscriptionDto>;
  'POST /api/v1/subscriptions/:id/close': Write<Subscriptions.CloseSubscriptionRequest, Subscriptions.SubscriptionDto>;
  'POST /api/v1/subscriptions/:id/renew': Write<Subscriptions.RenewSubscriptionRequest, Subscriptions.SubscriptionDto>;

  'GET /api/v1/invoices': List<Invoices.InvoiceListItemDto, Invoices.ListInvoicesQuery>;
  'GET /api/v1/invoices/preview': Endpoint<Invoices.PreviewInvoiceQuery, never, ApiSuccess<Invoices.InvoicePreviewDto>>;
  'POST /api/v1/invoices/generate': Write<Invoices.GenerateInvoiceRequest, Invoices.InvoiceDto>;
  'GET /api/v1/invoices/:id': Read<Invoices.InvoiceDto>;
  'PATCH /api/v1/invoices/:id': Write<Invoices.UpdateInvoiceRequest, Invoices.InvoiceDto>;
  'POST /api/v1/invoices/:id/confirm': Action<Invoices.InvoiceDto>;
  'POST /api/v1/invoices/:id/cancel': Write<Invoices.CancelInvoiceRequest, Invoices.InvoiceDto>;
  'POST /api/v1/invoices/:id/send': Action<Invoices.InvoiceDto>;
  'GET /api/v1/invoices/:id/print': Read<Invoices.InvoicePrintDto>;
  'GET /api/v1/payments': List<Payments.PaymentListItemDto, Payments.ListPaymentsQuery>;
  'GET /api/v1/payments/:id': Read<Payments.PaymentDto>;
  'POST /api/v1/payments': Write<Payments.CreatePaymentRequest, Payments.PaymentDto>;
  'PATCH /api/v1/payments/:id': Write<Payments.UpdatePaymentRequest, Payments.PaymentDto>;
  'DELETE /api/v1/payments/:id': Remove;

  'GET /api/v1/billing-runs': List<Billing.BillingRunDto, Billing.ListBillingRunsQuery>;
  'GET /api/v1/billing-runs/:id': Read<Billing.BillingRunDto>;
  'GET /api/v1/billing-runs/:id/items': List<Billing.BillingRunItemDto, Billing.ListBillingRunItemsQuery>;
  'POST /api/v1/billing-runs': Write<Billing.CreateBillingRunRequest, Billing.BillingRunDto>;
  'POST /api/v1/billing-runs/:id/retry-failed': Action<Billing.BillingRunDto>;

  'GET /api/v1/me': Read<Portal.PortalProfileDto>;
  'PATCH /api/v1/me': Write<Portal.UpdatePortalProfileRequest, Portal.PortalProfileDto>;
  'GET /api/v1/portal/summary': Read<Portal.PortalSummaryDto>;
  'GET /api/v1/portal/subscriptions': List<Portal.PortalSubscriptionListItemDto, Portal.ListPortalSubscriptionsQuery>;
  'GET /api/v1/portal/subscriptions/:id': Read<Portal.PortalSubscriptionDto>;
  'POST /api/v1/portal/subscriptions/:id/pause': Action<Portal.PortalSubscriptionDto>;
  'POST /api/v1/portal/subscriptions/:id/resume': Action<Portal.PortalSubscriptionDto>;
  'POST /api/v1/portal/subscriptions/:id/close': Write<Portal.PortalCloseSubscriptionRequest, Portal.PortalSubscriptionDto>;
  'POST /api/v1/portal/subscriptions/:id/renew': Write<Portal.PortalRenewSubscriptionRequest, Portal.PortalSubscriptionDto>;
  'GET /api/v1/portal/invoices': List<Portal.PortalInvoiceListItemDto, Portal.ListPortalInvoicesQuery>;
  'GET /api/v1/portal/invoices/:id': Read<Portal.PortalInvoiceDto>;
  'GET /api/v1/portal/invoices/:id/print': Read<Portal.PortalInvoicePrintDto>;
  'GET /api/v1/portal/payments': List<Portal.PortalPaymentDto, Portal.ListPortalPaymentsQuery>;

  'GET /api/v1/reports/summary': Endpoint<Reports.ReportSummaryQuery, never, ApiSuccess<Reports.ReportSummaryDto>>;
  'GET /api/v1/reports/revenue/timeseries': Endpoint<Reports.RevenueTimeseriesQuery, never, ApiSuccess<Reports.RevenueTimeseriesDto>>;
  'GET /api/v1/reports/revenue/by-plan': Endpoint<Reports.RevenueByPlanQuery, never, ApiSuccess<Reports.RevenueByPlanDto>>;
  'GET /api/v1/reports/payments/summary': Endpoint<Reports.PaymentsSummaryQuery, never, ApiSuccess<Reports.PaymentsSummaryDto>>;
  'GET /api/v1/reports/invoices/overdue': List<Reports.OverdueInvoiceDto, Reports.ListOverdueInvoicesQuery>;
  'GET /api/v1/reports/aging': Endpoint<Reports.AgingQuery, never, ApiSuccess<Reports.AgingDto>>;
  'GET /api/v1/reports/subscriptions/expiring': List<Reports.ExpiringSubscriptionDto, Reports.ListExpiringSubscriptionsQuery>;
}

/** Proposed frontend addition; kept separate from the backend's agreed endpoint set. */
export interface ProposedApiContracts {
  'GET /api/v1/discounts/:id/subscriptions': List<Discounts.DiscountSubscriptionDto, Discounts.ListDiscountSubscriptionsQuery>;
}

export type ApiEndpoint = keyof ApiContracts;
export type RequestBodyFor<K extends ApiEndpoint> = ApiContracts[K]['body'];
export type RequestQueryFor<K extends ApiEndpoint> = ApiContracts[K]['query'];
export type SuccessResponseFor<K extends ApiEndpoint> = ApiContracts[K]['response'];
export type ResponseDataFor<K extends ApiEndpoint> = SuccessResponseFor<K> extends { data: infer D } ? D : never;
/** Existing auth/users errors retain their diagnostic details shape until explicitly migrated. */
export type ResponseFor<K extends ApiEndpoint> = SuccessResponseFor<K> |
  (K extends `${string} /api/v1/auth/${string}` | `${string} /api/v1/users${string}` ? ApiError : ApiFailure);
type ParamNames<P extends string> = P extends `${string}/:${infer N}/${infer Rest}`
  ? N | ParamNames<`/${Rest}`>
  : P extends `${string}/:${infer N}` ? N : never;
export type RequestParamsFor<K extends ApiEndpoint> = Record<ParamNames<K>, number>;
type Part<N extends string, T> = [T] extends [never] ? { [P in N]?: never }
  : Record<string, never> extends T ? { [P in N]?: T } : { [P in N]: T };
export type RequestFor<K extends ApiEndpoint> =
  (ParamNames<K> extends never ? { params?: never } : { params: RequestParamsFor<K> }) &
  Part<'query', RequestQueryFor<K>> & Part<'body', RequestBodyFor<K>>;

/** Role-specific product projections for clients/handlers that already narrowed the actor. */
export type ProductDtoFor<R extends Extract<Role, 'ADMIN' | 'STAFF'>> = R extends 'ADMIN' ? Products.ProductAdminDto : Products.ProductDto;
export type ProductDetailDtoFor<R extends Extract<Role, 'ADMIN' | 'STAFF'>> = R extends 'ADMIN' ? Products.ProductAdminDetailDto : Products.ProductDetailDto;
