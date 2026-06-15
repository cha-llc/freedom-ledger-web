/**
 * Seed data for development. PERSONAL only.
 * Figures match the build spec: cash 186, next paycheck 735.15,
 * rainy day 82/500, emergency 0/1950, retirement not started.
 */

import type {
  Transaction,
  Bill,
  Debt,
  BudgetCategory,
  SavingsGoal,
  AppSettings,
  ImportBatch,
} from './models';
import { todayISO, currentMonth, uid } from './format';

const NOW = todayISO();
const MONTH = currentMonth();

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  return isoDaysFromNow(-days);
}

export const SEED_SETTINGS: AppSettings = {
  currency: 'USD',
  startingCashBalance: 186,
  nextIncomeDate: isoDaysFromNow(9),
  incomeFrequency: 'biweekly',
  survivalMonthlyExpense: 1950,
  rainyDayTarget: 500,
  emergencyFundTarget: 1950,
  retirementContributionTarget: 50,
  aiProvider: 'cj-bot-llama', // placeholder; real CJ-Bot endpoint wired later

  onboarded: false,
  biometricLockEnabled: false,
  notificationsEnabled: false,
  billReminderDays: 3,
  dailyLimitAlertsEnabled: false,
  paydayReminderEnabled: true,
};

export const SEED_GOALS: SavingsGoal[] = [
  {
    id: 'goal_rainy',
    name: 'Rainy Day Fund',
    type: 'rainy_day',
    targetAmount: 500,
    currentAmount: 82,
    currency: 'USD',
    priority: 'critical',
    monthlyContributionTarget: 40,
    paycheckContributionTarget: 20,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'goal_emergency',
    name: 'Emergency Fund',
    type: 'emergency',
    targetAmount: 1950, // one month of survival expenses (starter)
    currentAmount: 0,
    currency: 'USD',
    priority: 'high',
    monthlyContributionTarget: 50,
    paycheckContributionTarget: 25,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'goal_retirement',
    name: 'Open Retirement Account',
    type: 'retirement',
    targetAmount: 1000, // first milestone once opened
    currentAmount: 0,
    currency: 'USD',
    priority: 'medium',
    monthlyContributionTarget: 50,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

export const SEED_BILLS: Bill[] = [
  {
    id: 'bill_rent',
    name: 'Rent / Room',
    amount: 420,
    currency: 'USD',
    dueDate: isoDaysFromNow(6),
    frequency: 'monthly',
    autopay: false,
    paid: false,
    priority: 'critical',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'bill_phone',
    name: 'Phone / Internet',
    amount: 48,
    currency: 'USD',
    dueDate: isoDaysFromNow(3),
    frequency: 'monthly',
    autopay: true,
    paid: false,
    priority: 'high',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'bill_subs',
    name: 'Streaming + Cloud Subs',
    amount: 26,
    currency: 'USD',
    dueDate: isoDaysFromNow(12),
    frequency: 'monthly',
    autopay: true,
    paid: false,
    priority: 'low',
    notes: 'Possible leak — review with CJ-Bot',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'bill_insurance',
    name: 'Personal Health Coverage',
    amount: 64,
    currency: 'USD',
    dueDate: isoDaysFromNow(15),
    frequency: 'monthly',
    autopay: false,
    paid: false,
    priority: 'high',
    createdAt: NOW,
    updatedAt: NOW,
  },
];

export const SEED_DEBTS: Debt[] = [
  {
    id: 'debt_card',
    creditor: 'Credit Card',
    balance: 640,
    minimumPayment: 35,
    dueDate: isoDaysFromNow(8),
    interestRate: 24.99,
    status: 'current',
    priority: 'high',
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'debt_loan',
    creditor: 'Personal Loan (family)',
    balance: 300,
    minimumPayment: 25,
    dueDate: isoDaysFromNow(20),
    status: 'current',
    priority: 'medium',
    notes: 'No interest — flexible',
    createdAt: NOW,
    updatedAt: NOW,
  },
];

export const SEED_TRANSACTIONS: Transaction[] = [
  {
    id: uid('txn_'),
    date: isoDaysAgo(2),
    description: 'AutoMercado Groceries',
    merchant: 'AutoMercado',
    amount: 34.2,
    type: 'expense',
    category: 'Food / Groceries',
    accountName: 'Checking',
    isDuplicateCandidate: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: uid('txn_'),
    date: isoDaysAgo(3),
    description: 'Uber ride - Alajuela',
    merchant: 'Uber',
    amount: 6.5,
    type: 'expense',
    category: 'Uber / Rideshare',
    accountName: 'Checking',
    isDuplicateCandidate: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: uid('txn_'),
    date: isoDaysAgo(5),
    description: 'Paycheck deposit',
    merchant: 'Employer',
    amount: 735.15,
    type: 'income',
    category: 'Job Paycheck',
    accountName: 'Checking',
    isDuplicateCandidate: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: uid('txn_'),
    date: isoDaysAgo(6),
    description: 'Soda lunch',
    merchant: 'Soda La Esquina',
    amount: 5.0,
    type: 'expense',
    category: 'Restaurants / Eating Out',
    accountName: 'Cash',
    isDuplicateCandidate: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: uid('txn_'),
    date: isoDaysAgo(7),
    description: 'Pharmacy - meds',
    merchant: 'Farmacia',
    amount: 18.75,
    type: 'expense',
    category: 'Medication / Health',
    accountName: 'Checking',
    isDuplicateCandidate: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: uid('txn_'),
    date: isoDaysAgo(9),
    description: 'Credit card payment',
    merchant: 'Credit Card',
    amount: 35.0,
    type: 'debt_payment',
    category: 'Debt Payment',
    accountName: 'Checking',
    isDuplicateCandidate: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: uid('txn_'),
    date: isoDaysAgo(10),
    description: 'Dog food',
    merchant: 'Pet store',
    amount: 22.4,
    type: 'expense',
    category: 'Dogs / Pets',
    accountName: 'Cash',
    isDuplicateCandidate: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

export const SEED_BUDGET: BudgetCategory[] = [
  { id: uid('bud_'), month: MONTH, category: 'Food / Groceries', budgetAmount: 220, actualAmount: 134, locked: false, approved: true },
  { id: uid('bud_'), month: MONTH, category: 'Restaurants / Eating Out', budgetAmount: 60, actualAmount: 78, locked: false, approved: true },
  { id: uid('bud_'), month: MONTH, category: 'Uber / Rideshare', budgetAmount: 40, actualAmount: 52, locked: false, approved: true },
  { id: uid('bud_'), month: MONTH, category: 'Medication / Health', budgetAmount: 50, actualAmount: 18, locked: true, approved: true },
  { id: uid('bud_'), month: MONTH, category: 'Subscriptions', budgetAmount: 26, actualAmount: 26, locked: false, approved: true },
  { id: uid('bud_'), month: MONTH, category: 'Dogs / Pets', budgetAmount: 35, actualAmount: 22, locked: false, approved: true },
  { id: uid('bud_'), month: MONTH, category: 'Personal Care', budgetAmount: 30, actualAmount: 12, locked: false, approved: true },
];

export const SEED_IMPORT_BATCHES: ImportBatch[] = [
  {
    id: 'batch_demo',
    sourceFileName: 'statement_apr.pdf',
    fileType: 'pdf',
    uploadDate: isoDaysAgo(14),
    statementMonth: MONTH,
    status: 'approved',
    transactionCount: 18,
    lowConfidenceCount: 2,
    duplicateCandidateCount: 1,
    notes: 'Imported and reviewed.',
  },
];
