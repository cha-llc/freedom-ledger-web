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
import {
  SEED_SETTINGS,
  SEED_TRANSACTIONS,
  SEED_BILLS,
  SEED_DEBTS,
  SEED_BUDGET,
  SEED_GOALS,
  SEED_IMPORT_BATCHES,
} from './seed';
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
import type { FinanceContext } from './cjBotTypes';

function seedData(): AppData {
  return {
    settings: SEED_SETTINGS,
    transactions: SEED_TRANSACTIONS,
    bills: SEED_BILLS,
    debts: SEED_DEBTS,
    budget: SEED_BUDGET,
    goals: SEED_GOALS,
    importBatches: SEED_IMPORT_BATCHES,
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

  resetToSeed: () => void;
  clearAllData: () => void;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppData>(seedData());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const loaded = await storage.load();
      if (loaded) setData(loaded);
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

  const resetToSeed = useCallback(() => setData(seedData()), []);

  // Empty every collection but keep the user's current settings. Used after
  // onboarding so the user starts with their own numbers, not the demo seed.
  const clearAllData = useCallback(
    () =>
      setData((d) => ({
        settings: d.settings,
        transactions: [],
        bills: [],
        debts: [],
        budget: [],
        goals: [],
        importBatches: [],
        travelPlans: [],
        pendingImports: {},
      })),
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
    resetToSeed,
    clearAllData,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
