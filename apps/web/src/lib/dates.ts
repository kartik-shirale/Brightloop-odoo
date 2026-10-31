export function todayInBusinessTz(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export function toDateOnly(value: Date | string): string { return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10); }
