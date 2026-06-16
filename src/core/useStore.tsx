'use client';

/**
 * Global store. A single Context provides all app data plus typed actions.
 * Screens never touch storage directly — they go through these actions, so the
 * "never save without approval" rules live in one place.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from 'react';
import type {
  Transaction,
  Bill,
  Debt,
  BudgetCategory,
  SavingsGoal,
  ImportBatch,
  TravelPlan,
  AppSettings,
} from './models';
import { storage, AppData } from './storage';
import { todayISO, uid } from './format';
import {
  monthlyTotals,
  billsBeforeIncome,
  sumBills,
  criticalBills,
  totalDebt,
  totalDebtMinimums,
  savedThisMonth,
} from './finance';
import { daysUntil } from './format';
import {
  buildTemporalSnapshot,
  projectGoals,
  projectCategorySpending,
  observedMonthlySavings,
} from './temporal';
import type { FinanceContext } from './cjBotTypes';

/** Detect data that is the fictitious demo seed rather than the user's own, so
 *  any demo data a previous version may have saved to a browser gets cleared and
 *  the app only ever displays real numbers. Conservative: requires fingerprints a
 *  real user could not coincidentally produce. */
function isDemoSeed(d: AppData): boolean {
  if (!d) return false;
  // The demo import batch is a fingerprint a real user could never produce.
  const hasDemoBatch = (d.importBatches ?? []).some(
    (b) => b.id === 'batch_demo' || b.sourceFileName === 'statement_apr.pdf',
  );
  if (hasDemoBatch) return true;

  // Otherwise require MULTIPLE seed fingerprints together, so we never wipe a real
  // user who happens to have a round number.
  const demoTxns = (d.transactions ?? []).filter(
    (t) =>
      t.description === 'AutoMercado Groceries' ||
      t.description === 'Uber ride - Alajuela' ||
      t.description === 'Paycheck deposit' ||
      t.description === 'Dog food' ||
      t.description === 'Pharmacy - meds',
  ).length;
  const seedCash = d.settings?.startingCashBalance === 186;
  const rainy = (d.goals ?? []).find((g) => g.id === 'goal_rainy');
  const seedRainy = rainy?.currentAmount === 82;

  const signals = [demoTxns >= 3, seedCash, seedRainy].filter(Boolean).length;
  return signals >= 2;
}

/** The real starting state: empty. Neutral default settings with no invented
 *  cash, income, bills, or transactions. Everything shown to the user from here
 *  is data they entered or imported themselves. The three foundation funds are
 *  created at zero so the user has something to contribute toward — these hold
 *  no fictitious balances (all start at 0). */
function emptyData(): AppData {
  const now = todayISO();
  const settings: AppSettings = {
    currency: 'USD',
    startingCashBalance: 0,
    nextIncomeDate: todayISO(),
    incomeFrequency: 'biweekly',
    survivalMonthlyExpense: 0,
    rainyDayTarget: 500,
    emergencyFundTarget: 1000,
    retirementContributionTarget: 0,
    aiProvider: 'cj-bot-llama',
    onboarded: false,
    biometricLockEnabled: false,
    notificationsEnabled: false,
    billReminderDays: 3,
    dailyLimitAlertsEnabled: false,
    paydayReminderEnabled: false,
  };
  return {
    settings,
    transactions: [],
    bills: [],
    debts: [],
    budget: [],
    goals: [
      {
        id: 'goal_rainy',
        name: 'Rainy Day Fund',
        type: 'rainy_day',
        targetAmount: 500,
        currentAmount: 0,
        currency: 'USD',
        priority: 'critical',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'goal_emergency',
        name: 'Emergency Fund',
        type: 'emergency',
        targetAmount: 1000,
        currentAmount: 0,
        currency: 'USD',
        priority: 'high',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'goal_retirement',
        name: 'Retirement Fund',
        type: 'retirement',
        targetAmount: 1000,
        currentAmount: 0,
        currency: 'USD',
        priority: 'medium',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    importBatches: [],
    travelPlans: [],
    pendingImports: {},
  };
}

interface Store extends AppData {
  ready: boolean;

  // settings
  updateSettings: (patch: Partial<AppSettings>) => void;

  // transactions
  addTransaction: (t: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateTransaction: (id: string, patch: Partial<Transaction>) => void;
  deleteTransaction: (id: string) => void;

  // bills
  addBill: (b: Omit<Bill, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateBill: (id: string, patch: Partial<Bill>) => void;
  deleteBill: (id: string) => void;
  toggleBillPaid: (id: string) => void;

  // debt
  addDebt: (d: Omit<Debt, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateDebt: (id: string, patch: Partial<Debt>) => void;
  deleteDebt: (id: string) => void;

  // budget
  updateBudgetCategory: (id: string, patch: Partial<BudgetCategory>) => void;
  approveBudgetRecommendation: (id: string) => void;
  rejectBudgetRecommendation: (id: string) => void;

  // goals
  addGoal: (g: Omit<SavingsGoal, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateGoal: (id: string, patch: Partial<SavingsGoal>) => void;
  addContribution: (id: string, amount: number) => void;

  // travel
  addTravelPlan: (p: Omit<TravelPlan, 'id' | 'createdAt' | 'updatedAt'>) => TravelPlan;
  updateTravelPlan: (id: string, patch: Partial<TravelPlan>) => void;
  deleteTravelPlan: (id: string) => void;

  // imports
  stageImport: (batch: ImportBatch, transactions: Transaction[]) => void;
  updatePendingTransaction: (batchId: string, txnId: string, patch: Partial<Transaction>) => void;
  removePendingTransaction: (batchId: string, txnId: string) => void;
  addPendingTransaction: (batchId: string, t: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => void;
  approveImport: (batchId: string) => void;
  rejectImport: (batchId: string) => void;
  deleteImportBatch: (batchId: string) => void;

  // derived
  cashAvailable: number;
  buildFinanceContext: () => FinanceContext;

  clearAllData: () => void;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppData>(emptyData());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const loaded = await storage.load();
      if (loaded && !isDemoSeed(loaded)) {
        // Real user data — keep it.
        setData(loaded);
      } else if (loaded && isDemoSeed(loaded)) {
        // A previous version saved fictitious demo data to this browser. Clear it
        // so the user sees only real numbers, and persist the clean empty state.
        const fresh = emptyData();
        setData(fresh);
        await storage.save(fresh);
      }
      // else: nothing saved yet → stay on the empty default.
      setReady(true);
    })();
  }, []);

  // Persist on every change once ready.
  useEffect(() => {
    if (ready) storage.save(data);
  }, [data, ready]);

  const stamp = () => todayISO();

  // ---- settings ----
  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setData((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  }, []);

  // ---- transactions ----
  const addTransaction: Store['addTransaction'] = useCallback((t) => {
    const txn: Transaction = { ...t, id: uid('txn_'), createdAt: stamp(), updatedAt: stamp() };
    setData((d) => ({ ...d, transactions: [txn, ...d.transactions] }));
  }, []);

  const updateTransaction: Store['updateTransaction'] = useCallback((id, patch) => {
    setData((d) => ({
      ...d,
      transactions: d.transactions.map((t) =>
        t.id === id ? { ...t, ...patch, updatedAt: stamp() } : t,
      ),
    }));
  }, []);

  const deleteTransaction: Store['deleteTransaction'] = useCallback((id) => {
    setData((d) => ({ ...d, transactions: d.transactions.filter((t) => t.id !== id) }));
  }, []);

  // ---- bills ----
  const addBill: Store['addBill'] = useCallback((b) => {
    const bill: Bill = { ...b, id: uid('bill_'), createdAt: stamp(), updatedAt: stamp() };
    setData((d) => ({ ...d, bills: [...d.bills, bill] }));
  }, []);
  const updateBill: Store['updateBill'] = useCallback((id, patch) => {
    setData((d) => ({
      ...d,
      bills: d.bills.map((b) => (b.id === id ? { ...b, ...patch, updatedAt: stamp() } : b)),
    }));
  }, []);
  const deleteBill: Store['deleteBill'] = useCallback((id) => {
    setData((d) => ({ ...d, bills: d.bills.filter((b) => b.id !== id) }));
  }, []);
  const toggleBillPaid: Store['toggleBillPaid'] = useCallback((id) => {
    setData((d) => ({
      ...d,
      bills: d.bills.map((b) => (b.id === id ? { ...b, paid: !b.paid, updatedAt: stamp() } : b)),
    }));
  }, []);

  // ---- debt ----
  const addDebt: Store['addDebt'] = useCallback((dd) => {
    const debt: Debt = { ...dd, id: uid('debt_'), createdAt: stamp(), updatedAt: stamp() };
    setData((d) => ({ ...d, debts: [...d.debts, debt] }));
  }, []);
  const updateDebt: Store['updateDebt'] = useCallback((id, patch) => {
    setData((d) => ({
      ...d,
      debts: d.debts.map((x) => (x.id === id ? { ...x, ...patch, updatedAt: stamp() } : x)),
    }));
  }, []);
  const deleteDebt: Store['deleteDebt'] = useCallback((id) => {
    setData((d) => ({ ...d, debts: d.debts.filter((x) => x.id !== id) }));
  }, []);

  // ---- budget ----
  const updateBudgetCategory: Store['updateBudgetCategory'] = useCallback((id, patch) => {
    setData((d) => ({
      ...d,
      budget: d.budget.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  }, []);
  // Approval applies the recommended amount — never auto-applied elsewhere.
  const approveBudgetRecommendation: Store['approveBudgetRecommendation'] = useCallback((id) => {
    setData((d) => ({
      ...d,
      budget: d.budget.map((b) =>
        b.id === id && b.recommendedAmount != null
          ? { ...b, budgetAmount: b.recommendedAmount, approved: true, recommendedAmount: undefined, recommendationReason: undefined }
          : b,
      ),
    }));
  }, []);
  const rejectBudgetRecommendation: Store['rejectBudgetRecommendation'] = useCallback((id) => {
    setData((d) => ({
      ...d,
      budget: d.budget.map((b) =>
        b.id === id ? { ...b, recommendedAmount: undefined, recommendationReason: undefined } : b,
      ),
    }));
  }, []);

  // ---- goals ----
  const addGoal: Store['addGoal'] = useCallback((g) => {
    const goal: SavingsGoal = { ...g, id: uid('goal_'), createdAt: stamp(), updatedAt: stamp() };
    setData((d) => ({ ...d, goals: [...d.goals, goal] }));
  }, []);
  const updateGoal: Store['updateGoal'] = useCallback((id, patch) => {
    setData((d) => ({
      ...d,
      goals: d.goals.map((g) => (g.id === id ? { ...g, ...patch, updatedAt: stamp() } : g)),
    }));
  }, []);
  const addContribution: Store['addContribution'] = useCallback((id, amount) => {
    setData((d) => ({
      ...d,
      goals: d.goals.map((g) =>
        g.id === id ? { ...g, currentAmount: g.currentAmount + amount, updatedAt: stamp() } : g,
      ),
    }));
  }, []);

  // ---- travel ----
  const addTravelPlan: Store['addTravelPlan'] = useCallback((p) => {
    const plan: TravelPlan = { ...p, id: uid('trip_'), createdAt: stamp(), updatedAt: stamp() };
    setData((d) => ({ ...d, travelPlans: [plan, ...d.travelPlans] }));
    return plan;
  }, []);
  const updateTravelPlan: Store['updateTravelPlan'] = useCallback((id, patch) => {
    setData((d) => ({
      ...d,
      travelPlans: d.travelPlans.map((p) =>
        p.id === id ? { ...p, ...patch, updatedAt: stamp() } : p,
      ),
    }));
  }, []);
  const deleteTravelPlan: Store['deleteTravelPlan'] = useCallback((id) => {
    setData((d) => ({ ...d, travelPlans: d.travelPlans.filter((p) => p.id !== id) }));
  }, []);

  // ---- imports ----
  // Staging holds parsed transactions OUT of the live ledger until approval.
  const stageImport: Store['stageImport'] = useCallback((batch, transactions) => {
    setData((d) => ({
      ...d,
      importBatches: [batch, ...d.importBatches.filter((b) => b.id !== batch.id)],
      pendingImports: { ...d.pendingImports, [batch.id]: transactions },
    }));
  }, []);

  const updatePendingTransaction: Store['updatePendingTransaction'] = useCallback(
    (batchId, txnId, patch) => {
      setData((d) => ({
        ...d,
        pendingImports: {
          ...d.pendingImports,
          [batchId]: (d.pendingImports[batchId] ?? []).map((t) =>
            t.id === txnId ? { ...t, ...patch, updatedAt: stamp() } : t,
          ),
        },
      }));
    },
    [],
  );

  const removePendingTransaction: Store['removePendingTransaction'] = useCallback(
    (batchId, txnId) => {
      setData((d) => ({
        ...d,
        pendingImports: {
          ...d.pendingImports,
          [batchId]: (d.pendingImports[batchId] ?? []).filter((t) => t.id !== txnId),
        },
      }));
    },
    [],
  );

  const addPendingTransaction: Store['addPendingTransaction'] = useCallback((batchId, t) => {
    const txn: Transaction = { ...t, id: uid('txn_'), createdAt: stamp(), updatedAt: stamp() };
    setData((d) => ({
      ...d,
      pendingImports: {
        ...d.pendingImports,
        [batchId]: [...(d.pendingImports[batchId] ?? []), txn],
      },
    }));
  }, []);

  // Approval is the ONLY path that moves imported rows into the live ledger.
  const approveImport: Store['approveImport'] = useCallback((batchId) => {
    setData((d) => {
      const pending = (d.pendingImports[batchId] ?? []).filter((t) => t.type !== 'ignore');
      const rest = { ...d.pendingImports };
      delete rest[batchId];
      return {
        ...d,
        transactions: [...pending, ...d.transactions],
        importBatches: d.importBatches.map((b) =>
          b.id === batchId ? { ...b, status: 'approved' } : b,
        ),
        pendingImports: rest,
      };
    });
  }, []);

  const rejectImport: Store['rejectImport'] = useCallback((batchId) => {
    setData((d) => {
      const rest = { ...d.pendingImports };
      delete rest[batchId];
      return {
        ...d,
        importBatches: d.importBatches.map((b) =>
          b.id === batchId ? { ...b, status: 'rejected' } : b,
        ),
        pendingImports: rest,
      };
    });
  }, []);

  const deleteImportBatch: Store['deleteImportBatch'] = useCallback((batchId) => {
    setData((d) => {
      const rest = { ...d.pendingImports };
      delete rest[batchId];
      return {
        ...d,
        importBatches: d.importBatches.filter((b) => b.id !== batchId),
        pendingImports: rest,
      };
    });
  }, []);


  // Empty every collection but keep the user's current settings. Used after
  // onboarding so the user starts with their own numbers, not the demo seed.
  const clearAllData = useCallback(
    () =>
      setData((d) => {
        const fresh = emptyData();
        return {
          // Keep the user's own settings (currency, targets, income date)…
          settings: d.settings,
          // …but clear every record of money and restore empty foundation funds.
          transactions: [],
          bills: [],
          debts: [],
          budget: [],
          goals: fresh.goals,
          importBatches: [],
          travelPlans: [],
          pendingImports: {},
        };
      }),
    [],
  );

  // ---- derived ----
  const cashAvailable = useMemo(() => {
    // Starting balance + net of all live transactions (personal only).
    const { income, spending } = monthlyTotals(data.transactions, '0000-00'); // dummy month → 0
    void income;
    void spending;
    // Compute net across all transactions (not just this month) for available cash.
    let net = data.settings.startingCashBalance;
    for (const t of data.transactions) {
      if (t.type === 'ignore' || t.type === 'transfer') continue;
      if (t.type === 'income' || t.type === 'refund' || t.type === 'reimbursement') net += t.amount;
      else net -= t.amount;
    }
    return Math.round(net * 100) / 100;
  }, [data.transactions, data.settings.startingCashBalance]);

  const buildFinanceContext: Store['buildFinanceContext'] = useCallback(() => {
    const { spending, income } = monthlyTotals(data.transactions);
    const upcoming = billsBeforeIncome(data.bills, data.settings.nextIncomeDate);
    const rainy = data.goals.find((g) => g.type === 'rainy_day');
    const emergency = data.goals.find((g) => g.type === 'emergency');
    const retirement = data.goals.find((g) => g.type === 'retirement');

    // Temporal layer: history → current pacing → projection.
    const snap = buildTemporalSnapshot(data.transactions);
    const goalProj = projectGoals(data.goals, data.transactions);
    const catProj = projectCategorySpending(data.transactions);
    const rising = snap.topCategories
      .filter((c) => c.trend === 'rising')
      .slice(0, 4)
      .map((c) => ({ category: c.category, average: c.average, trendPctPerMonth: c.trendPctPerMonth }));
    const categoryAverages: FinanceContext['categoryAverages'] = {};
    for (const c of snap.topCategories) {
      const p = catProj.find((x) => x.category === c.category);
      categoryAverages[c.category] = {
        average: c.average,
        recent: c.recent,
        trend: c.trend,
        projectedNextMonth: p?.projectedNextMonth ?? c.average,
        monthsSeen: c.monthsSeen,
      };
    }

    return {
      currency: data.settings.currency,
      cashAvailable,
      nextIncomeAmount: 0, // unknown until entered; CJ-Bot treats 0 as "not yet known"
      nextIncomeDate: data.settings.nextIncomeDate,
      daysUntilIncome: Math.max(daysUntil(data.settings.nextIncomeDate), 0),
      survivalMonthlyExpense: data.settings.survivalMonthlyExpense,
      monthlySpending: spending,
      monthlyIncome: income,
      upcomingBills: upcoming,
      upcomingBillsTotal: sumBills(upcoming),
      criticalBillsTotal: sumBills(criticalBills(data.bills)),
      totalDebt: totalDebt(data.debts),
      totalDebtMinimums: totalDebtMinimums(data.debts),
      goals: data.goals,
      rainyDayProgress: { current: rainy?.currentAmount ?? 0, target: rainy?.targetAmount ?? 500 },
      emergencyProgress: {
        current: emergency?.currentAmount ?? 0,
        target: emergency?.targetAmount ?? 1950,
      },
      retirementStarted: (retirement?.currentAmount ?? 0) > 0,
      recentTransactions: data.transactions.slice(0, 12),
      savedThisMonth: savedThisMonth(data.goals, data.transactions),

      // Temporal
      monthsOfHistory: snap.monthsOfHistory,
      hasEnoughHistory: snap.hasEnoughHistory,
      averageMonthlySpending: snap.averageMonthlySpending,
      averageMonthlyIncome: snap.averageMonthlyIncome,
      monthToDateSpending: snap.pace.monthToDateSpending,
      projectedMonthEndSpending: snap.pace.projectedMonthEnd,
      spendingPace: snap.pace.pace,
      spendingVsAveragePct: snap.pace.vsAveragePct,
      projectedNextMonthSpending: snap.forecast.projectedTotal,
      projectionConfidence: snap.forecast.confidence,
      risingCategories: rising,
      categoryAverages,
      goalProjections: goalProj.map((g) => ({
        name: g.name,
        monthsToTarget: g.monthsToTarget,
        monthlyContribution: g.monthlyContribution,
        basis: g.basis,
      })),
      observedMonthlySavings: snap.forecast ? observedMonthlySavings(data.transactions) : 0,
    };
  }, [data, cashAvailable]);

  const value: Store = {
    ...data,
    ready,
    updateSettings,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    addBill,
    updateBill,
    deleteBill,
    toggleBillPaid,
    addDebt,
    updateDebt,
    deleteDebt,
    updateBudgetCategory,
    approveBudgetRecommendation,
    rejectBudgetRecommendation,
    addGoal,
    updateGoal,
    addContribution,
    addTravelPlan,
    updateTravelPlan,
    deleteTravelPlan,
    stageImport,
    updatePendingTransaction,
    removePendingTransaction,
    addPendingTransaction,
    approveImport,
    rejectImport,
    deleteImportBatch,
    cashAvailable,
    buildFinanceContext,
    clearAllData,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
