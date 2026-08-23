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
  
  note?: string;
  sourceFile?: string;
  createdAt?: string;
}

export interface MonthlyBudget {
  month: string; // YYYY-MM
  planned: Record<string, number>; // categoryItemId -> planned amount
}

export interface BankConfig {
  id: string;
  name: string;
  defaultOwner: string;
  defaultCurrency?: string; // e.g. 'EUR', 'USD', 'INR', 'GBP'
  accountNumber?: string;
  dateColName?: string;
  descColName?: string;
  descColName2?: string;
  amountColName?: string;
  currencyColName?: string;
  delimiter?: string;
}

export interface CategoryRule {
  id: string;
  keyword: string;
  categoryItem: string;
  categoryGroup?: string;
  splitType?: SplitType;
  splitPercentage?: number;
  paidBy?: string;
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
    autoSyncDrive: boolean;
    googleFileName: string;
    theme: 'dark' | 'light';
  };
}
