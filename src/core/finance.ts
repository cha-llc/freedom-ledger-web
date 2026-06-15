/**
 * Pure personal-finance math. No business money enters any of these functions.
 */

import type {
  Transaction,
  Bill,
  Debt,
  SavingsGoal,
  TravelPlan,
  AppSettings,
} from './models';
import { currentMonth, daysUntil } from './format';

/** Bills due before the next income date (the window that matters for runway). */
export function billsBeforeIncome(bills: Bill[], nextIncomeDate: string): Bill[] {
  const incomeIn = daysUntil(nextIncomeDate);
  return bills.filter((b) => {
    if (b.paid) return false;
    const due = daysUntil(b.dueDate);
    return due >= 0 && due <= Math.max(incomeIn, 0);
  });
}

export function sumBills(bills: Bill[]): number {
  return bills.reduce((s, b) => s + b.amount, 0);
}

export function criticalBills(bills: Bill[]): Bill[] {
  return bills.filter((b) => !b.paid && (b.priority === 'critical' || b.priority === 'high'));
}

export function totalDebt(debts: Debt[]): number {
  return debts.reduce((s, d) => s + d.balance, 0);
}

export function totalDebtMinimums(debts: Debt[]): number {
  return debts.reduce((s, d) => s + d.minimumPayment, 0);
}

/** Spending and income for the current month from approved transactions. */
export function monthlyTotals(transactions: Transaction[], month = currentMonth()) {
  let spending = 0;
  let income = 0;
  for (const t of transactions) {
    if (!t.date.startsWith(month)) continue;
    if (t.type === 'ignore' || t.type === 'transfer') continue;
    if (t.type === 'income' || t.type === 'refund' || t.type === 'reimbursement') {
      income += t.amount;
    } else {
      // expense, debt_payment, bill_payment
      spending += t.amount;
    }
  }
  return { spending, income };
}

/** How much CJ has moved into savings goals this month (contribution-based). */
export function savedThisMonth(goals: SavingsGoal[], transactions: Transaction[]): number {
  // MVP heuristic: count transfers tagged toward savings + explicit goal contributions.
  const month = currentMonth();
  return transactions
    .filter(
      (t) =>
        t.date.startsWith(month) &&
        t.type === 'transfer' &&
        /saving|rainy|emergency|retire/i.test(t.description),
    )
    .reduce((s, t) => s + t.amount, 0);
}

export interface SafeToSpendInput {
  cashAvailable: number;
  bills: Bill[];
  debts: Debt[];
  settings: AppSettings;
  goals: SavingsGoal[];
}

export interface SafeToSpendResult {
  safeToSpend: number;
  perDay: number;
  reservedForBills: number;
  reservedForFood: number;
  reservedForDebt: number;
  reservedForSavings: number;
  emergencyBuffer: number;
  daysUntilIncome: number;
}

/**
 * Safe-to-spend: only personal money and personal obligations.
 * Considers upcoming bills, a food/transport minimum reserve, debt minimums,
 * a small savings target, an emergency buffer, and days until next income.
 */
export function calcSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const { cashAvailable, bills, debts, settings, goals } = input;
  const daysLeft = Math.max(daysUntil(settings.nextIncomeDate), 1);

  const reservedForBills = sumBills(billsBeforeIncome(bills, settings.nextIncomeDate));

  // Food + transportation minimum reserve, prorated to the window before income.
  const dailySurvival = settings.survivalMonthlyExpense / 30;
  const reservedForFood = Math.round(dailySurvival * Math.min(daysLeft, 30) * 0.45);

  const reservedForDebt = totalDebtMinimums(debts);

  // Small savings target: prefer paycheck contribution targets, else 5% of cash.
  const goalTargets = goals
    .filter((g) => g.isActive)
    .reduce((s, g) => s + (g.paycheckContributionTarget ?? 0), 0);
  const reservedForSavings = goalTargets > 0 ? goalTargets : Math.round(cashAvailable * 0.05);

  // Emergency buffer: keep at least a few days of survival untouched.
  const emergencyBuffer = Math.round(dailySurvival * 3);

  const safeRaw =
    cashAvailable -
    reservedForBills -
    reservedForFood -
    reservedForDebt -
    reservedForSavings -
    emergencyBuffer;

  const safeToSpend = Math.max(Math.round(safeRaw), 0);
  const perDay = Math.round(safeToSpend / daysLeft);

  return {
    safeToSpend,
    perDay,
    reservedForBills,
    reservedForFood,
    reservedForDebt,
    reservedForSavings,
    emergencyBuffer,
    daysUntilIncome: daysLeft,
  };
}

export interface SurvivalResult {
  runwayDays: number;
  dailyLimit: number;
  minimumRequiredCash: number;
  upcomingBillsTotal: number;
  emergencyGap: number;
  status: 'safe' | 'tight' | 'critical';
}

/** Survival runway until the next income lands. */
export function calcSurvival(input: SafeToSpendInput): SurvivalResult {
  const { cashAvailable, bills, debts, settings } = input;
  const daysLeft = Math.max(daysUntil(settings.nextIncomeDate), 1);
  const dailySurvival = Math.max(settings.survivalMonthlyExpense / 30, 1);

  const upcomingBillsTotal = sumBills(billsBeforeIncome(bills, settings.nextIncomeDate));
  const debtMins = totalDebtMinimums(debts);
  const minimumRequiredCash = upcomingBillsTotal + debtMins + dailySurvival * daysLeft;

  const spendable = Math.max(cashAvailable - upcomingBillsTotal - debtMins, 0);
  const runwayDays = Math.floor(spendable / dailySurvival);
  const dailyLimit = Math.round(spendable / daysLeft);

  const emergencyGap = Math.max(minimumRequiredCash - cashAvailable, 0);

  let status: SurvivalResult['status'] = 'safe';
  if (runwayDays < daysLeft) status = 'critical';
  else if (runwayDays < daysLeft + 5) status = 'tight';

  return {
    runwayDays,
    dailyLimit,
    minimumRequiredCash: Math.round(minimumRequiredCash),
    upcomingBillsTotal,
    emergencyGap: Math.round(emergencyGap),
    status,
  };
}

export interface TravelResult {
  totalTripCost: number;
  cashAfterTrip: number;
  stillNeeded: number;
  dailySavingTarget: number;
  status: 'safe' | 'risky' | 'not_affordable';
}

/** Travel affordability — includes flights, baggage, lodging, food, docs, buffer. */
export function calcTravel(plan: TravelPlan): TravelResult {
  const totalTripCost =
    plan.flightCost +
    plan.baggageCost +
    plan.lodgingCost +
    plan.transportationCost +
    plan.foodBudget +
    plan.documentCost +
    plan.emergencyBuffer;

  const projectedCash = plan.currentAvailableCash + plan.expectedIncomeBeforeTrip;
  const cashAfterTrip = projectedCash - totalTripCost;
  const stillNeeded = Math.max(-cashAfterTrip, 0);

  const daysToDeparture = Math.max(daysUntil(plan.departureDate), 1);
  const dailySavingTarget = stillNeeded > 0 ? Math.ceil(stillNeeded / daysToDeparture) : 0;

  let status: TravelResult['status'] = 'safe';
  if (cashAfterTrip < 0) status = 'not_affordable';
  else if (cashAfterTrip < plan.emergencyBuffer) status = 'risky';

  return {
    totalTripCost: Math.round(totalTripCost),
    cashAfterTrip: Math.round(cashAfterTrip),
    stillNeeded: Math.round(stillNeeded),
    dailySavingTarget,
    status,
  };
}
