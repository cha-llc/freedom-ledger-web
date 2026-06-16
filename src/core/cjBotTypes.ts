/**
 * CJ-Bot — the reasoning engine of Freedom Ledger.
 *
 * CJ-Bot is NOT a separate chatbot bolted onto the app. It is the intelligence
 * layer for the entire app. Every screen sends structured finance context to
 * CJ-Bot and receives CPA-style analysis back.
 *
 * CJ-Bot is powered by Llama (existing backend). For MVP these types are served
 * by smart mock logic in cjBotService.ts; the real endpoint replaces the mock
 * provider later without changing this contract.
 */

import type {
  Transaction,
  BudgetCategory,
  SavingsGoal,
  TravelPlan,
  Bill,
  Debt,
} from './models';

export type CJBotRole =
  | 'cpa_analyst'
  | 'statement_reader'
  | 'budget_adjuster'
  | 'survival_analyst'
  | 'travel_decision'
  | 'foundation_builder'
  | 'debt_prioritizer'
  | 'savings_enforcer';

export type RiskLevel = 'safe' | 'caution' | 'risky' | 'urgent';

/**
 * A compact, structured snapshot of CJ's PERSONAL finances.
 * This is what gets sent to the Llama backend as grounding context.
 */
export interface FinanceContext {
  currency: string;
  cashAvailable: number;
  nextIncomeAmount: number;
  nextIncomeDate: string;
  daysUntilIncome: number;
  survivalMonthlyExpense: number;

  monthlySpending: number;
  monthlyIncome: number;

  upcomingBills: Bill[];
  upcomingBillsTotal: number;
  criticalBillsTotal: number;

  totalDebt: number;
  totalDebtMinimums: number;

  goals: SavingsGoal[];
  rainyDayProgress: { current: number; target: number };
  emergencyProgress: { current: number; target: number };
  retirementStarted: boolean;

  recentTransactions: Transaction[];
  savedThisMonth: number;

  // ── Temporal: history, current pacing, and projection ──
  // Present once there is data; lets CJ-Bot reason over time, not just today.
  monthsOfHistory: number;
  hasEnoughHistory: boolean;
  averageMonthlySpending: number;
  averageMonthlyIncome: number;
  // This month so far vs. the historical baseline.
  monthToDateSpending: number;
  projectedMonthEndSpending: number;
  spendingPace: 'ahead' | 'behind' | 'on_track' | 'no_baseline';
  spendingVsAveragePct: number;
  // Next month forecast.
  projectedNextMonthSpending: number;
  projectionConfidence: 'high' | 'medium' | 'low' | 'none';
  // Notable category movements (rising/falling) for narrative.
  risingCategories: { category: string; average: number; trendPctPerMonth: number }[];
  // Per-category historical monthly average + trend, for budgeting any category.
  categoryAverages: Record<
    string,
    { average: number; recent: number; trend: 'rising' | 'falling' | 'stable' | 'insufficient'; projectedNextMonth: number; monthsSeen: number }
  >;
  // When each savings goal is projected to be reached.
  goalProjections: {
    name: string;
    monthsToTarget: number | null;
    monthlyContribution: number;
    basis: 'observed' | 'target' | 'none';
  }[];
  observedMonthlySavings: number;
}

export type ScreenContext =
  | 'dashboard'
  | 'upload'
  | 'import_review'
  | 'budget'
  | 'transactions'
  | 'bills'
  | 'debt'
  | 'goals'
  | 'travel'
  | 'survival'
  | 'chat';

export interface CJBotRequest {
  role: CJBotRole;
  userMessage?: string;
  financeContext: FinanceContext;
  screenContext: ScreenContext;
  selectedTransactions?: Transaction[];
  selectedBudgetCategory?: BudgetCategory;
  selectedGoal?: SavingsGoal;
  selectedTripPlan?: TravelPlan;
}

export interface CJBotResponse {
  summary: string;
  recommendation: string;
  riskLevel: RiskLevel;
  actionItems: string[];
  suggestedCategory?: string;
  suggestedBudgetAmount?: number;
  savingsSuggestion?: number;
  explanation: string;
  requiresUserApproval: boolean;
}

/** Per-transaction category suggestion returned during import review. */
export interface CategorySuggestion {
  transactionId: string;
  suggestedType: Transaction['type'];
  suggestedCategory: string;
  confidence: number; // 0..1
  needsReview: boolean;
  reason: string;
}

export const CJ_BOT_ROLES: { role: CJBotRole; label: string; blurb: string }[] = [
  { role: 'cpa_analyst', label: 'CPA Analyst', blurb: 'Full personal cash-flow read' },
  { role: 'statement_reader', label: 'Statement Reader', blurb: 'Interpret uploads & flag rows' },
  { role: 'budget_adjuster', label: 'Budget Adjuster', blurb: 'Realistic category changes' },
  { role: 'survival_analyst', label: 'Survival Analyst', blurb: 'Days of runway left' },
  { role: 'travel_decision', label: 'Travel Decision', blurb: 'Can you afford the trip?' },
  { role: 'foundation_builder', label: 'Foundation Builder', blurb: 'Force the 3 funds forward' },
  { role: 'debt_prioritizer', label: 'Debt Prioritizer', blurb: 'What to pay, in what order' },
  { role: 'savings_enforcer', label: 'Savings Enforcer', blurb: 'No-zero-savings months' },
];

/**
 * CJ-Bot system instruction. Sent to the Llama backend as the system prompt.
 * Exported so the real provider can use the exact same governing text.
 */
export const CJ_BOT_SYSTEM_INSTRUCTION = `You are CJ-Bot, the private AI brain inside Freedom Ledger. You are powered by Llama and act as CJ's personal finance intelligence system. Your job is to protect CJ's personal financial stability.

Freedom Ledger is for personal finances only. Do not track, request, estimate, or include business income, business revenue, invoices, client payments, company expenses, business taxes, or business accounting. Business finances are handled in a separate app.

You act with the discipline, caution, and clarity of a Certified Public Accountant-style personal financial analyst. You are not CJ's licensed CPA, attorney, investment adviser, or tax preparer. You do not file taxes, provide legal advice, or make guaranteed financial claims.

You analyze CJ's personal cash flow, bank statement imports, screenshots, transactions, bills, debt, savings goals, travel costs, budget categories, survival runway, and financial decisions.

Your top priorities are:
1. Keep CJ housed, fed, medicated, and safe.
2. Protect required transportation and work-related personal expenses.
3. Keep critical bills paid.
4. Build a Rainy Day Fund.
5. Build an Emergency Fund.
6. Start and grow a Retirement Fund.
7. Reduce unnecessary spending.
8. Prevent risky travel or purchases.
9. Help CJ make stable financial decisions.

You must be direct, calm, protective, and practical. Do not shame CJ. Do not use vague motivational advice. Use numbers, categories, and clear reasoning.

Never permanently change transactions, imported data, budget amounts, bills, debts, or savings goals without CJ's approval.

When reviewing uploaded PDF statements or screenshots, flag uncertainty. If OCR or parsing confidence is low, mark the transaction as Needs Review.

When CJ asks 'Can I afford this?', check: personal cash available, upcoming bills, food needs, medication/health needs, transportation needs, debt minimums, next expected income, rainy day fund progress, emergency fund progress, retirement progress, travel obligations, and emergency buffer. If the answer is no, say no clearly and explain why.

If money is tight, recommend micro-saving amounts like $1, $5, or $10 instead of unrealistic savings goals.

Always give CJ the next best practical step.`;
