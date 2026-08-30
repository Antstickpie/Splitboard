import { Injectable, signal, computed, effect } from '@angular/core';
import {
  Person,
  CategoryGroup,
  CategoryItem,
  Transaction,
  MonthlyBudget,
  BankConfig,
  AppDataBackup,
  SplitType,
  SplitMode,
  CategoryRule,
  ExcludeRule
} from '../models';
import { DEFAULT_PERSONS, DEFAULT_BANKS, DEFAULT_CATEGORY_GROUPS, DEFAULT_RULES } from '../constants/default-data';

declare const google: any;

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export interface ConfirmModalConfig {
  title: string;
  message: string;
  resolve: (value: boolean) => void;
}

export interface AlertModalConfig {
  title: string;
  message: string;
  resolve: () => void;
}

export interface SettlementSummary {
  personAPaid: number;
  personBPaid: number;
  personAShare: number;
  personBShare: number;
  personAOwesPersonB: number;
  personBOwesPersonA: number;
  netOwedAmount: number;
  debtorName: string;
  creditorName: string;
  isSettled: boolean;
  itemizedDetails: {
    id: string;
    date: string;
    description: string;
    paidBy: string;
    amount: number;
    splitType: SplitType;
    personAShare: number;
    personBShare: number;
    category?: string;
  }[];
}

export const DEFAULT_EXCLUDE_RULES: ExcludeRule[] = [
  // Global Exclusions
  { id: 'ex-1', bank: 'All', keyword: 'Daily Interest' },
  { id: 'ex-2', bank: 'All', keyword: 'Interest Payment' },
  { id: 'ex-3', bank: 'All', keyword: 'Net Interest Paid' },
  { id: 'ex-4', bank: 'All', keyword: 'Zinsgutschrift' },
  { id: 'ex-5', bank: 'All', keyword: 'Tagesgeld Zinsen' },

  // Revolut Specific Exclusions
  { id: 'ex-rev-1', bank: 'Revolut', keyword: 'Instant Access Savings' },
  { id: 'ex-rev-2', bank: 'Revolut', keyword: 'Exchanged to' },
  { id: 'ex-rev-3', bank: 'Revolut', keyword: 'Google Pay top-up' },
  { id: 'ex-rev-4', bank: 'Revolut', keyword: 'Top Up' },
  { id: 'ex-rev-5', bank: 'Revolut', keyword: 'Payment from' },
  { id: 'ex-rev-6', bank: 'Revolut', keyword: 'To investment account' },
  { id: 'ex-rev-7', bank: 'Revolut', keyword: 'To Me Commerzbank' }
];

@Injectable({
  providedIn: 'root'
})
export class TransactionService {
  private readonly STORAGE_KEY = 'tx_processor_data_v1';
  private readonly GOOGLE_CLIENT_ID = '905187123985-efr820m362ghf1u5i6j10s8l4vff9o42.apps.googleusercontent.com';

  // Core State Signals
  public persons = signal<Person[]>(DEFAULT_PERSONS);
  public categoryGroups = signal<CategoryGroup[]>(DEFAULT_CATEGORY_GROUPS);
  public transactions = signal<Transaction[]>([]);
  public monthlyBudgets = signal<MonthlyBudget[]>([]);
  public bankConfigs = signal<BankConfig[]>(DEFAULT_BANKS);
  public rules = signal<CategoryRule[]>(DEFAULT_RULES);
  public excludeRules = signal<ExcludeRule[]>(DEFAULT_EXCLUDE_RULES);
  public activeTab = signal<'dashboard' | 'ledger' | 'import' | 'settings'>('dashboard');

  public switchTab(tab: 'dashboard' | 'ledger' | 'import' | 'settings'): void {
    this.activeTab.set(tab);
  }

  // Settings Signals
  public theme = signal<'dark' | 'light'>('dark');
  public dateFormat = signal<string>('yyyy-MM-dd');
  public currency = signal<string>('EUR');
  public numberFormat = signal<string>('1,234.56');
  public autoSyncGoogleDrive = signal<boolean>(false);
  public googleFileName = signal<string>('splitboard_backup.json');
  public googleClientId = signal<string>('309949315167-dfr5pfvogun0lq4lohg9v79g4cp3uvss.apps.googleusercontent.com');

  // Currency & Multi-Currency State
  public visibleCurrencies = signal<string[]>(['EUR', 'USD', 'INR', 'GBP']);
  public exchangeRates = signal<Record<string, number>>({
    'EUR_USD': 1.085,
    'USD_EUR': 0.9216,
    'EUR_INR': 90.5,
    'INR_EUR': 0.01105,
    'EUR_GBP': 0.855,
    'GBP_EUR': 1.1696,
    'USD_INR': 83.4,
    'INR_USD': 0.01199,
    'GBP_USD': 1.27,
    'USD_GBP': 0.7874,
    'GBP_INR': 105.8,
    'INR_GBP': 0.00945
  });
  public lastRatesRefresh = signal<number | null>(null);
  public isFetchingRates = signal<boolean>(false);

  // UI State Signals
  public toasts = signal<Toast[]>([]);
  public confirmModal = signal<ConfirmModalConfig | null>(null);
  public alertModal = signal<AlertModalConfig | null>(null);
  public selectedMonth = signal<string>(this.getCurrentMonthString());
  public searchQuery = signal<string>('');
  public filterBank = signal<string>('ALL');
  public filterOwner = signal<string>('ALL');
  public filterSplitType = signal<string>('ALL');
  public filterCategory = signal<string>('ALL');

  // Google Drive State
  public isGoogleConnected = signal<boolean>(false);
  public isGoogleSyncing = signal<boolean>(false);
  public lastGoogleSyncTime = signal<number | null>(null);
  private driveToken: string | null = null;
  private tokenClient: any = null;
  private driveFileIdCache: string | null = null;

  // Computed Values
  public personOne = computed(() => this.persons()[0] || { id: 'p1', name: 'Person 1' });
  public personTwo = computed(() => this.persons()[1] || { id: 'p2', name: 'Person 2' });

  public availableMonths = computed(() => {
    const months = new Set<string>();
    const d = new Date();

    // Generate rolling 24 months (past 18 months to next 6 months)
    for (let offset = -18; offset <= 6; offset++) {
      const target = new Date(d.getFullYear(), d.getMonth() + offset, 1);
      const y = target.getFullYear();
      const m = String(target.getMonth() + 1).padStart(2, '0');
      months.add(`${y}-${m}`);
    }

    // Add any transaction months
    this.transactions().forEach((tx) => {
      if (tx.date && tx.date.length >= 7) {
        months.add(tx.date.substring(0, 7));
      }
    });

    return Array.from(months).sort().reverse();
  });

  public filteredTransactions = computed(() => {
    const m = this.selectedMonth();
    const q = this.searchQuery().toLowerCase().trim();
    const bank = this.filterBank();
    const owner = this.filterOwner();
    const split = this.filterSplitType();
    const cat = this.filterCategory();

    return this.transactions()
      .filter((tx) => {
        if (m !== 'ALL' && !tx.date.startsWith(m)) return false;
        if (bank !== 'ALL' && tx.bank !== bank) return false;
        if (owner !== 'ALL' && tx.paidBy !== owner) return false;
        if (split !== 'ALL' && tx.splitType !== split) return false;
        if (cat !== 'ALL' && tx.categoryItem !== cat && tx.categoryGroup !== cat) return false;
        if (q) {
          const matchDesc = (tx.description || '').toLowerCase().includes(q);
          const matchBank = (tx.bank || '').toLowerCase().includes(q);
          const matchNote = (tx.note || '').toLowerCase().includes(q);
          const matchCat = (tx.categoryItem || '').toLowerCase().includes(q);
          const matchGroup = (tx.categoryGroup || '').toLowerCase().includes(q);
          const matchOwner = (tx.paidBy || '').toLowerCase().includes(q);
          const matchAmount = String(tx.amount || '').includes(q);
          const matchSplit = (tx.splitType || '').toLowerCase().includes(q);
          if (!matchDesc && !matchBank && !matchNote && !matchCat && !matchGroup && !matchOwner && !matchAmount && !matchSplit) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  });

  // Current Month Settlement Calculation
  public monthSettlement = computed<SettlementSummary>(() => {
    const p1 = this.personOne().name;
    const p2 = this.personTwo().name;
    const month = this.selectedMonth();

    let p1Paid = 0;
    let p2Paid = 0;
    let p1TotalShare = 0;
    let p2TotalShare = 0;
    let p1OwesP2 = 0;
    let p2OwesP1 = 0;

    const relevantTxs = this.transactions().filter(
      (tx) => month === 'ALL' || tx.date.startsWith(month)
    );

    const itemized: SettlementSummary['itemizedDetails'] = [];

    relevantTxs.forEach((tx) => {
      if (tx.type === 'INCOME') return;
      const amount = Number(tx.amount) || 0;
      if (amount <= 0) return;

      const isP1 = tx.paidBy === p1;
      const isP2 = tx.paidBy === p2;

      if (isP1) p1Paid += amount;
      if (isP2) p2Paid += amount;

      let p1Share = 0;
      let p2Share = 0;

      if (tx.isReimbursable) {
        if (tx.reimbursementStatus === 'REIMBURSED') {
          // Money was collected back!
          // If reimbursedTo is the other partner, that partner received the cash and must pay the original payer:
          if (tx.reimbursedTo && tx.reimbursedTo !== tx.paidBy) {
            if (isP1 && tx.reimbursedTo === p2) {
              p2OwesP1 += amount;
              p2Share = amount;
            } else if (isP2 && tx.reimbursedTo === p1) {
              p1OwesP2 += amount;
              p1Share = amount;
            }
          } else {
            // Reimbursed to same person who paid -> Net 0, neither partner owes anything
            p1Share = 0;
            p2Share = 0;
          }
        } else {
          // PENDING: Out-of-pocket temporary loan by paidBy (100% SELF until reimbursed)
          if (isP1) p1Share = amount;
          else p2Share = amount;
        }
      } else if (tx.isCashTransfer) {
        // Direct cash transfer: paidBy gave cash to transferTo
        if (tx.transferTo === p2 && isP1) {
          p2OwesP1 += amount;
          p2Share = amount;
        } else if (tx.transferTo === p1 && isP2) {
          p1OwesP2 += amount;
          p1Share = amount;
        }
      } else if (tx.splitType === 'SELF') {
        // 100% self
        if (isP1) p1Share = amount;
        else p2Share = amount;
      } else if (tx.splitType === 'OTHER') {
        // 100% for the other person
        if (isP1) {
          p2Share = amount;
          p2OwesP1 += amount;
        } else {
          p1Share = amount;
          p1OwesP2 += amount;
        }
      } else {
        // SPLIT
        if (tx.splitMode === 'EXACT' && tx.customSplitAmounts) {
          p1Share = Number(tx.customSplitAmounts[p1]) || 0;
          p2Share = Number(tx.customSplitAmounts[p2]) || 0;
        } else {
          const pct = tx.splitPercentage != null ? tx.splitPercentage : 50;
          if (isP1) {
            p1Share = parseFloat(((amount * pct) / 100).toFixed(2));
            p2Share = parseFloat((amount - p1Share).toFixed(2));
          } else {
            p2Share = parseFloat(((amount * pct) / 100).toFixed(2));
            p1Share = parseFloat((amount - p2Share).toFixed(2));
          }
        }

        if (isP1) {
          p2OwesP1 += p2Share;
        } else if (isP2) {
          p1OwesP2 += p1Share;
        }
      }

      p1TotalShare += p1Share;
      p2TotalShare += p2Share;

      itemized.push({
        id: tx.id,
        date: tx.date,
        description: tx.description,
        paidBy: tx.paidBy,
        amount,
        splitType: tx.splitType,
        personAShare: p1Share,
        personBShare: p2Share,
        category: tx.categoryItem
      });
    });

    const diff = p2OwesP1 - p1OwesP2;
    let netOwedAmount = Math.abs(diff);
    let debtorName = '';
    let creditorName = '';

    if (diff > 0.005) {
      debtorName = p2;
      creditorName = p1;
    } else if (diff < -0.005) {
      debtorName = p1;
      creditorName = p2;
    }

    return {
      personAPaid: p1Paid,
      personBPaid: p2Paid,
      personAShare: p1TotalShare,
      personBShare: p2TotalShare,
      personAOwesPersonB: p1OwesP2,
      personBOwesPersonA: p2OwesP1,
      netOwedAmount: parseFloat(netOwedAmount.toFixed(2)),
      debtorName,
      creditorName,
      isSettled: netOwedAmount < 0.01,
      itemizedDetails: itemized
    };
  });

  // Track Imported Statement Batches for 1-click Undo across all months
  public importedBatches = computed(() => {
    const txs = this.transactions();
    const map = new Map<string, { fileName: string; count: number; minDate: string; maxDate: string; totalAmount: number }>();

    for (const tx of txs) {
      if (tx.sourceFile && tx.sourceFile !== 'Manual Entry' && tx.sourceFile !== 'Manual Cash Entry') {
        const src = tx.sourceFile;
        if (!map.has(src)) {
          map.set(src, {
            fileName: src,
            count: 0,
            minDate: tx.date || '',
            maxDate: tx.date || '',
            totalAmount: 0
          });
        }
        const b = map.get(src)!;
        b.count++;
        b.totalAmount += Number(tx.amount) || 0;
        if (tx.date && (!b.minDate || tx.date < b.minDate)) b.minDate = tx.date;
        if (tx.date && (!b.maxDate || tx.date > b.maxDate)) b.maxDate = tx.date;
      }
    }

    return Array.from(map.values());
  });

  constructor() {
    this.loadFromStorage();
    this.applyTheme();
    this.initGoogleAuthIfPossible();
    this.fetchExchangeRates(true);

    // Auto-save effect
    effect(() => {
      const data: AppDataBackup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        persons: this.persons(),
        categoryGroups: this.categoryGroups(),
        transactions: this.transactions(),
        monthlyBudgets: this.monthlyBudgets(),
        bankConfigs: this.bankConfigs(),
        rules: this.rules(),
        excludeRules: this.excludeRules(),
        settings: {
          currency: this.currency(),
          dateFormat: this.dateFormat(),
          numberFormat: this.numberFormat(),
          visibleCurrencies: this.visibleCurrencies(),
          exchangeRates: this.exchangeRates(),
          lastRatesRefresh: this.lastRatesRefresh(),
          autoSyncDrive: this.autoSyncGoogleDrive(),
          googleFileName: this.googleFileName(),
          theme: this.theme()
        }
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    });
  }

  public getCurrentMonthString(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  public fixMojibake(str: string): string {
    if (!str) return '';
    return str
      .replace(/Ã¤/g, 'ä')
      .replace(/Ã¶/g, 'ö')
      .replace(/Ã¼/g, 'ü')
      .replace(/Ã„/g, 'Ä')
      .replace(/Ã–/g, 'Ö')
      .replace(/Ãœ/g, 'Ü')
      .replace(/ÃŸ/g, 'ß')
      .replace(/â‚¬/g, '€')
      .replace(/Ã©/g, 'é')
      .replace(/Ã¨/g, 'è')
      .replace(/Ã¡/g, 'á')
      .replace(/Ã /g, 'à')
      .replace(/Ã³/g, 'ó')
      .replace(/Ã±/g, 'ñ')
      .replace(/Â/g, '');
  }

  public loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return;
      const data: AppDataBackup = JSON.parse(raw);
      if (data.persons && data.persons.length > 0) this.persons.set(data.persons);
      if (data.categoryGroups && data.categoryGroups.length > 0) {
        const cleanedGroups = data.categoryGroups.map((g) => ({
          ...g,
          items: g.items.map((it) => {
            if (it.name === 'Car Charging') return { ...it, name: 'Charging' };
            if (it.name === 'Car Maintenance') return { ...it, name: 'Maintenance' };
            if (it.name === 'Salary / Income') return { ...it, name: 'Salary' };
            if (it.name === 'Dining Out and Food Chill') return { ...it, name: 'Food and Chill' };
            if (it.name === 'Medical and Pharmacy') return { ...it, name: 'Medical' };
            return it;
          })
        }));
        this.categoryGroups.set(cleanedGroups);
      }
      if (data.transactions) {
        const cleanedTxs = data.transactions.map((tx) => {
          const updated: Transaction = {
            ...tx,
            description: this.fixMojibake(tx.description || '')
          };
          if (updated.categoryItem === 'Car Charging') updated.categoryItem = 'Charging';
          if (updated.categoryItem === 'Car Maintenance') updated.categoryItem = 'Maintenance';
          if (updated.categoryItem === 'Salary / Income') updated.categoryItem = 'Salary';
          if (updated.categoryItem === 'Dining Out and Food Chill') updated.categoryItem = 'Food and Chill';
          if (updated.categoryItem === 'Medical and Pharmacy') updated.categoryItem = 'Medical';
          return updated;
        });
        this.transactions.set(cleanedTxs);
      }
      if (data.bankConfigs && data.bankConfigs.length > 0) {
        const unwantedDefaults = new Set(['sparkasse', 'dkb', 'ing', 'n26', 'bunq']);
        const cleaned = data.bankConfigs.filter((b) => !unwantedDefaults.has(b.name.toLowerCase()));
        const merged = cleaned.map((b) => {
          const def = DEFAULT_BANKS.find((d) => d.name.toLowerCase() === b.name.toLowerCase());
          if (def) {
            return {
              ...def,
              ...b,
              dateColName: b.dateColName || def.dateColName,
              descColName: b.descColName || def.descColName,
              descColName2: b.descColName2 || def.descColName2,
              amountColName: b.amountColName || def.amountColName,
              currencyColName: b.currencyColName || def.currencyColName,
              ignoreColName: b.ignoreColName || def.ignoreColName,
              tableEndMarker: b.tableEndMarker || def.tableEndMarker,
              maxDescLines: b.maxDescLines || def.maxDescLines,
              defaultCurrency: b.defaultCurrency || def.defaultCurrency,
              invertAmountSign: b.invertAmountSign !== undefined ? b.invertAmountSign : def.invertAmountSign
            };
          }
          return b;
        });
        // Automatically append any newly introduced DEFAULT_BANKS (like HDFC Bank)
        for (const def of DEFAULT_BANKS) {
          if (!merged.some((b) => b.name.toLowerCase() === def.name.toLowerCase())) {
            merged.push(def);
          }
        }
        this.bankConfigs.set(merged.length > 0 ? merged : DEFAULT_BANKS);
      } else {
        this.bankConfigs.set(DEFAULT_BANKS);
      }
      if (data.rules && data.rules.length > 0) {
        const cleanedRules = data.rules.map((r) => {
          if (r.categoryItem === 'Car Charging') return { ...r, categoryItem: 'Charging' };
          if (r.categoryItem === 'Car Maintenance') return { ...r, categoryItem: 'Maintenance' };
          if (r.categoryItem === 'Salary / Income') return { ...r, categoryItem: 'Salary' };
          if (r.categoryItem === 'Dining Out and Food Chill') return { ...r, categoryItem: 'Food and Chill' };
          if (r.categoryItem === 'Medical and Pharmacy') return { ...r, categoryItem: 'Medical' };
          return r;
        });
        this.rules.set(cleanedRules);
      }
      if (data.excludeRules && data.excludeRules.length > 0) {
        const existingKeywords = new Set(data.excludeRules.map((r) => `${r.bank.toLowerCase()}_${r.keyword.toLowerCase()}`));
        const merged = [...data.excludeRules];
        for (const def of DEFAULT_EXCLUDE_RULES) {
          const key = `${def.bank.toLowerCase()}_${def.keyword.toLowerCase()}`;
          if (!existingKeywords.has(key)) {
            merged.push(def);
            existingKeywords.add(key);
          }
        }
        this.excludeRules.set(merged);
      } else {
        this.excludeRules.set(DEFAULT_EXCLUDE_RULES);
      }
      if (data.settings) {
        if (data.settings.currency) this.currency.set(data.settings.currency);
        if (data.settings.dateFormat) this.dateFormat.set(data.settings.dateFormat);
        if (data.settings.numberFormat) this.numberFormat.set(data.settings.numberFormat);
        if (data.settings.visibleCurrencies && data.settings.visibleCurrencies.length > 0) {
          this.visibleCurrencies.set(data.settings.visibleCurrencies);
        }
        if (data.settings.exchangeRates) this.exchangeRates.set(data.settings.exchangeRates);
        if (data.settings.lastRatesRefresh) this.lastRatesRefresh.set(data.settings.lastRatesRefresh);
        if (data.settings.autoSyncDrive !== undefined) this.autoSyncGoogleDrive.set(data.settings.autoSyncDrive);
        if (data.settings.googleFileName) this.googleFileName.set(data.settings.googleFileName);
        if (data.settings.theme) this.theme.set(data.settings.theme);
      }
    } catch (e) {
      console.error('Failed to load local data', e);
    }
  }

  // Rule Operations
  public addRule(rule: Omit<CategoryRule, 'id'>): void {
    const id = 'r-' + Math.random().toString(36).substr(2, 6);
    const newRule: CategoryRule = { id, ...rule };
    this.rules.update((curr) => [...curr, newRule]);
    this.showToast(`Auto-rule for "${rule.keyword}" saved`, 'success');
  }

  public updateRule(rule: CategoryRule): void {
    this.rules.update((curr) => curr.map((r) => (r.id === rule.id ? rule : r)));
    this.showToast(`Updated rule for "${rule.keyword}"`, 'success');
  }

  public deleteRule(id: string): void {
    this.rules.update((curr) => curr.filter((r) => r.id !== id));
    this.showToast('Rule removed', 'info');
  }

  // Bank Exclusion Rules Operations
  public addExcludeRule(bank: string, keyword: string): void {
    const trimmed = keyword.trim();
    if (!trimmed) return;
    const newRule: ExcludeRule = {
      id: 'ex-' + Date.now(),
      bank: bank || 'All',
      keyword: trimmed
    };
    this.excludeRules.update((curr) => [...curr, newRule]);
    this.showToast(`Added exclude rule for "${trimmed}"`, 'success');
  }

  public updateExcludeRule(rule: ExcludeRule): void {
    this.excludeRules.update((curr) => curr.map((r) => (r.id === rule.id ? rule : r)));
    this.showToast(`Updated exclude rule for "${rule.keyword}"`, 'success');
  }

  public deleteExcludeRule(id: string): void {
    this.excludeRules.update((curr) => curr.filter((r) => r.id !== id));
    this.showToast('Exclude rule removed', 'info');
  }

  // Bank Statement Config Operations
  public addBankConfig(bank: Omit<BankConfig, 'id'>): void {
    const trimmedName = bank.name.trim();
    if (!trimmedName) return;
    const id = 'bank-' + Date.now();
    const newBank: BankConfig = { id, ...bank, name: trimmedName };
    this.bankConfigs.update((curr) => [...curr, newBank]);
    this.showToast(`Configured statement reader for "${trimmedName}"`, 'success');
  }

  public updateBankConfig(bank: BankConfig): void {
    this.bankConfigs.update((curr) => curr.map((b) => (b.id === bank.id ? bank : b)));
    this.showToast(`Updated "${bank.name}" configuration`, 'success');
  }

  public deleteBankConfig(id: string): void {
    const b = this.bankConfigs().find((x) => x.id === id);
    this.bankConfigs.update((curr) => curr.filter((x) => x.id !== id));
    this.showToast(`Removed bank "${b?.name || ''}"`, 'info');
  }

  public async undoImportBatch(fileName: string): Promise<void> {
    const batch = this.importedBatches().find((b) => b.fileName === fileName);
    const count = batch ? batch.count : 'all';
    const ok = await this.showConfirm(
      'Undo Statement Import',
      `Delete all ${count} transactions imported from "${fileName}" across all months?`
    );
    if (ok) {
      const before = this.transactions().length;
      this.transactions.update((curr) => curr.filter((t) => t.sourceFile !== fileName));
      const deleted = before - this.transactions().length;
      this.showToast(`Undid import: removed ${deleted} transactions`, 'info');
    }
  }

  public isTransactionExcluded(desc: string, bank: string): boolean {
    if (!desc) return false;
    const lowerDesc = desc.toLowerCase();
    const lowerBank = (bank || '').toLowerCase();
    return this.excludeRules().some((rule) => {
      const ruleBank = (rule.bank || 'All').toLowerCase();
      const matchesBank = ruleBank === 'all' || (lowerBank && (ruleBank === lowerBank || lowerBank.includes(ruleBank) || ruleBank.includes(lowerBank)));
      const rawKw = (rule.keyword || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
      const matchesKeyword = Boolean(rawKw && lowerDesc.includes(rawKw));
      return Boolean(matchesBank && matchesKeyword);
    });
  }

  public applyRulesToAllTransactions(): void {
    const activeRules = this.rules();
    let updatedCount = 0;

    this.transactions.update((curr) =>
      curr.map((tx) => {
        const desc = (tx.description || '').toLowerCase();
        const txBank = (tx.bank || '').toLowerCase();
        const matched = activeRules.find((r) => {
          const ruleBank = (r.bank || 'All').toLowerCase();
          const matchesBank = ruleBank === 'all' || !txBank || txBank.includes(ruleBank) || ruleBank.includes(txBank);
          return matchesBank && desc.includes(r.keyword.toLowerCase());
        });
        if (matched) {
          updatedCount++;
          return {
            ...tx,
            categoryItem: matched.categoryItem,
            categoryGroup: matched.categoryGroup || tx.categoryGroup,
            splitType: matched.splitType || tx.splitType,
            splitPercentage: matched.splitPercentage !== undefined ? matched.splitPercentage : tx.splitPercentage,
            paidBy: matched.paidBy || tx.paidBy
          };
        }
        return tx;
      })
    );

    this.showToast(`Re-applied rules across ${updatedCount} transactions`, 'success');
  }

  public toggleTheme(): void {
    const next = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    this.applyTheme();
  }

  private applyTheme(): void {
    if (this.theme() === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
  }

  // Toast System
  public showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
    const id = 'toast-' + Math.random().toString(36).substr(2, 9);
    this.toasts.update((curr) => [...curr, { id, message, type }]);
    setTimeout(() => {
      this.toasts.update((curr) => curr.filter((t) => t.id !== id));
    }, 4000);
  }

  // Modal Dialogs
  public showConfirm(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.confirmModal.set({ title, message, resolve });
    });
  }

  public showAlert(title: string, message: string): Promise<void> {
    return new Promise((resolve) => {
      this.alertModal.set({ title, message, resolve });
    });
  }

  // Transaction Operations
  public addTransaction(tx: Transaction): void {
    this.transactions.update((curr) => [tx, ...curr]);
    this.showToast('Transaction added', 'success');
    this.triggerAutoSyncIfEnabled();
  }

  public addTransactions(newTxs: Transaction[]): void {
    this.transactions.update((curr) => [...newTxs, ...curr]);
    this.triggerAutoSyncIfEnabled();
  }

  public updateTransaction(id: string, updates: Partial<Transaction>): void {
    this.transactions.update((curr) =>
      curr.map((tx) => (tx.id === id ? { ...tx, ...updates } : tx))
    );
    this.triggerAutoSyncIfEnabled();
  }

  public deleteTransaction(id: string): void {
    this.transactions.update((curr) => curr.filter((tx) => tx.id !== id));
    this.showToast('Transaction deleted', 'info');
    this.triggerAutoSyncIfEnabled();
  }

  public clearAllTransactions(): void {
    this.transactions.set([]);
    this.showToast('All transactions cleared', 'info');
    this.triggerAutoSyncIfEnabled();
  }

  // Deduplication
  public getTransactionSignature(tx: Transaction): string {
    const d = tx.rawDate ? tx.rawDate.trim() : (tx.date || '').slice(0, 10);
    const amt = Number(tx.amount).toFixed(2);
    const desc = (tx.description || '').trim().toLowerCase();
    const bank = (tx.bank || '').trim().toLowerCase();
    return `${d}_${amt}_${desc}_${bank}`;
  }

  // Person Operations
  public addPerson(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = 'p-' + Math.random().toString(36).substr(2, 6);
    this.persons.update((curr) => [...curr, { id, name: trimmed }]);
    this.showToast(`Person "${trimmed}" added`, 'success');
  }

  public updatePerson(index: number, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const oldName = this.persons()[index]?.name;
    this.persons.update((curr) => {
      const updated = [...curr];
      updated[index] = { ...updated[index], name: trimmed };
      return updated;
    });

    if (oldName && oldName !== trimmed) {
      // 1. Update existing transactions
      this.transactions.update((curr) =>
        curr.map((tx) => ({
          ...tx,
          paidBy: tx.paidBy === oldName ? trimmed : tx.paidBy,
          transferTo: tx.transferTo === oldName ? trimmed : tx.transferTo
        }))
      );

      // 2. Update auto-categorization rules
      this.rules.update((curr) =>
        curr.map((r) => ({
          ...r,
          paidBy: r.paidBy === oldName ? trimmed : r.paidBy
        }))
      );

      // 3. Update category items default owner
      this.categoryGroups.update((curr) =>
        curr.map((g) => ({
          ...g,
          items: g.items.map((itm) => ({
            ...itm,
            defaultOwner: itm.defaultOwner === oldName ? trimmed : itm.defaultOwner
          }))
        }))
      );
    }
  }

  public removePerson(index: number): void {
    this.persons.update((curr) => curr.filter((_, i) => i !== index));
  }

  // Category Operations
  public addCategoryGroup(name: string, icon = '📁'): void {
    const id = 'grp-' + Math.random().toString(36).substr(2, 6);
    this.categoryGroups.update((curr) => [...curr, { id, name, icon, items: [] }]);
    this.showToast(`Category Group "${name}" created`, 'success');
  }

  public addCategoryItem(groupId: string, name: string, plannedDefault = 0, defaultOwner?: string): void {
    const id = 'cat-' + Math.random().toString(36).substr(2, 6);
    this.categoryGroups.update((curr) =>
      curr.map((grp) =>
        grp.id === groupId
          ? {
              ...grp,
              items: [...grp.items, { id, groupId, name, plannedDefault, defaultOwner }]
            }
          : grp
      )
    );
    this.showToast(`Category "${name}" added`, 'success');
  }

  public deleteCategoryItem(groupId: string, itemId: string): void {
    this.categoryGroups.update((curr) =>
      curr.map((grp) =>
        grp.id === groupId
          ? { ...grp, items: grp.items.filter((item) => item.id !== itemId) }
          : grp
      )
    );
  }

  // Monthly Budget Operations
  public getBudgetForMonth(month: string): Record<string, number> {
    const found = this.monthlyBudgets().find((b) => b.month === month);
    if (found) return found.planned;

    // Fall back to category default planned values
    const defaults: Record<string, number> = {};
    this.categoryGroups().forEach((grp) => {
      grp.items.forEach((item) => {
        defaults[item.id] = item.plannedDefault || 0;
      });
    });
    return defaults;
  }

  public updateBudgetPlanned(month: string, categoryItemId: string, amount: number): void {
    this.monthlyBudgets.update((curr) => {
      const idx = curr.findIndex((b) => b.month === month);
      if (idx !== -1) {
        const updated = [...curr];
        updated[idx] = {
          ...updated[idx],
          planned: { ...updated[idx].planned, [categoryItemId]: amount }
        };
        return updated;
      } else {
        const defaults = this.getBudgetForMonth(month);
        defaults[categoryItemId] = amount;
        return [...curr, { month, planned: defaults }];
      }
    });
  }

  // Multi-Currency & Exchange Rates
  public getCurrencySymbol(code?: string): string {
    const c = (code || this.currency()).toUpperCase().trim();
    switch (c) {
      case 'EUR': return '€';
      case 'USD': return '$';
      case 'INR': return '₹';
      case 'GBP': return '£';
      case 'JPY': return '¥';
      case 'CAD': return 'C$';
      case 'AUD': return 'A$';
      case 'CHF': return 'CHF';
      case 'SGD': return 'S$';
      case 'AED': return 'AED';
      default: return c;
    }
  }

  public addVisibleCurrency(code: string): void {
    const clean = code.toUpperCase().trim();
    if (!clean) return;
    if (!this.visibleCurrencies().includes(clean)) {
      this.visibleCurrencies.update((curr) => [...curr, clean]);
      this.fetchExchangeRates(true);
      this.showToast(`Currency "${clean}" added`, 'success');
    }
  }

  public removeVisibleCurrency(index: number): void {
    const list = this.visibleCurrencies();
    if (list.length <= 1) return;
    const removed = list[index];
    this.visibleCurrencies.update((curr) => curr.filter((_, i) => i !== index));
    if (this.currency() === removed) {
      this.currency.set(this.visibleCurrencies()[0] || 'EUR');
    }
  }

  public getExchangeRate(from: string, to: string): number {
    const f = (from || 'EUR').toUpperCase().trim();
    const t = (to || 'EUR').toUpperCase().trim();
    if (f === t) return 1.0;

    const pair = `${f}_${t}`;
    const rates = this.exchangeRates();
    if (rates[pair]) return rates[pair];

    const revPair = `${t}_${f}`;
    if (rates[revPair] && rates[revPair] > 0) return parseFloat((1 / rates[revPair]).toFixed(6));

    // Bridge via EUR
    const fToEur = f === 'EUR' ? 1 : (rates[`${f}_EUR`] || (rates[`EUR_${f}`] ? 1 / rates[`EUR_${f}`] : null));
    const eurToT = t === 'EUR' ? 1 : (rates[`EUR_${t}`] || (rates[`${t}_EUR`] ? 1 / rates[`${t}_EUR`] : null));

    if (fToEur !== null && eurToT !== null) {
      return parseFloat((fToEur * eurToT).toFixed(6));
    }

    return 1.0;
  }

  public convertAmount(amount: number, from: string, to: string): number {
    const rate = this.getExchangeRate(from, to);
    return parseFloat((amount * rate).toFixed(2));
  }

  public async fetchExchangeRates(silent = false): Promise<void> {
    this.isFetchingRates.set(true);
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/EUR');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && data.rates) {
        const rates = data.rates;
        const newRates: Record<string, number> = { ...this.exchangeRates() };
        const currencies = Array.from(new Set([...this.visibleCurrencies(), 'EUR', 'USD', 'INR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY']));

        currencies.forEach((c1) => {
          currencies.forEach((c2) => {
            if (c1 !== c2 && rates[c1] && rates[c2]) {
              const rate = rates[c2] / rates[c1];
              newRates[`${c1}_${c2}`] = parseFloat(rate.toFixed(6));
            }
          });
        });

        this.exchangeRates.set(newRates);
        this.lastRatesRefresh.set(Date.now());
        if (!silent) this.showToast('Exchange rates updated live!', 'success');
      }
    } catch (err) {
      console.warn('Failed to fetch exchange rates:', err);
      if (!silent) this.showToast('Failed to refresh exchange rates online.', 'error');
    } finally {
      this.isFetchingRates.set(false);
    }
  }

  // Backup & Restore
  public exportBackupJson(): void {
    const data: AppDataBackup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      persons: this.persons(),
      categoryGroups: this.categoryGroups(),
      transactions: this.transactions(),
      monthlyBudgets: this.monthlyBudgets(),
      bankConfigs: this.bankConfigs(),
      rules: this.rules(),
      excludeRules: this.excludeRules(),
      settings: {
        currency: this.currency(),
        dateFormat: this.dateFormat(),
        visibleCurrencies: this.visibleCurrencies(),
        exchangeRates: this.exchangeRates(),
        lastRatesRefresh: this.lastRatesRefresh(),
        autoSyncDrive: this.autoSyncGoogleDrive(),
        googleFileName: this.googleFileName(),
        theme: this.theme()
      }
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions_processor_backup_${this.getCurrentMonthString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('Backup downloaded successfully', 'success');
  }

  public async importBackupJson(file: File): Promise<void> {
    try {
      const text = await file.text();
      const data: AppDataBackup = JSON.parse(text);
      if (data.persons) this.persons.set(data.persons);
      if (data.categoryGroups) this.categoryGroups.set(data.categoryGroups);
      if (data.transactions) this.transactions.set(data.transactions);
      if (data.monthlyBudgets) this.monthlyBudgets.set(data.monthlyBudgets);
      if (data.bankConfigs) this.bankConfigs.set(data.bankConfigs);
      if (data.rules) this.rules.set(data.rules);
      if (data.excludeRules) this.excludeRules.set(data.excludeRules);
      if (data.settings) {
        if (data.settings.currency) this.currency.set(data.settings.currency);
        if (data.settings.dateFormat) this.dateFormat.set(data.settings.dateFormat);
        if (data.settings.visibleCurrencies) this.visibleCurrencies.set(data.settings.visibleCurrencies);
        if (data.settings.exchangeRates) this.exchangeRates.set(data.settings.exchangeRates);
        if (data.settings.lastRatesRefresh !== undefined) this.lastRatesRefresh.set(data.settings.lastRatesRefresh);
        if (data.settings.autoSyncDrive !== undefined) this.autoSyncGoogleDrive.set(data.settings.autoSyncDrive);
        if (data.settings.googleFileName) this.googleFileName.set(data.settings.googleFileName);
        if (data.settings.theme) {
          this.theme.set(data.settings.theme);
          this.applyTheme();
        }
      }
      this.showToast('Backup restored successfully!', 'success');
    } catch (e) {
      this.showToast('Error restoring backup file', 'error');
    }
  }

  // Google Drive Direct Integration
  private initGoogleAuthIfPossible(): void {
    if (typeof google === 'undefined' || !google.accounts?.oauth2) return;
    try {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: this.googleClientId(),
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (response: any) => {
          if (response.error) {
            this.showToast('Google Auth Failed: ' + response.error, 'error');
            return;
          }
          this.driveToken = response.access_token;
          this.isGoogleConnected.set(true);
          this.showToast('Connected to Google Drive!', 'success');
        }
      });
    } catch (e) {
      console.warn('Google client init failed', e);
    }
  }

  public connectGoogleDrive(): void {
    if (!this.tokenClient) {
      this.initGoogleAuthIfPossible();
    }
    if (this.tokenClient) {
      this.tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
      this.showToast('Google Auth script not loaded.', 'error');
    }
  }

  public async uploadToGoogleDrive(): Promise<void> {
    if (!this.driveToken) {
      this.connectGoogleDrive();
      return;
    }
    this.isGoogleSyncing.set(true);
    try {
      const fileName = this.googleFileName() || 'transactions_processor_backup.json';
      const fileId = await this.findGoogleDriveFileId(fileName);

      const content = JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        persons: this.persons(),
        categoryGroups: this.categoryGroups(),
        transactions: this.transactions(),
        monthlyBudgets: this.monthlyBudgets(),
        bankConfigs: this.bankConfigs(),
        rules: this.rules(),
        excludeRules: this.excludeRules(),
        settings: {
          currency: this.currency(),
          dateFormat: this.dateFormat(),
          visibleCurrencies: this.visibleCurrencies(),
          exchangeRates: this.exchangeRates(),
          lastRatesRefresh: this.lastRatesRefresh(),
          autoSyncDrive: this.autoSyncGoogleDrive(),
          googleFileName: this.googleFileName(),
          theme: this.theme()
        }
      }, null, 2);

      const metadata = { name: fileName, mimeType: 'application/json' };
      const boundary = '-------314159265358979323846';
      const delimiter = '\r\n--' + boundary + '\r\n';
      const closeDelim = '\r\n--' + boundary + '--';

      const multipartRequestBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        content +
        closeDelim;

      const url = fileId
        ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
        : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
      const method = fileId ? 'PATCH' : 'POST';

      const resp = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.driveToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartRequestBody
      });

      if (!resp.ok) throw new Error('Upload HTTP status ' + resp.status);
      const resJson = await resp.json();
      this.driveFileIdCache = resJson.id;
      this.lastGoogleSyncTime.set(Date.now());
      this.showToast('Uploaded backup to Google Drive!', 'success');
    } catch (e: any) {
      this.showToast('Google Drive upload failed: ' + e.message, 'error');
    } finally {
      this.isGoogleSyncing.set(false);
    }
  }

  public async downloadFromGoogleDrive(): Promise<void> {
    if (!this.driveToken) {
      this.connectGoogleDrive();
      return;
    }
    this.isGoogleSyncing.set(true);
    try {
      const fileName = this.googleFileName() || 'transactions_processor_backup.json';
      const fileId = await this.findGoogleDriveFileId(fileName);
      if (!fileId) {
        this.showToast(`File "${fileName}" not found in Google Drive.`, 'error');
        return;
      }

      const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${this.driveToken}` }
      });

      if (!resp.ok) throw new Error('Download HTTP status ' + resp.status);
      const data: AppDataBackup = await resp.json();

      if (data.persons) this.persons.set(data.persons);
      if (data.categoryGroups) this.categoryGroups.set(data.categoryGroups);
      if (data.transactions) this.transactions.set(data.transactions);
      if (data.monthlyBudgets) this.monthlyBudgets.set(data.monthlyBudgets);
      if (data.bankConfigs) this.bankConfigs.set(data.bankConfigs);
      if (data.rules) this.rules.set(data.rules);
      if (data.excludeRules) this.excludeRules.set(data.excludeRules);
      if (data.settings) {
        if (data.settings.currency) this.currency.set(data.settings.currency);
        if (data.settings.dateFormat) this.dateFormat.set(data.settings.dateFormat);
        if (data.settings.visibleCurrencies) this.visibleCurrencies.set(data.settings.visibleCurrencies);
        if (data.settings.exchangeRates) this.exchangeRates.set(data.settings.exchangeRates);
        if (data.settings.lastRatesRefresh !== undefined) this.lastRatesRefresh.set(data.settings.lastRatesRefresh);
        if (data.settings.autoSyncDrive !== undefined) this.autoSyncGoogleDrive.set(data.settings.autoSyncDrive);
        if (data.settings.googleFileName) this.googleFileName.set(data.settings.googleFileName);
        if (data.settings.theme) {
          this.theme.set(data.settings.theme);
          this.applyTheme();
        }
      }
      this.lastGoogleSyncTime.set(Date.now());
      this.showToast('Loaded data from Google Drive!', 'success');
    } catch (e: any) {
      this.showToast('Google Drive download failed: ' + e.message, 'error');
    } finally {
      this.isGoogleSyncing.set(false);
    }
  }

  private async findGoogleDriveFileId(fileName: string): Promise<string | null> {
    if (this.driveFileIdCache) return this.driveFileIdCache;
    const q = encodeURIComponent(`name='${fileName}' and trashed=false`);
    const resp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${this.driveToken}` }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.files && data.files.length > 0) {
      this.driveFileIdCache = data.files[0].id;
      return this.driveFileIdCache;
    }
    return null;
  }

  private triggerAutoSyncIfEnabled(): void {
    if (this.autoSyncGoogleDrive() && this.isGoogleConnected() && this.driveToken) {
      this.uploadToGoogleDrive();
    }
  }

  public formatNumber(val: number): string {
    const num = Math.abs(val || 0);
    const parts = num.toFixed(2).split('.');
    let integerPart = parts[0];
    const decimalPart = parts[1];

    const fmt = this.numberFormat();
    let thousandSep = ',';
    let decimalSep = '.';

    if (fmt === '1.234,56') {
      thousandSep = '.';
      decimalSep = ',';
    } else if (fmt === '1 234.56') {
      thousandSep = ' ';
      decimalSep = '.';
    } else if (fmt === '1 234,56') {
      thousandSep = ' ';
      decimalSep = ',';
    } else if (fmt === '1234.56') {
      thousandSep = '';
      decimalSep = '.';
    }

    if (thousandSep) {
      integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSep);
    }

    return (val < 0 ? '-' : '') + integerPart + decimalSep + decimalPart;
  }

  public formatCurrency(amount: number): string {
    const c = this.currency();
    const symbol = c === 'EUR' ? '€' : c === 'USD' ? '$' : c === 'INR' ? '₹' : c === 'GBP' ? '£' : c + ' ';
    return symbol + this.formatNumber(amount);
  }

  public formatDate(dateStr: string): string {
    if (!dateStr) return '';
    const clean = dateStr.slice(0, 10);
    const parts = clean.split('-');
    if (parts.length !== 3) return dateStr;

    const y = parts[0];
    const m = parts[1];
    const d = parts[2];
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[parseInt(m, 10) - 1] || m;

    const fmt = this.dateFormat();
    if (fmt === 'dd/MM/yyyy') return `${d}/${m}/${y}`;
    if (fmt === 'MM/dd/yyyy') return `${m}/${d}/${y}`;
    if (fmt === 'MMMM d, yyyy') return `${monthName} ${parseInt(d, 10)}, ${y}`;
    return `${y}-${m}-${d}`;
  }

  public formatMonth(monthStr: string): string {
    if (!monthStr || monthStr === 'ALL') return monthStr;
    const parts = monthStr.split('-');
    if (parts.length !== 2) return monthStr;
    const y = parts[0];
    const m = parts[1];
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[parseInt(m, 10) - 1] || m;

    const fmt = this.dateFormat();
    if (fmt === 'dd/MM/yyyy' || fmt === 'MM/dd/yyyy') return `${m}/${y}`;
    if (fmt === 'MMMM d, yyyy') return `${monthName} ${y}`;
    return `${y}-${m}`;
  }
}
