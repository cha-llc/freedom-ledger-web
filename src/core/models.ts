/**
 * Freedom Ledger — Data models
 * PERSONAL FINANCES ONLY. No business income, expenses, invoices, or client payments.
 */

export type TransactionType =
  | 'income'
  | 'expense'
  | 'transfer'
  | 'refund'
  | 'reimbursement'
  | 'debt_payment'
  | 'bill_payment'
  | 'ignore';

export type IncomeCategory =
  | 'Job Paycheck'
  | 'Insurance Commission / Personal Payout'
  | 'Gift / Help Received'
  | 'Refund'
  | 'Reimbursement'
  | 'Personal Transfer'
  | 'Cash on Hand'
  | 'Other Personal Income';

export type ExpenseCategory =
  | 'Rent / Housing'
  | 'Food / Groceries'
  | 'Restaurants / Eating Out'
  | 'Transportation'
  | 'Uber / Rideshare'
  | 'Flights / Travel'
  | 'Baggage / Airline Fees'
  | 'Phone / Internet'
  | 'Medication / Health'
  | 'Dogs / Pets'
  | 'Insurance Exam / Licensing'
  | 'Debt Payment'
  | 'Subscriptions'
  | 'Personal Care'
  | 'Laundry / Household'
  | 'Cash Withdrawal'
  | 'Bank Fees'
  | 'Emergency'
  | 'Other'
  | 'Needs Review';

export const INCOME_CATEGORIES: IncomeCategory[] = [
  'Job Paycheck',
  'Insurance Commission / Personal Payout',
  'Gift / Help Received',
  'Refund',
  'Reimbursement',
  'Personal Transfer',
  'Cash on Hand',
  'Other Personal Income',
];

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Rent / Housing',
  'Food / Groceries',
  'Restaurants / Eating Out',
  'Transportation',
  'Uber / Rideshare',
  'Flights / Travel',
  'Baggage / Airline Fees',
  'Phone / Internet',
  'Medication / Health',
  'Dogs / Pets',
  'Insurance Exam / Licensing',
  'Debt Payment',
  'Subscriptions',
  'Personal Care',
  'Laundry / Household',
  'Cash Withdrawal',
  'Bank Fees',
  'Emergency',
  'Other',
  'Needs Review',
];

export interface Transaction {
  id: string;
  date: string; // ISO yyyy-mm-dd
  postedDate?: string;
  description: string;
  merchant?: string;
  amount: number; // positive number; type determines sign in math
  type: TransactionType;
  category: string;
  accountName?: string;
  sourceFileName?: string;
  importBatchId?: string;
  ocrConfidence?: number; // 0..1
  parsingConfidence?: number; // 0..1
  isDuplicateCandidate: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type BillFrequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'one_time';
export type Priority = 'low' | 'medium' | 'high' | 'critical';

export interface Bill {
  id: string;
  name: string;
  amount: number;
  currency: string;
  dueDate: string;
  frequency: BillFrequency;
  autopay: boolean;
  paid: boolean;
  priority: Priority;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type DebtStatus = 'current' | 'late' | 'collections' | 'paused' | 'unknown';

export interface Debt {
  id: string;
  creditor: string;
  balance: number;
  minimumPayment: number;
  dueDate: string;
  interestRate?: number;
  status: DebtStatus;
  priority: Priority;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetCategory {
  id: string;
  month: string; // yyyy-mm
  category: string;
  budgetAmount: number;
  actualAmount: number;
  recommendedAmount?: number;
  recommendationReason?: string;
  locked: boolean;
  approved: boolean;
  notes?: string;
}

export type SavingsGoalType =
  | 'rainy_day'
  | 'emergency'
  | 'retirement'
  | 'travel'
  | 'debt'
  | 'custom';

export interface SavingsGoal {
  id: string;
  name: string;
  type: SavingsGoalType;
  targetAmount: number;
  currentAmount: number;
  currency: string;
  deadline?: string;
  priority: Priority;
  monthlyContributionTarget?: number;
  paycheckContributionTarget?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ImportFileType = 'pdf' | 'image' | 'csv';
export type ImportStatus = 'pending_review' | 'approved' | 'rejected' | 'deleted';

export interface ImportBatch {
  id: string;
  sourceFileName: string;
  fileType: ImportFileType;
  uploadDate: string;
  statementMonth?: string;
  status: ImportStatus;
  transactionCount: number;
  lowConfidenceCount: number;
  duplicateCandidateCount: number;
  notes?: string;
}

export interface TravelPlan {
  id: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  flightCost: number;
  baggageCost: number;
  lodgingCost: number;
  transportationCost: number;
  foodBudget: number;
  documentCost: number; // visa / exam / document
  emergencyBuffer: number;
  currentAvailableCash: number;
  expectedIncomeBeforeTrip: number;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  currency: string;
  startingCashBalance: number;
  nextIncomeDate: string;
  incomeFrequency: BillFrequency;
  survivalMonthlyExpense: number;
  rainyDayTarget: number;
  emergencyFundTarget: number;
  retirementContributionTarget: number;
  aiProvider: string; // placeholder for CJ-Bot endpoint config

  // First-run / security / reminders
  onboarded: boolean;
  biometricLockEnabled: boolean;
  notificationsEnabled: boolean;
  billReminderDays: number; // days before a bill's due date to remind
  dailyLimitAlertsEnabled: boolean;
  paydayReminderEnabled: boolean;
}
