export function rupeesToPaise(value: string): number {
 const text = value.replaceAll(',', '').trim();
 if (!/^\d+(\.\d{0,2})?$/.test(text)) throw new Error('Enter an amount with at most two decimal places');
 const [whole = '0', decimal = ''] = text.split('.');
 const amount = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
 if (!Number.isSafeInteger(amount)) throw new Error('Amount is too large');
 return amount;
}
export function paiseToRupees(value: number): string { return `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, '0')}`; }
export const percentToBps = rupeesToPaise;
export const bpsToPercent = paiseToRupees;
