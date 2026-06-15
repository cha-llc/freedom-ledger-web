/** Formatting helpers used across the app. */

export function formatMoney(amount: number, currency = 'USD'): string {
  const sym = currencySymbol(currency);
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount < 0 ? '-' : ''}${sym}${formatted}`;
}

export function formatMoneyShort(amount: number, currency = 'USD'): string {
  const sym = currencySymbol(currency);
  const abs = Math.abs(amount);
  if (abs >= 1000) {
    return `${amount < 0 ? '-' : ''}${sym}${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  }
  return `${amount < 0 ? '-' : ''}${sym}${Math.round(abs)}`;
}

export function currencySymbol(currency: string): string {
  switch (currency) {
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    case 'CRC':
      return '₡';
    case 'COP':
      return '$';
    default:
      return '$';
  }
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO + 'T00:00:00');
  const to = new Date(toISO + 'T00:00:00');
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

export function daysUntil(targetISO: string): number {
  return daysBetween(todayISO(), targetISO);
}

export function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDateLong(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function uid(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function pct(current: number, target: number): number {
  if (target <= 0) return 0;
  return clamp(current / target, 0, 1);
}
