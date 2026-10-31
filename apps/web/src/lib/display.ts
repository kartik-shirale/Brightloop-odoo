import { formatDate, formatPaise } from '@/lib/format';
export function read(value: unknown, key: string): unknown { if (typeof value !== 'object' || value === null) return undefined; return Reflect.get(value, key); }
export function titleCase(value: string): string { return value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_',' ').replace(/^./, c => c.toUpperCase()); }
export function display(value: unknown, key = ''): string {
 if (value === null || value === undefined || value === '') return '—';
 if (typeof value === 'boolean') return value ? 'Yes' : 'No';
 if (typeof value === 'number' && /price|amount|total|subtotal|revenue|mrr|arr|received|invoiced/i.test(key) && !/count|quantity/i.test(key)) return formatPaise(value);
 if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return formatDate(value);
 if (typeof value === 'object') return Object.entries(value).filter(([,v]) => typeof v !== 'object').map(([k,v]) => `${titleCase(k)}: ${display(v,k)}`).join(' · ');
 return String(value);
}
