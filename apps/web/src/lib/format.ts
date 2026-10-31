export function formatPaise(value: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value / 100); }
export function formatBps(value: number): string { return `${value / 100}%`; }
export function formatDate(value: string): string { return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)); }
export function formatDateTime(value: string): string { return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value)); }
