/**
 * cjBotService — CJ-Bot is the BRAIN of Freedom Ledger.
 *
 * Architecture:
 *   - The Expo app is the UI + personal-finance data system.
 *   - CJ-Bot (existing, Llama-powered) is the reasoning engine.
 *   - This service is the ONLY bridge between them. UI components never call a
 *     model directly — they call these typed methods.
 *
 * Provider model:
 *   `CJBotProvider` is the swappable backend. For MVP we ship `MockCJBotProvider`,
 *   which produces realistic analysis from the actual finance context (seed data
 *   and user-entered data) — not generic filler. To go live, implement
 *   `LlamaCJBotProvider` against CJ-Bot's existing endpoint and set it as the
 *   active provider. No screen changes required.
 *
 * TODO(cjbot-live): implement LlamaCJBotProvider.call() to POST to the real
 *   CJ-Bot endpoint with { system: CJ_BOT_SYSTEM_INSTRUCTION, role, context }.
 *   See `LlamaCJBotProvider` stub at the bottom of this file.
 */

import type {
  CJBotRequest,
  CJBotResponse,
  CJBotRole,
  FinanceContext,
  CategorySuggestion,
  RiskLevel,
} from './cjBotTypes';
import { CJ_BOT_SYSTEM_INSTRUCTION } from './cjBotTypes';
import type { Transaction, BudgetCategory, SavingsGoal, TravelPlan } from './models';
import { formatMoney, pct } from './format';
import { calcTravel } from './finance';

// ──────────────────────────────────────────────────────────────────────────
// Provider interface
// ──────────────────────────────────────────────────────────────────────────

export interface CJBotProvider {
  readonly name: string;
  call(request: CJBotRequest): Promise<CJBotResponse>;
}

// ──────────────────────────────────────────────────────────────────────────
// Mock provider — grounded in real finance context
// ──────────────────────────────────────────────────────────────────────────


function moneyTight(ctx: FinanceContext): boolean {
  return ctx.cashAvailable - ctx.upcomingBillsTotal - ctx.totalDebtMinimums < 100;
}

class MockCJBotProvider implements CJBotProvider {
  readonly name = 'mock';

  async call(request: CJBotRequest): Promise<CJBotResponse> {
    // Tiny delay so the UI shows a thinking state like the real backend will.
    await new Promise((r) => setTimeout(r, 380));
    const { role, financeContext: ctx } = request;
    switch (role) {
      case 'cpa_analyst':
        return this.cpa(ctx, request.userMessage);
      case 'statement_reader':
        return this.statement(ctx, request.selectedTransactions);
      case 'budget_adjuster':
        return this.budget(ctx, request.selectedBudgetCategory);
      case 'survival_analyst':
        return this.survival(ctx);
      case 'travel_decision':
        return this.travel(ctx, request.selectedTripPlan);
      case 'foundation_builder':
        return this.foundation(ctx);
      case 'debt_prioritizer':
        return this.debt(ctx);
      case 'savings_enforcer':
        return this.savings(ctx);
      default:
        return this.cpa(ctx, request.userMessage);
    }
  }

  // ---- CPA Analyst ----
  private cpa(ctx: FinanceContext, msg?: string): CJBotResponse {
    const tight = moneyTight(ctx);
    const after = ctx.cashAvailable - ctx.upcomingBillsTotal - ctx.totalDebtMinimums;
    const risk: RiskLevel = after < 0 ? 'urgent' : tight ? 'risky' : after < 250 ? 'caution' : 'safe';

    const actionItems = [
      `Hold ${formatMoney(ctx.upcomingBillsTotal, ctx.currency)} for ${ctx.upcomingBills.length} bill(s) due before ${ctx.daysUntilIncome} days from now.`,
      `Keep ${formatMoney(ctx.totalDebtMinimums, ctx.currency)} ready for debt minimums.`,
    ];
    if (ctx.rainyDayProgress.current < ctx.rainyDayProgress.target) {
      const gap = ctx.rainyDayProgress.target - ctx.rainyDayProgress.current;
      actionItems.push(
        tight
          ? `Rainy Day is short ${formatMoney(gap, ctx.currency)} — move even $5 this week.`
          : `Top up Rainy Day toward ${formatMoney(ctx.rainyDayProgress.target, ctx.currency)} (short ${formatMoney(gap, ctx.currency)}).`,
      );
    }

    // Temporal: if this month is pacing above the historical baseline, flag it.
    if (ctx.hasEnoughHistory && ctx.spendingPace === 'ahead') {
      actionItems.push(
        `You're pacing to spend ${formatMoney(ctx.projectedMonthEndSpending, ctx.currency)} this month — about ${Math.abs(Math.round(ctx.spendingVsAveragePct))}% over your ${formatMoney(ctx.averageMonthlySpending, ctx.currency)} average. Ease off where you can.`,
      );
    }

    const paceLine =
      ctx.hasEnoughHistory && ctx.spendingPace !== 'no_baseline'
        ? ctx.spendingPace === 'ahead'
          ? ` Based on ${ctx.monthsOfHistory} months of history, you're trending above your usual spend.`
          : ctx.spendingPace === 'behind'
          ? ` You're tracking below your ${formatMoney(ctx.averageMonthlySpending, ctx.currency)} monthly average — good.`
          : ` You're tracking near your usual ${formatMoney(ctx.averageMonthlySpending, ctx.currency)}/month.`
        : '';

    return {
      summary: msg
        ? `Looking at your numbers to answer: "${msg.slice(0, 80)}"`
        : `You have ${formatMoney(ctx.cashAvailable, ctx.currency)} on hand with ${formatMoney(ctx.upcomingBillsTotal, ctx.currency)} in bills and ${formatMoney(ctx.totalDebtMinimums, ctx.currency)} in debt minimums before your next income.${paceLine}`,
      recommendation:
        after < 0
          ? `You are short by ${formatMoney(-after, ctx.currency)} against obligations before income. Pay critical bills first, defer anything non-essential, and don't add new spending.`
          : tight
          ? `It's tight. After bills and debt minimums you'd have about ${formatMoney(after, ctx.currency)}. Protect food, meds, and transport before anything else.`
          : `You have roughly ${formatMoney(after, ctx.currency)} of room after obligations. Send a slice to Rainy Day before it gets spent.`,
      riskLevel: risk,
      actionItems,
      explanation: `Math: cash ${formatMoney(ctx.cashAvailable, ctx.currency)} − bills ${formatMoney(ctx.upcomingBillsTotal, ctx.currency)} − debt minimums ${formatMoney(ctx.totalDebtMinimums, ctx.currency)} = ${formatMoney(after, ctx.currency)} before your next income in ${ctx.daysUntilIncome} day(s).${ctx.hasEnoughHistory ? ` Projection uses ${ctx.monthsOfHistory} months of your history.` : ''}`,
      requiresUserApproval: false,
    };
  }

  // ---- Statement Reader ----
  private statement(ctx: FinanceContext, txns?: Transaction[]): CJBotResponse {
    const list = txns ?? ctx.recentTransactions;
    const lowConf = list.filter(
      (t) => (t.parsingConfidence ?? 1) < 0.6 || t.category === 'Needs Review',
    );
    const dupes = list.filter((t) => t.isDuplicateCandidate);
    const transfers = list.filter((t) => t.type === 'transfer');

    return {
      summary: `Reviewed ${list.length} row(s): ${lowConf.length} need a look, ${dupes.length} possible duplicate(s), ${transfers.length} transfer(s).`,
      recommendation:
        lowConf.length > 0
          ? `Confirm the ${lowConf.length} low-confidence row(s) before approving. I left them as "Needs Review" rather than guessing.`
          : `Rows look clean. Confirm categories and approve when ready — nothing saves until you do.`,
      riskLevel: lowConf.length > 0 || dupes.length > 0 ? 'caution' : 'safe',
      actionItems: [
        ...lowConf.slice(0, 3).map((t) => `Check "${t.description}" — ${formatMoney(t.amount, ctx.currency)}.`),
        ...dupes.slice(0, 2).map((t) => `Possible duplicate: "${t.description}".`),
      ],
      explanation: `I never overwrite the ledger from an import. Approve to add; reject to discard the batch.`,
      requiresUserApproval: true,
    };
  }

  // ---- Budget Adjuster ----
  private budget(ctx: FinanceContext, cat?: BudgetCategory): CJBotResponse {
    if (cat) {
      const over = cat.actualAmount - cat.budgetAmount;
      const hist = ctx.categoryAverages[cat.category];
      const hasHistory = hist && hist.monthsSeen >= 2;

      // With history, budget to the projected next month (trend-aware) or the
      // average — that's how real budgeting works. Without it, fall back to this
      // month's actual plus a small buffer.
      let rec: number;
      let basisNote: string;
      if (hasHistory) {
        const target = hist.trend === 'rising' ? hist.projectedNextMonth : hist.average;
        rec = Math.max(Math.ceil((target * 1.05) / 5) * 5, 5);
        basisNote =
          hist.trend === 'rising'
            ? `your spend here has been climbing (avg ${formatMoney(hist.average, ctx.currency)}/mo, trending toward ${formatMoney(hist.projectedNextMonth, ctx.currency)})`
            : hist.trend === 'falling'
            ? `your spend here has been easing (avg ${formatMoney(hist.average, ctx.currency)}/mo)`
            : `your ${formatMoney(hist.average, ctx.currency)}/mo average over ${hist.monthsSeen} months`;
      } else {
        rec =
          over > 0
            ? Math.ceil((cat.actualAmount * 1.05) / 5) * 5
            : Math.max(Math.ceil((cat.actualAmount * 1.1) / 5) * 5, 5);
        basisNote = `this month's spend (not enough history yet for a trend)`;
      }

      return {
        summary: `${cat.category}: spent ${formatMoney(cat.actualAmount, ctx.currency)} of ${formatMoney(cat.budgetAmount, ctx.currency)}${hasHistory ? ` · ${formatMoney(hist.average, ctx.currency)}/mo average` : ''}.`,
        recommendation: cat.locked
          ? `This category is locked, so I'm leaving it. Unlock it if you want me to propose a change.`
          : over > 0
          ? `You're over by ${formatMoney(over, ctx.currency)}. Based on ${basisNote}, a realistic budget is ${formatMoney(rec, ctx.currency)}.`
          : `Based on ${basisNote}, ${formatMoney(rec, ctx.currency)} is a realistic budget here.${hasHistory && hist.trend === 'falling' ? ' Route what you save to Rainy Day.' : ''}`,
        riskLevel: over > 0 ? 'caution' : 'safe',
        actionItems: cat.locked ? [] : [`Approve to set ${cat.category} to ${formatMoney(rec, ctx.currency)}.`],
        suggestedBudgetAmount: cat.locked ? undefined : rec,
        explanation: hasHistory
          ? `Recommendation is built from ${hist.monthsSeen} months of your actual spending in this category (${hist.trend} trend), rounded to the nearest $5. I never change your budget without approval.`
          : `Recommendation = recent actual spend with a small buffer, rounded to the nearest $5. It'll sharpen as you build history. I never change your budget without approval.`,
        requiresUserApproval: !cat.locked,
      };
    }

    const histNote =
      ctx.hasEnoughHistory
        ? ` Your average is ${formatMoney(ctx.averageMonthlySpending, ctx.currency)}/month; you're projected to spend ${formatMoney(ctx.projectedNextMonthSpending, ctx.currency)} next month.`
        : '';
    return {
      summary: `Monthly spend so far is ${formatMoney(ctx.monthlySpending, ctx.currency)}.${histNote}`,
      recommendation: `Open a category to get a specific, approvable recommendation. ${ctx.hasEnoughHistory ? 'Each one is based on your actual spending history and trend.' : 'Each one is based on what you actually spent.'}`,
      riskLevel: 'safe',
      actionItems: ['Tap a category card to see a proposed amount.'],
      explanation: `Budgets only change when you approve a recommendation.`,
      requiresUserApproval: false,
    };
  }

  // ---- Survival Analyst ----
  private survival(ctx: FinanceContext): CJBotResponse {
    const daily = Math.max(ctx.survivalMonthlyExpense / 30, 1);
    const spendable = Math.max(
      ctx.cashAvailable - ctx.upcomingBillsTotal - ctx.totalDebtMinimums,
      0,
    );
    const runway = Math.floor(spendable / daily);
    const risk: RiskLevel =
      runway < ctx.daysUntilIncome ? 'urgent' : runway < ctx.daysUntilIncome + 5 ? 'risky' : 'safe';

    return {
      summary: `About ${runway} day(s) of runway. Next income is ${ctx.daysUntilIncome} day(s) out.`,
      recommendation:
        runway < ctx.daysUntilIncome
          ? `You don't reach your next income at current pace. Cap daily spend at ${formatMoney(Math.floor(spendable / Math.max(ctx.daysUntilIncome, 1)), ctx.currency)} and pay only must-pay items.`
          : `You can reach your next income. Keep daily spend near ${formatMoney(Math.floor(spendable / Math.max(ctx.daysUntilIncome, 1)), ctx.currency)} to leave a buffer.`,
      riskLevel: risk,
      actionItems: [
        `Must-pay before income: ${formatMoney(ctx.upcomingBillsTotal + ctx.totalDebtMinimums, ctx.currency)}.`,
        `Protect food, meds, and transport first.`,
      ],
      explanation: `Runway = (cash ${formatMoney(ctx.cashAvailable, ctx.currency)} − bills − debt minimums) ÷ daily survival ${formatMoney(daily, ctx.currency)}.`,
      requiresUserApproval: false,
    };
  }

  // ---- Travel Decision ----
  private travel(ctx: FinanceContext, plan?: TravelPlan): CJBotResponse {
    if (!plan) {
      return {
        summary: `No trip loaded.`,
        recommendation: `Add trip costs in Travel Planner and I'll tell you if it's safe, risky, or not affordable.`,
        riskLevel: 'safe',
        actionItems: ['Enter flight, baggage, lodging, food, docs, and buffer.'],
        explanation: `I include an emergency buffer in every travel decision.`,
        requiresUserApproval: false,
      };
    }
    const r = calcTravel(plan);
    const risk: RiskLevel =
      r.status === 'not_affordable' ? 'urgent' : r.status === 'risky' ? 'risky' : 'safe';
    return {
      summary: `${plan.destination}: total cost ${formatMoney(r.totalTripCost, ctx.currency)}, leaving ${formatMoney(r.cashAfterTrip, ctx.currency)} after.`,
      recommendation:
        r.status === 'not_affordable'
          ? `Not affordable yet. You're short ${formatMoney(r.stillNeeded, ctx.currency)}. Save ${formatMoney(r.dailySavingTarget, ctx.currency)}/day before departure or move the date.`
          : r.status === 'risky'
          ? `Doable but risky — it leaves less than your buffer. Pad savings by ${formatMoney(r.stillNeeded || plan.emergencyBuffer, ctx.currency)} first.`
          : `Safe to take. You keep ${formatMoney(r.cashAfterTrip, ctx.currency)} after the trip, buffer included.`,
      riskLevel: risk,
      actionItems:
        r.stillNeeded > 0
          ? [`Save ${formatMoney(r.dailySavingTarget, ctx.currency)}/day to close a ${formatMoney(r.stillNeeded, ctx.currency)} gap.`]
          : [`Keep the emergency buffer of ${formatMoney(plan.emergencyBuffer, ctx.currency)} untouched.`],
      explanation: `Total = flights + baggage + lodging + transport + food + documents + buffer. Compared against cash now + income before the trip.`,
      requiresUserApproval: false,
    };
  }

  // ---- Foundation Builder ----
  private foundation(ctx: FinanceContext): CJBotResponse {
    const tight = moneyTight(ctx);
    const savedZero = ctx.savedThisMonth <= 0;
    const rainyGap = Math.max(ctx.rainyDayProgress.target - ctx.rainyDayProgress.current, 0);
    const micro = tight ? (ctx.cashAvailable < 50 ? 1 : ctx.cashAvailable < 150 ? 5 : 10) : 25;

    const items: string[] = [];
    if (savedZero) items.push(`You've saved ${formatMoney(0, ctx.currency)} this month. Start with ${formatMoney(micro, ctx.currency)} today.`);
    if (rainyGap > 0) items.push(`Rainy Day is ${Math.round(pct(ctx.rainyDayProgress.current, ctx.rainyDayProgress.target) * 100)}% there — ${formatMoney(rainyGap, ctx.currency)} to go.`);
    if (!ctx.retirementStarted) items.push(`Retirement isn't started. Opening the account counts as progress even at ${formatMoney(0, ctx.currency)}.`);

    // Temporal: project when each fund is reached at the observed savings pace.
    const onPace = ctx.goalProjections.filter((g) => g.monthsToTarget != null && g.monthsToTarget > 0 && g.basis === 'observed');
    for (const g of onPace.slice(0, 2)) {
      const yrs = (g.monthsToTarget as number) / 12;
      const when =
        (g.monthsToTarget as number) <= 1
          ? 'within a month'
          : (g.monthsToTarget as number) < 12
          ? `in about ${g.monthsToTarget} months`
          : `in about ${yrs.toFixed(1)} years`;
      items.push(`At your pace of ${formatMoney(g.monthlyContribution, ctx.currency)}/month, ${g.name} is funded ${when}.`);
    }
    const stalled = ctx.goalProjections.filter((g) => g.monthsToTarget == null && g.basis === 'none');
    if (stalled.length > 0 && ctx.observedMonthlySavings <= 0) {
      items.push(`Set a monthly amount for ${stalled[0].name} — even ${formatMoney(micro, ctx.currency)} gives it a finish line.`);
    }

    const paceSummary =
      ctx.observedMonthlySavings > 0
        ? ` You've been saving about ${formatMoney(ctx.observedMonthlySavings, ctx.currency)}/month.`
        : '';

    return {
      summary: savedZero
        ? `No savings yet this month — let's fix that with a small, real amount.${paceSummary}`
        : `You've moved ${formatMoney(ctx.savedThisMonth, ctx.currency)} to savings this month. Keep the streak.${paceSummary}`,
      recommendation: tight
        ? `Money's tight, so don't set a number you'll break. Move ${formatMoney(micro, ctx.currency)} now — small and consistent beats big and skipped.`
        : `Send ${formatMoney(micro, ctx.currency)} to Rainy Day this week, then set a $${Math.max(micro, 20)} auto-contribution per paycheck.`,
      riskLevel: savedZero ? 'caution' : 'safe',
      actionItems: items.length ? items : [`Add ${formatMoney(micro, ctx.currency)} to Rainy Day to stay ahead.`],
      savingsSuggestion: micro,
      explanation: `The three funds — Rainy Day, Emergency, Retirement — are what keep one bad week from becoming a crisis.${ctx.observedMonthlySavings > 0 ? ' Timelines above use your actual savings pace.' : ''} I push them every time.`,
      requiresUserApproval: false,
    };
  }

  // ---- Debt Prioritizer ----
  private debt(ctx: FinanceContext): CJBotResponse {
    const rainyShort = ctx.rainyDayProgress.current < 250;
    return {
      summary: `Total debt ${formatMoney(ctx.totalDebt, ctx.currency)}, with ${formatMoney(ctx.totalDebtMinimums, ctx.currency)} in minimums due.`,
      recommendation: rainyShort
        ? `Pay every minimum to stay current, but don't overpay debt yet — your Rainy Day fund is under ${formatMoney(250, ctx.currency)}. One emergency on a credit card undoes an extra payment. Build the buffer first.`
        : `Cover all minimums, then put extra toward the highest-interest balance. That's where your money saves the most.`,
      riskLevel: ctx.totalDebtMinimums > ctx.cashAvailable ? 'risky' : 'caution',
      actionItems: [
        `Pay all minimums first: ${formatMoney(ctx.totalDebtMinimums, ctx.currency)}.`,
        rainyShort
          ? `Hold extra debt payments until Rainy Day passes ${formatMoney(250, ctx.currency)}.`
          : `Send extra to the highest-interest balance.`,
      ],
      explanation: `Order: stay current everywhere → build a small cash buffer → then attack interest. This protects you from new debt.`,
      requiresUserApproval: false,
    };
  }

  // ---- Savings Enforcer ----
  private savings(ctx: FinanceContext): CJBotResponse {
    const savedZero = ctx.savedThisMonth <= 0;
    const leak = ctx.recentTransactions.find((t) => t.category === 'Subscriptions');
    const micro = ctx.cashAvailable < 50 ? 1 : ctx.cashAvailable < 150 ? 5 : 10;
    return {
      summary: savedZero ? `Zero saved this month so far.` : `Saved ${formatMoney(ctx.savedThisMonth, ctx.currency)} this month.`,
      recommendation: savedZero
        ? `Don't end the month at zero. Move ${formatMoney(micro, ctx.currency)} right now — then set it to repeat.`
        : `Good. Lock in a per-paycheck auto-contribution so it's not a decision each time.`,
      riskLevel: savedZero ? 'caution' : 'safe',
      actionItems: [
        `Auto-move ${formatMoney(micro, ctx.currency)} per paycheck to Rainy Day.`,
        leak ? `Review "${leak.description}" (${formatMoney(leak.amount, ctx.currency)}) — recurring charge, possible leak.` : `Scan subscriptions for anything unused.`,
      ],
      savingsSuggestion: micro,
      explanation: `Saving works when it's automatic and small enough to never skip.`,
      requiresUserApproval: false,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Active provider (swap here to go live)
// ──────────────────────────────────────────────────────────────────────────

let activeProvider: CJBotProvider = new MockCJBotProvider();

export function setCJBotProvider(p: CJBotProvider) {
  activeProvider = p;
}

export function getCJBotProviderName(): string {
  return activeProvider.name;
}

// ──────────────────────────────────────────────────────────────────────────
// Public API — what screens call
// ──────────────────────────────────────────────────────────────────────────

export const cjBotService = {
  getDailyDashboardInsight(financeContext: FinanceContext): Promise<CJBotResponse> {
    return activeProvider.call({ role: 'cpa_analyst', financeContext, screenContext: 'dashboard' });
  },

  analyzeImportedTransactions(
    transactions: Transaction[],
    financeContext: FinanceContext,
  ): Promise<CJBotResponse> {
    return activeProvider.call({
      role: 'statement_reader',
      financeContext,
      screenContext: 'import_review',
      selectedTransactions: transactions,
    });
  },

  /** Per-row category suggestions for the import review screen. */
  async suggestTransactionCategory(
    transaction: Transaction,
    _financeContext: FinanceContext,
  ): Promise<CategorySuggestion> {
    // Lightweight rule-based suggestion (mirrors what the Llama backend will do).
    // TODO(cjbot-live): replace with a CJ-Bot call returning the same shape.
    const desc = transaction.description.toLowerCase();
    const conf = (transaction.ocrConfidence ?? 1) * (transaction.parsingConfidence ?? 1);
    const rules: [RegExp, Transaction['type'], string][] = [
      [/uber|didi|taxi|cabify/, 'expense', 'Uber / Rideshare'],
      [/mercado|super|grocer|walmart|automercado/, 'expense', 'Food / Groceries'],
      [/netflix|spotify|hbo|cloud|icloud|prime/, 'expense', 'Subscriptions'],
      [/farmacia|pharmacy|clinic|salud|health/, 'expense', 'Medication / Health'],
      [/nomina|payroll|deposito|salary|paycheck/, 'income', 'Job Paycheck'],
      [/transf|transfer|movil/, 'transfer', 'Personal Transfer'],
      [/rent|alquiler|renta/, 'bill_payment', 'Rent / Housing'],
      [/restaurant|soda|cafe|bar|lunch/, 'expense', 'Restaurants / Eating Out'],
    ];
    let suggestedType: Transaction['type'] = transaction.type;
    let suggestedCategory = transaction.category;
    let matched = false;
    for (const [re, type, cat] of rules) {
      if (re.test(desc)) {
        suggestedType = type;
        suggestedCategory = cat;
        matched = true;
        break;
      }
    }
    const needsReview = conf < 0.6 || !matched;
    return {
      transactionId: transaction.id,
      suggestedType,
      suggestedCategory: needsReview && !matched ? 'Needs Review' : suggestedCategory,
      confidence: Math.round(conf * 100) / 100,
      needsReview,
      reason: matched
        ? `Matched "${suggestedCategory}" from the description.`
        : `Couldn't confidently match this — left as Needs Review for you to confirm.`,
    };
  },

  generateBudgetRecommendations(
    _month: string,
    financeContext: FinanceContext,
    category?: BudgetCategory,
  ): Promise<CJBotResponse> {
    return activeProvider.call({
      role: 'budget_adjuster',
      financeContext,
      screenContext: 'budget',
      selectedBudgetCategory: category,
    });
  },

  analyzeCanIAffordThis(
    amount: number,
    category: string,
    financeContext: FinanceContext,
  ): Promise<CJBotResponse> {
    return activeProvider.call({
      role: 'cpa_analyst',
      financeContext,
      screenContext: 'chat',
      userMessage: `Can I afford ${formatMoney(amount, financeContext.currency)} on ${category}?`,
    });
  },

  calculateSurvivalGuidance(financeContext: FinanceContext): Promise<CJBotResponse> {
    return activeProvider.call({
      role: 'survival_analyst',
      financeContext,
      screenContext: 'survival',
    });
  },

  analyzeTravelPlan(travelPlan: TravelPlan, financeContext: FinanceContext): Promise<CJBotResponse> {
    return activeProvider.call({
      role: 'travel_decision',
      financeContext,
      screenContext: 'travel',
      selectedTripPlan: travelPlan,
    });
  },

  generateFoundationBuilderAdvice(financeContext: FinanceContext): Promise<CJBotResponse> {
    return activeProvider.call({
      role: 'foundation_builder',
      financeContext,
      screenContext: 'goals',
    });
  },

  prioritizeDebtPayments(financeContext: FinanceContext): Promise<CJBotResponse> {
    return activeProvider.call({
      role: 'debt_prioritizer',
      financeContext,
      screenContext: 'debt',
    });
  },

  chatWithCJBot(
    role: CJBotRole,
    message: string,
    financeContext: FinanceContext,
  ): Promise<CJBotResponse> {
    return activeProvider.call({
      role,
      userMessage: message,
      financeContext,
      screenContext: 'chat',
    });
  },
};

// ──────────────────────────────────────────────────────────────────────────
// LIVE PROVIDER — connects Freedom Ledger to the deployed cj-bot endpoint.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Default endpoint for the deployed cj-bot Supabase Edge Function.
 * verify_jwt is disabled on the function, so the anon key is optional.
 * Override per-app via the constructor if the project URL changes.
 */
export const CJ_BOT_DEFAULT_ENDPOINT =
  'https://vzzzqsmqqaoilkmskadl.supabase.co/functions/v1/cj-bot';

/**
 * Live provider. The deployed cj-bot is a deterministic orchestrator that
 * returns `{ response, layer, confidence, ... }` — a single text string rather
 * than the structured CJBotResponse the UI renders. This adapter:
 *   1. POSTs { message, role, context } (+ the shared system instruction),
 *   2. maps the text reply onto CJBotResponse,
 *   3. ALWAYS falls back to the local provider on any error, timeout, or
 *      unusable reply, so personal-finance numbers stay grounded and the app
 *      never breaks if the endpoint is unreachable.
 *
 * Wire it in app startup:
 *   import { setCJBotProvider, LlamaCJBotProvider } from '@/services/cjBotService';
 *   setCJBotProvider(new LlamaCJBotProvider());            // uses default endpoint
 *   // or new LlamaCJBotProvider(url, anonKey)
 */
export class LlamaCJBotProvider implements CJBotProvider {
  readonly name = 'cj-bot-llama';
  private fallback = new MockCJBotProvider();

  constructor(
    private endpoint: string = CJ_BOT_DEFAULT_ENDPOINT,
    private token?: string,
    private timeoutMs = 12000,
  ) {}

  async call(request: CJBotRequest): Promise<CJBotResponse> {
    // The local provider is always computed first: it grounds risk level and
    // action items in the user's real numbers, and is the guaranteed fallback.
    const local = await this.fallback.call(request);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({
          system: CJ_BOT_SYSTEM_INSTRUCTION,
          role: request.role,
          screen: request.screenContext,
          // The endpoint requires `message`; for screen-driven (non-chat)
          // calls we synthesize a concise prompt from the role + context.
          message: request.userMessage ?? buildPromptForRole(request),
          context: request.financeContext,
          selectedTransactions: request.selectedTransactions,
          selectedBudgetCategory: request.selectedBudgetCategory,
          selectedGoal: request.selectedGoal,
          selectedTripPlan: request.selectedTripPlan,
        }),
      });

      if (!res.ok) return local;
      const data: unknown = await res.json();
      const text = extractReplyText(data);

      // If the endpoint returned an error or a generic/empty reply, keep the
      // grounded local response rather than surfacing an unusable string.
      if (!text || isUnusableReply(text)) return local;

      // Merge: live text becomes the recommendation; risk level, action items,
      // and approval flag stay from the locally-grounded analysis.
      return {
        ...local,
        recommendation: text.trim(),
        explanation: local.explanation,
      };
    } catch {
      // Network error, abort/timeout, or bad JSON — degrade gracefully.
      return local;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Pull the human-readable reply out of cj-bot's various response shapes. */
function extractReplyText(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.error === 'string') return null;
  for (const key of ['response', 'reply', 'message', 'text', 'answer', 'output']) {
    const v = d[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/** Detect placeholder/"knowledge loading" replies that shouldn't reach the UI. */
function isUnusableReply(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('knowledge loading') ||
    t.includes('ask about:') ||
    t.length < 12
  );
}

/** Build a concise prompt for screen-driven calls that have no user message. */
function buildPromptForRole(request: CJBotRequest): string {
  const c = request.financeContext;
  const base = `Personal finances only. Cash ${c.currency} ${Math.round(
    c.cashAvailable,
  )}, ${c.daysUntilIncome} days until next income, monthly survival ${
    c.currency
  } ${Math.round(c.survivalMonthlyExpense)}, upcoming bills ${c.currency} ${Math.round(
    c.upcomingBillsTotal,
  )}, total debt ${c.currency} ${Math.round(c.totalDebt)}.`;
  const ask: Record<string, string> = {
    cpa_analyst: 'Give a short personal cash-flow read and one concrete next step.',
    statement_reader: 'Summarize what these imported transactions mean for spending.',
    budget_adjuster: 'Where am I overspending and what should the budget be?',
    survival_analyst: 'How many days does my cash last and what is my safe daily spend?',
    travel_decision: 'Is the planned trip safe, risky, or not affordable yet?',
    foundation_builder:
      'How do I grow Rainy Day, Emergency, and Retirement funds from here, even slowly?',
    debt_prioritizer: 'Which debt should I pay first without starving savings?',
    savings_enforcer: 'Find the leaks and tell me what I can save this month.',
  };
  return `${base} ${ask[request.role] ?? ask.cpa_analyst}`;
}
