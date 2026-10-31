import { formatDate, formatPaise } from '@/lib/format';
export function read(value: unknown, key: string): unknown { if (typeof value !== 'object' || value === null) return undefined; return Reflect.get(value, key); }
/** Enum values such as DRAFT or BANK_TRANSFER; short codes like INR are left alone. */
const ENUM_PATTERN = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$|^[A-Z]{4,}$/;
const ENUM_KEYS = /status|state|type|scope|method|period|role|interval|action/i;
/** `SEND_QUOTATION` -> "Send quotation", `MONTHLY` -> "Monthly". */
export function humanize(value: string): string { const words = value.toLowerCase().replaceAll('_', ' '); return words.charAt(0).toUpperCase() + words.slice(1); }
/** camelCase keys -> "Customer Name"; all-caps enums -> sentence case. */
export function titleCase(value: string): string { if (ENUM_PATTERN.test(value)) return humanize(value); return value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_',' ').replace(/^./, c => c.toUpperCase()); }
export interface RecordSummary { id?: number; label: string; detail?: string }
/**
 * A nested record (customer, plan, payment term...) as its name plus one helpful detail,
 * instead of every field joined together.
 */
export function summarize(value: object): RecordSummary {
 const field = (key: string): unknown => read(value, key);
 const id = typeof field('id') === 'number' ? Number(field('id')) : undefined;
 const label = String(field('name') ?? field('number') ?? field('title') ?? field('email') ?? (id !== undefined ? `#${id}` : '—'));
 const period = field('billingPeriod'); const dueDays = field('dueDays'); const email = field('email'); const company = field('companyName');
 const detail = typeof period === 'string' ? humanize(period)
  : typeof dueDays === 'number' ? (dueDays === 0 ? 'Due on receipt' : `Due in ${dueDays} days`)
  : typeof email === 'string' && email !== label ? email
  : typeof company === 'string' ? company : undefined;
 return { ...(id !== undefined ? { id } : {}), label, ...(detail ? { detail } : {}) };
}
/** Statuses before activation: billing has not started, so there is no next billing date yet. */
const PRE_ACTIVATION_STATUSES = new Set(['DRAFT', 'QUOTATION', 'CONFIRMED']);
/**
 * What to show instead of an empty next billing date on a subscription that is not active yet.
 * Activation sets the date to the start date, so that is when billing will begin.
 */
export function pendingBillingNote(row: unknown): string | null {
 if (read(row, 'nextBillingDate') != null || !PRE_ACTIVATION_STATUSES.has(String(read(row, 'status')))) return null;
 const start = read(row, 'startDate');
 return typeof start === 'string' ? `On activation (from ${formatDate(start)})` : 'On activation';
}
export function display(value: unknown, key = ''): string {
 if (value === null || value === undefined || value === '') return '—';
 if (typeof value === 'boolean') return value ? 'Yes' : 'No';
 if (typeof value === 'number' && /price|amount|total|subtotal|revenue|mrr|arr|received|invoiced/i.test(key) && !/count|quantity/i.test(key)) return formatPaise(value);
 if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return formatDate(value);
 // Only enum-typed fields, so an all-caps customer or product name is shown as entered.
 if (typeof value === 'string' && ENUM_PATTERN.test(value) && (!key || ENUM_KEYS.test(key))) return humanize(value);
 if (typeof value === 'object') { const summary = summarize(value); return summary.detail ? `${summary.label} · ${summary.detail}` : summary.label; }
 return String(value);
}
