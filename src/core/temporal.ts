/**
 * temporal.ts — historical analysis, current-state pacing, and forward projection.
 *
 * The rest of the app knows three time horizons now, not one:
 *   • HISTORY  — what actually happened over prior months (patterns to learn from)
 *   • CURRENT  — what is true today and month-to-date (state to act on)
 *   • FUTURE   — what's likely next, projected from history + current pace
 *
 * Everything here is pure (no I/O, no React) so both the web and mobile apps share
 * it verbatim and CJ-Bot can reason over the same numbers it shows the user.
 *
 * Honesty rules baked in:
 *   • Projections are labeled with the confidence the data supports (more months =
 *     more confidence). With <2 months of history we say so rather than guessing.
 *   • We never invent transactions; if there's no data, series come back empty and
 *     callers show "not enough history yet" instead of a fabricated trend.
 */

import type { Transaction, SavingsGoal } from './models';

// ── Date helpers (month math) ──────────────────────────────────────────────────

/** 'yyyy-mm' for a Date. */
export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/** Add (or subtract) whole months to a 'yyyy-mm' key. */
export function addMonths(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return monthKey(d);
}

/** Human label for a 'yyyy-mm' key, e.g. 'Mar 2024'. */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

/** The current calendar month as 'yyyy-mm'. */
export function thisMonthKey(): string {
  return monthKey(new Date());
}

/** Inclusive list of month keys from `from` to `to`. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  // guard against inverted ranges / runaway loops
  for (let i = 0; i < 600 && cur <= to; i++) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

/** Day of month 1..28+ and fraction of the current month elapsed (0..1]. */
export function monthProgress(now = new Date()): { dayOfMonth: number; fraction: number; daysInMonth: number } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const dayOfMonth = now.getUTCDate();
  return { dayOfMonth, daysInMonth, fraction: Math.min(1, dayOfMonth / daysInMonth) };
}

// ── Transaction sign convention ─────────────────────────────────────────────────

/** Money in = income/refund/reimbursement. Transfers and 'ignore' are neutral. */
export function isInflow(t: Transaction): boolean {
  return t.type === 'income' || t.type === 'refund' || t.type === 'reimbursement';
}
export function isSpending(t: Transaction): boolean {
  // expense, debt_payment, bill_payment all reduce cash; transfer/ignore don't.
  return (
    t.type === 'expense' || t.type === 'debt_payment' || t.type === 'bill_payment'
  );
}

// ── HISTORY ─────────────────────────────────────────────────────────────────────

export interface MonthlyPoint {
  month: string; // yyyy-mm
  label: string;
  spending: number;
  income: number;
  net: number; // income - spending
}

/**
 * Month-by-month spending/income for every month that has at least one
 * transaction, oldest → newest. Empty when there are no transactions.
 */
export function monthlySeries(transactions: Transaction[]): MonthlyPoint[] {
  if (transactions.length === 0) return [];
  const byMonth = new Map<string, { spending: number; income: number }>();
  let min = '9999-99';
  let max = '0000-00';
  for (const t of transactions) {
    const mk = t.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mk)) continue;
    if (mk < min) min = mk;
    if (mk > max) max = mk;
    const cell = byMonth.get(mk) ?? { spending: 0, income: 0 };
    if (isInflow(t)) cell.income += t.amount;
    else if (isSpending(t)) cell.spending += t.amount;
    byMonth.set(mk, cell);
  }
  if (min > max) return [];
  // Fill the full range so gaps (months with no activity) read as zero, not missing.
  return monthRange(min, max).map((mk) => {
    const cell = byMonth.get(mk) ?? { spending: 0, income: 0 };
    return {
      month: mk,
      label: monthLabel(mk),
      spending: round2(cell.spending),
      income: round2(cell.income),
      net: round2(cell.income - cell.spending),
    };
  });
}

export type TrendDirection = 'rising' | 'falling' | 'stable' | 'insufficient';

export interface CategoryHistory {
  category: string;
  total: number; // total spent across the analyzed window
  monthsSeen: number; // how many distinct months this category appeared in
  average: number; // mean monthly spend across COMPLETED months in the window
  recent: number; // most recent completed month's spend
  trend: TrendDirection; // direction of the linear fit over completed months
  trendPctPerMonth: number; // slope as % of average (signed)
  monthly: { month: string; amount: number }[];
}

/**
 * Per-category spending history over the trailing `windowMonths` COMPLETED months
 * (the current, in-progress month is excluded so averages aren't dragged down by a
 * partial month). Sorted by total spend, biggest first.
 */
export function categoryHistory(
  transactions: Transaction[],
  windowMonths = 6,
  now = new Date(),
): CategoryHistory[] {
  const current = monthKey(now);
  const oldest = addMonths(current, -windowMonths);
  // Completed months only: [oldest, current) — strictly before the current month.
  const completed = monthRange(oldest, addMonths(current, -1));
  if (completed.length === 0) return [];

  const cats = new Map<string, Map<string, number>>();
  for (const t of transactions) {
    if (!isSpending(t)) continue;
    const mk = t.date.slice(0, 7);
    if (mk < completed[0] || mk > completed[completed.length - 1]) continue;
    const cat = t.category || 'Other';
    const m = cats.get(cat) ?? new Map<string, number>();
    m.set(mk, (m.get(mk) ?? 0) + t.amount);
    cats.set(cat, m);
  }

  const out: CategoryHistory[] = [];
  for (const [category, monthMap] of cats) {
    const monthly = completed.map((mk) => ({ month: mk, amount: round2(monthMap.get(mk) ?? 0) }));
    const amounts = monthly.map((p) => p.amount);
    const total = round2(amounts.reduce((s, a) => s + a, 0));
    const monthsSeen = amounts.filter((a) => a > 0).length;
    const average = round2(total / completed.length);
    const recent = amounts[amounts.length - 1] ?? 0;

    const { direction, slope } = linearTrend(amounts);
    const trendPctPerMonth = average > 0 ? round1((slope / average) * 100) : 0;

    out.push({
      category,
      total,
      monthsSeen,
      average,
      recent,
      trend: monthsSeen < 2 ? 'insufficient' : direction,
      trendPctPerMonth,
      monthly,
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

/**
 * Detect recurring charges (subscriptions, regular bills) by looking for similar
 * amounts to the same-ish merchant appearing in 2+ distinct months.
 */
export interface RecurringCharge {
  label: string;
  typicalAmount: number;
  occurrences: number;
  monthsSeen: number;
  category: string;
  lastDate: string;
}

export function recurringCharges(transactions: Transaction[], now = new Date()): RecurringCharge[] {
  const current = monthKey(now);
  const oldest = addMonths(current, -6);
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!isSpending(t)) continue;
    const mk = t.date.slice(0, 7);
    if (mk < oldest) continue;
    const key = normalizeMerchant(t.merchant || t.description);
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }

  const out: RecurringCharge[] = [];
  for (const [key, txns] of groups) {
    const months = new Set(txns.map((t) => t.date.slice(0, 7)));
    if (months.size < 2) continue; // needs to recur across months
    const amounts = txns.map((t) => t.amount).sort((a, b) => a - b);
    const typical = amounts[Math.floor(amounts.length / 2)]; // median
    // Require amounts to be reasonably consistent (recurring, not random spend).
    const consistent = amounts.every((a) => Math.abs(a - typical) <= Math.max(2, typical * 0.25));
    if (!consistent) continue;
    const last = txns.reduce((a, b) => (a.date > b.date ? a : b));
    out.push({
      label: prettyMerchant(key),
      typicalAmount: round2(typical),
      occurrences: txns.length,
      monthsSeen: months.size,
      category: last.category || 'Other',
      lastDate: last.date,
    });
  }
  return out.sort((a, b) => b.typicalAmount * b.monthsSeen - a.typicalAmount * a.monthsSeen);
}

// ── CURRENT (month-to-date pacing) ──────────────────────────────────────────────

export interface PacingResult {
  monthToDateSpending: number;
  daysElapsed: number;
  daysInMonth: number;
  dailyRate: number; // spend per day so far this month
  projectedMonthEnd: number; // dailyRate × daysInMonth
  priorMonthAverage: number; // avg completed-month spend, for comparison
  vsAveragePct: number; // projected vs historical average, signed %
  pace: 'ahead' | 'behind' | 'on_track' | 'no_baseline';
}

/**
 * How this month is tracking: month-to-date spend, the daily rate, and a
 * straight-line projection to month end, compared against the historical average.
 */
export function spendingPace(
  transactions: Transaction[],
  windowMonths = 6,
  now = new Date(),
): PacingResult {
  const current = monthKey(now);
  const { dayOfMonth, daysInMonth } = monthProgress(now);

  let mtd = 0;
  for (const t of transactions) {
    if (!isSpending(t)) continue;
    if (t.date.slice(0, 7) !== current) continue;
    mtd += t.amount;
  }

  const hist = categoryHistory(transactions, windowMonths, now);
  const priorMonthAverage = round2(
    hist.reduce((s, c) => s + c.average, 0),
  );

  const dailyRate = dayOfMonth > 0 ? mtd / dayOfMonth : 0;
  const projectedMonthEnd = round2(dailyRate * daysInMonth);

  let pace: PacingResult['pace'] = 'no_baseline';
  let vsAveragePct = 0;
  if (priorMonthAverage > 0) {
    vsAveragePct = round1(((projectedMonthEnd - priorMonthAverage) / priorMonthAverage) * 100);
    pace =
      vsAveragePct > 8 ? 'ahead' : vsAveragePct < -8 ? 'behind' : 'on_track';
  }

  return {
    monthToDateSpending: round2(mtd),
    daysElapsed: dayOfMonth,
    daysInMonth,
    dailyRate: round2(dailyRate),
    projectedMonthEnd,
    priorMonthAverage,
    vsAveragePct,
    pace,
  };
}

// ── FUTURE (projection) ─────────────────────────────────────────────────────────

export type ProjectionConfidence = 'high' | 'medium' | 'low' | 'none';

export interface CategoryProjection {
  category: string;
  projectedNextMonth: number;
  basis: 'trend' | 'average' | 'single_month' | 'none';
  average: number;
  trend: TrendDirection;
  confidence: ProjectionConfidence;
}

/**
 * Projected spend per category for next month. Uses the linear trend when there
 * are 3+ months of data, falls back to the average for 2 months, and to the
 * single observed month for 1. Confidence is reported honestly.
 */
export function projectCategorySpending(
  transactions: Transaction[],
  windowMonths = 6,
  now = new Date(),
): CategoryProjection[] {
  const hist = categoryHistory(transactions, windowMonths, now);
  return hist.map((c) => {
    let projected: number;
    let basis: CategoryProjection['basis'];
    let confidence: ProjectionConfidence;

    if (c.monthsSeen >= 3) {
      // Extend the linear fit one month past the window.
      const { slope, intercept, n } = linearFit(c.monthly.map((p) => p.amount));
      projected = Math.max(0, intercept + slope * n);
      basis = 'trend';
      confidence = c.monthsSeen >= 4 ? 'high' : 'medium';
    } else if (c.monthsSeen === 2) {
      projected = c.average;
      basis = 'average';
      confidence = 'medium';
    } else if (c.monthsSeen === 1) {
      projected = c.recent || c.total;
      basis = 'single_month';
      confidence = 'low';
    } else {
      projected = 0;
      basis = 'none';
      confidence = 'none';
    }

    return {
      category: c.category,
      projectedNextMonth: round2(projected),
      basis,
      average: c.average,
      trend: c.trend,
      confidence,
    };
  });
}

export interface SpendingForecast {
  projectedTotal: number;
  byCategory: CategoryProjection[];
  monthsOfHistory: number;
  confidence: ProjectionConfidence;
}

/** Total projected spend next month = sum of category projections. */
export function forecastNextMonthSpending(
  transactions: Transaction[],
  windowMonths = 6,
  now = new Date(),
): SpendingForecast {
  const byCategory = projectCategorySpending(transactions, windowMonths, now);
  const series = monthlySeries(transactions);
  const current = monthKey(now);
  const monthsOfHistory = series.filter((p) => p.month < current && (p.spending > 0 || p.income > 0)).length;
  const projectedTotal = round2(byCategory.reduce((s, c) => s + c.projectedNextMonth, 0));
  const confidence: ProjectionConfidence =
    monthsOfHistory >= 4 ? 'high' : monthsOfHistory >= 2 ? 'medium' : monthsOfHistory >= 1 ? 'low' : 'none';
  return { projectedTotal, byCategory, monthsOfHistory, confidence };
}

export interface GoalProjection {
  goalId: string;
  name: string;
  current: number;
  target: number;
  monthlyContribution: number; // observed or target monthly pace
  monthsToTarget: number | null; // null = not on track to reach it
  projectedDate: string | null; // 'yyyy-mm' when target is reached
  basis: 'observed' | 'target' | 'none';
}

/**
 * When each savings goal will be reached. Prefers the OBSERVED contribution pace
 * (average monthly increase implied by savings-tagged transfers); falls back to
 * the goal's stated monthly target. Returns null months when there is no pace to
 * project from (so the UI can say "set a monthly amount" rather than imply never).
 */
export function projectGoals(
  goals: SavingsGoal[],
  transactions: Transaction[],
  now = new Date(),
): GoalProjection[] {
  const observedMonthly = observedMonthlySavings(transactions, now);

  return goals.map((g) => {
    const remaining = Math.max(g.targetAmount - g.currentAmount, 0);
    const observed = observedMonthly; // app-wide savings rate, allocated to active goals
    const targetPace = g.monthlyContributionTarget ?? 0;
    const monthly = observed > 0 ? observed : targetPace;
    const basis: GoalProjection['basis'] = observed > 0 ? 'observed' : targetPace > 0 ? 'target' : 'none';

    let monthsToTarget: number | null = null;
    let projectedDate: string | null = null;
    if (remaining === 0) {
      monthsToTarget = 0;
      projectedDate = monthKey(now);
    } else if (monthly > 0) {
      monthsToTarget = Math.ceil(remaining / monthly);
      projectedDate = addMonths(monthKey(now), monthsToTarget);
    }

    return {
      goalId: g.id,
      name: g.name,
      current: round2(g.currentAmount),
      target: round2(g.targetAmount),
      monthlyContribution: round2(monthly),
      monthsToTarget,
      projectedDate,
      basis,
    };
  });
}

/** Average monthly amount moved into savings over completed months (from transfers
 *  whose description marks them as savings). 0 when none observed. */
export function observedMonthlySavings(transactions: Transaction[], now = new Date()): number {
  const current = monthKey(now);
  const oldest = addMonths(current, -6);
  const byMonth = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== 'transfer') continue;
    if (!/saving|rainy|emergency|retire|fund/i.test(t.description)) continue;
    const mk = t.date.slice(0, 7);
    if (mk < oldest || mk >= current) continue; // completed months only
    byMonth.set(mk, (byMonth.get(mk) ?? 0) + t.amount);
  }
  if (byMonth.size === 0) return 0;
  const total = [...byMonth.values()].reduce((s, a) => s + a, 0);
  // Average across the number of completed months in the window that had activity.
  return round2(total / byMonth.size);
}

// ── Combined temporal snapshot (handed to CJ-Bot + UI) ──────────────────────────

export interface TemporalSnapshot {
  monthsOfHistory: number;
  series: MonthlyPoint[];
  topCategories: CategoryHistory[];
  pace: PacingResult;
  forecast: SpendingForecast;
  recurring: RecurringCharge[];
  averageMonthlySpending: number;
  averageMonthlyIncome: number;
  hasEnoughHistory: boolean; // ≥2 completed months
}

export function buildTemporalSnapshot(
  transactions: Transaction[],
  windowMonths = 6,
  now = new Date(),
): TemporalSnapshot {
  const series = monthlySeries(transactions);
  const current = monthKey(now);
  const completed = series.filter((p) => p.month < current);
  const monthsOfHistory = completed.filter((p) => p.spending > 0 || p.income > 0).length;

  const avgSpend =
    completed.length > 0 ? round2(completed.reduce((s, p) => s + p.spending, 0) / completed.length) : 0;
  const avgIncome =
    completed.length > 0 ? round2(completed.reduce((s, p) => s + p.income, 0) / completed.length) : 0;

  return {
    monthsOfHistory,
    series,
    topCategories: categoryHistory(transactions, windowMonths, now).slice(0, 8),
    pace: spendingPace(transactions, windowMonths, now),
    forecast: forecastNextMonthSpending(transactions, windowMonths, now),
    recurring: recurringCharges(transactions, now),
    averageMonthlySpending: avgSpend,
    averageMonthlyIncome: avgIncome,
    hasEnoughHistory: monthsOfHistory >= 2,
  };
}

// ── Internal math helpers ───────────────────────────────────────────────────────

function linearFit(ys: number[]): { slope: number; intercept: number; n: number } {
  const n = ys.length;
  if (n === 0) return { slope: 0, intercept: 0, n: 0 };
  if (n === 1) return { slope: 0, intercept: ys[0], n: 1 };
  const xs = ys.map((_, i) => i);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sumXX = xs.reduce((a, x) => a + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept, n };
}

function linearTrend(ys: number[]): { direction: TrendDirection; slope: number } {
  if (ys.length < 2) return { direction: 'insufficient', slope: 0 };
  const { slope } = linearFit(ys);
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  // Treat slopes within ±5% of the mean per month as "stable" to avoid noise.
  const threshold = Math.max(1, mean * 0.05);
  const direction: TrendDirection =
    slope > threshold ? 'rising' : slope < -threshold ? 'falling' : 'stable';
  return { direction, slope };
}

function normalizeMerchant(s: string): string {
  return s
    .toLowerCase()
    .replace(/\d+/g, '') // drop card/ref numbers
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3) // first few tokens identify the merchant
    .join(' ');
}

function prettyMerchant(key: string): string {
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
