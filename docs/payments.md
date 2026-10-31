# Payments module (M12)

Base path `/api/v1/payments`. Records money received against CONFIRMED invoices. Uses the payments atomic-write exception (backend plan section 4): the repository also writes `Invoice.amountPaid`, `amountDue`, `status` and `paidAt` in the same transaction.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/` | ADMIN, STAFF | List |
| GET | `/:id` | ADMIN, STAFF | |
| POST | `/` | ADMIN, STAFF | `invoiceId`, `method`, `amount` (paise, integer, at least 1), `paymentDate`, `reference?`, `note?`. 201 with `Location` |
| PATCH | `/:id` | ADMIN, STAFF | `reference` and `note` only (`null` clears). Amount, date, invoice and method are rejected with 400 |
| DELETE | `/:id` | ADMIN | Reverses a mistaken payment. 200 message envelope |

CUSTOMER and anonymous callers are refused on the routes (403 and 401). Roles are checked again in the service.

## List query

`search` (reference, note, invoice number, customer name; case-insensitive, `%` and `_` are literal), `invoiceId`, `customerId`, `method` (comma list of `CASH,BANK_TRANSFER,CARD,UPI,CHEQUE,ONLINE,OTHER`), `paidFrom` / `paidTo` (on `paymentDate`, inclusive, a date-only `paidTo` means end of that day), `minAmount`, `maxAmount` (paise), `sortBy` (`paymentDate`, `amount`, `createdAt`, default `createdAt`), `sortOrder`, `page`, `limit` (1 to 100). `id` is the sort tie-breaker. Unknown keys, `minAmount > maxAmount` and `paidFrom > paidTo` return 400. Invoice numbers, customer names and recorder names are loaded in three batched queries per page.

## Create rules

- One transaction. A single conditional, parameter-bound `UPDATE "Invoice" ... WHERE status = 'CONFIRMED' AND amountDue >= amount RETURNING ...` moves the balance (`amountPaid + amount`, `amountDue - amount`). When `amountDue` reaches 0 the same statement sets `status = PAID` and `paidAt = now()`. Then the payment row is inserted with `customerId` copied from the invoice and `recordedById` = the actor.
- Two parallel payments that together exceed the balance: exactly one succeeds, the other gets 400 `OVERPAYMENT`.
- Zero rows updated writes nothing and is diagnosed by reading the invoice: missing is 404 `NOT_FOUND`, status not CONFIRMED (DRAFT, CANCELLED, PAID) is 409 `INVOICE_NOT_PAYABLE`, `amount > amountDue` is 400 `OVERPAYMENT`.
- `paymentDate` is a date (`YYYY-MM-DD`) or ISO instant, normalized to UTC midnight of that date. It cannot be after today in `APP_TIMEZONE` (400 `VALIDATION_ERROR`, field `paymentDate`). Today is allowed.

## Delete rules

One transaction: the payment row is deleted, then its amount is reversed on the invoice (`amountPaid - amount`, `amountDue + amount`). A PAID invoice goes back to CONFIRMED with `paidAt` cleared; any other status is kept. A second delete of the same payment returns 404 and reverses nothing. The audit entry `payment.delete` stores the full deleted payment in `metadata.payment`, plus `invoiceNumber`, `invoiceStatusAfter`, `amountDueAfter`.

## Customer actor (used by the portal module)

`PaymentsService.list(actor, query)` and `get(actor, id)` accept `Actor { role: 'CUSTOMER', customerId }`: `customerId` is forced from the actor (a `customerId` filter is ignored), the repository puts the `customerId` condition in the query itself, and only payments of invoices in CONFIRMED or PAID are visible. Another customer's payment, or one on a hidden invoice, is 404. `create`, `update` and `remove` throw 403 for a CUSTOMER actor. The service returns `PaymentDto`; the portal maps it to its own `PortalPaymentDto` (drops `recordedById`, `recordedByName`, `note`).

## Audit

`payment.create` (invoice, method, amount, date, reference, `invoiceStatusAfter`, `amountDueAfter`), `payment.update` (changes and previous values), `payment.delete` (full payment).

## Example

```
POST /api/v1/payments
{ "invoiceId": 12, "method": "UPI", "amount": 250000, "paymentDate": "2026-10-31", "reference": "UTR123" }
```

```json
{ "success": true, "message": "Payment recorded.",
  "data": { "id": 7, "invoiceId": 12, "invoiceNumber": "INV-2026-000012", "customerId": 3, "customerName": "Acme Ltd",
            "method": "UPI", "amount": 250000, "paymentDate": "2026-10-31T00:00:00.000Z", "reference": "UTR123",
            "note": null, "recordedById": 2, "recordedByName": "Staff User",
            "createdAt": "2026-10-31T09:00:00.000Z", "updatedAt": "2026-10-31T09:00:00.000Z" } }
```

## Error codes

`VALIDATION_ERROR` (400), `OVERPAYMENT` (400), `AUTH_REQUIRED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `INVOICE_NOT_PAYABLE` (409).
