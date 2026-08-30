export interface Person {
  id: string;
  name: string;
  color?: string;
}

export interface CategoryItem {
  id: string;
  name: string;
  groupId: string;
  defaultOwner?: string;
  plannedDefault?: number;
}

export interface CategoryGroup {
  id: string;
  name: string;
  icon?: string;
  items: CategoryItem[];
}

export type SplitType = 'SELF' | 'OTHER' | 'SPLIT';
export type SplitMode = 'EQUAL' | 'PERCENTAGE' | 'EXACT';

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  description: string;
  merchant?: string;
  bank: string;
  account?: string;
  paidBy: string; // Person name
  categoryGroup?: string;
  categoryItem?: string;
  
  // Split logic
  splitType: SplitType;
  splitMode?: SplitMode;
  splitPercentage?: number; // % paidBy keeps for self (default 50)
  customSplitAmounts?: Record<string, number>; // personName -> amount they are responsible for
  
  // Cash & Transfer & Multi-Currency
  isCash?: boolean;
  isCashTransfer?: boolean;
  transferTo?: string; // person who received cash
  
  currency?: string; // transaction currency
  originalAmount?: number; // amount in original currency
  originalCurrency?: string;
  exchangeRate?: number; // exchange rate to app base currency
  
  // Reimbursement tracking
  isReimbursable?: boolean;
  reimbursementStatus?: 'PENDING' | 'REIMBURSED';
  reimbursedTo?: string; // Person who collected the repayment
  reimbursementNote?: string; // e.g. "Work trip", "Dave dinner", "Insurance"

  // Review & Workflow status
  isUnderReview?: boolean; // Flagged for review / discussion
  isDone?: boolean; // Marked as verified / done (grays out row)
  
  note?: string;
  sourceFile?: string;
  rawDate?: string; // Exact statement timestamp including seconds if present (e.g. 2026-03-06 18:20:14)
  createdAt?: string;
}

export interface MonthlyBudget {
  month: string; // YYYY-MM
  planned: Record<string, number>; // categoryItemId -> planned amount
}

export interface BankConfig {
  id: string;
  name: string;
  defaultCurrency?: string; // e.g. 'EUR', 'USD', 'INR', 'GBP'
  accountNumber?: string;
  dateColName?: string;
  descColName?: string;
  descColName2?: string;
  amountColName?: string;
  currencyColName?: string;
  ignoreColName?: string; // Columns or keywords to ignore/strip e.g. 'Karte, Punkte'
  tableEndMarker?: string; // Stop words that end transaction table e.g. 'Endsaldo, Closing Balance'
  maxDescLines?: number; // Max lines per transaction (default 2 or 3)
  delimiter?: string;
  invertAmountSign?: boolean; // If true, + is expense/charge and - is repayment/credit (e.g. Amex)
}

export interface CategoryRule {
  id: string;
  keyword: string;
  categoryItem: string;
  categoryGroup?: string;
  splitType?: SplitType;
  splitPercentage?: number;
  paidBy?: string;
  bank?: string; // 'All' or specific bank
}

export interface ExcludeRule {
  id: string;
  bank: string; // 'All' or specific bank e.g. 'Sparkasse', 'Revolut'
  keyword: string; // keyword to match in description
}

export interface AppDataBackup {
  version: number;
  exportedAt: string;
  persons: Person[];
  categoryGroups: CategoryGroup[];
  transactions: Transaction[];
  monthlyBudgets: MonthlyBudget[];
  bankConfigs: BankConfig[];
  rules?: CategoryRule[];
  excludeRules?: ExcludeRule[];
  settings: {
    currency: string;
    dateFormat: string;
    numberFormat?: string; // '1,234.56' | '1.234,56' | '1 234.56' | '1 234,56'
    visibleCurrencies?: string[];
    exchangeRates?: Record<string, number>;
    lastRatesRefresh?: number | null;
    autoSyncDrive: boolean;
    googleFileName: string;
    theme: 'dark' | 'light';
  };
}
