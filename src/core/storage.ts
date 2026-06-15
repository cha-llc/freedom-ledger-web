/**
 * Web persistence — localStorage implementation of the same AppData repository
 * the mobile app defines over AsyncStorage. Same storage key and shape, so the
 * data model is identical across platforms. SSR-safe (guards `window`).
 */

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

export interface AppData {
  settings: AppSettings;
  transactions: Transaction[];
  bills: Bill[];
  debts: Debt[];
  budget: BudgetCategory[];
  goals: SavingsGoal[];
  importBatches: ImportBatch[];
  travelPlans: TravelPlan[];
  pendingImports: Record<string, Transaction[]>;
}

const KEY = 'freedom_ledger_v1';

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export const storage = {
  async load(): Promise<AppData | null> {
    if (!hasWindow()) return null;
    try {
      const raw = window.localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as AppData) : null;
    } catch (e) {
      console.warn('storage.load failed', e);
      return null;
    }
  },

  async save(data: AppData): Promise<void> {
    if (!hasWindow()) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('storage.save failed', e);
    }
  },

  async clear(): Promise<void> {
    if (!hasWindow()) return;
    try {
      window.localStorage.removeItem(KEY);
    } catch (e) {
      console.warn('storage.clear failed', e);
    }
  },

  /** Export the raw JSON string for backup/download. */
  exportJSON(): string | null {
    if (!hasWindow()) return null;
    return window.localStorage.getItem(KEY);
  },
};
