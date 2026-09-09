import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService, ImportedBatch } from '../../services/transaction.service';
import { BankConfig, CategoryRule, ExcludeRule, CategoryGroup, CategoryItem, Transaction } from '../../models';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.css'
})
export class SettingsComponent {
  public service = inject(TransactionService);

  public newPersonName = '';
  public newGroupName = '';
  public newCategoryName = '';
  public selectedGroupIdForNewCat = '';

  // Category Group & Item Edit Modals
  public editingGroup = signal<CategoryGroup | null>(null);
  public editGroupName = '';
  public editGroupIcon = '📁';

  public editingItem = signal<{ group: CategoryGroup; item: CategoryItem } | null>(null);
  public editItemName = '';
  public editItemGroupId = '';
  public editItemDefaultOwner = '';

  public quickEmojis = ['💰', '🏦', '🏠', '🚗', '🍽️', '✈️', '🎁', '💊', '📁', '👶', '⚡', '🛒', '🎮', '💻', '🎓', '🐾', '🏋️', '📚', '☕', '🛠️'];

  // Currency & Rates State
  public newCurrencyCode = '';
  public isRatesCollapsed = signal<boolean>(false);
  public isEditingRates = signal<boolean>(false);

  // Statement Batches Collapse State
  public expandedPeriods = signal<Set<string>>(new Set());
  public expandedOwners = signal<Set<string>>(new Set());

  public isPeriodExpanded(period: string): boolean {
    return this.expandedPeriods().has(period);
  }

  public togglePeriodExpanded(period: string): void {
    this.expandedPeriods.update((set) => {
      const next = new Set(set);
      if (next.has(period)) {
        next.delete(period);
      } else {
        next.add(period);
      }
      return next;
    });
  }

  public isOwnerExpanded(period: string, owner: string): boolean {
    return this.expandedOwners().has(`${period}::${owner}`);
  }

  public toggleOwnerExpanded(period: string, owner: string): void {
    const key = `${period}::${owner}`;
    this.expandedOwners.update((set) => {
      const next = new Set(set);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  public exchangeRatePairs = computed(() => {
    const currencies = this.service.visibleCurrencies();
    const pairs: Array<{ key: string; from: string; to: string; name: string; pairLabel: string; rate: number }> = [];

    for (let i = 0; i < currencies.length; i++) {
      for (let j = 0; j < currencies.length; j++) {
        if (i !== j) {
          const from = currencies[i];
          const to = currencies[j];
          const key = `${from}_${to}`;
          const rate = this.service.getExchangeRate(from, to);
          pairs.push({
            key,
            from,
            to,
            name: `1 ${from} = ${rate} ${to}`,
            pairLabel: `${from} → ${to}`,
            rate
          });
        }
      }
    }
    return pairs;
  });

  public updateExchangeRate(key: string, rate: number) {
    if (!isNaN(rate) && rate > 0) {
      this.service.exchangeRates.update((prev) => {
        const updated = { ...prev, [key]: rate };
        const delimiter = key.includes('_') ? '_' : '/';
        const parts = key.split(delimiter);
        if (parts.length === 2) {
          const inverseKey = `${parts[1]}${delimiter}${parts[0]}`;
          if (prev[inverseKey] !== undefined) {
            updated[inverseKey] = parseFloat((1.0 / rate).toFixed(6));
          }
        }
        return updated;
      });
    }
  }

  public openGoogleRate(from: string, to: string): void {
    const query = encodeURIComponent(`1 ${from} to ${to}`);
    window.open(`https://www.google.com/search?q=${query}`, '_blank');
  }

  public formatRefreshTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // Rule Engine Form
  public newRuleBank = 'All';
  public newRuleKeyword = '';
  public newRuleCategory = '';
  public newRuleCategoryGroup = '';
  public newRuleSplitType: 'SELF' | 'OTHER' | 'SPLIT' = 'SPLIT';
  public newRuleOwner = '';

  // Exclude Rules Form
  public newExcludeBank = 'All';
  public newExcludeKeyword = '';

  // Bank Config Form
  public newBankName = '';
  public newBankCurrency = 'EUR';
  public newBankAccountNo = '';
  public newBankDateCol = '';
  public newBankDescCol = '';
  public newBankDescCol2 = '';
  public newBankAmountCol = '';
  public newBankCurrencyCol = '';
  public newBankIgnoreCol = '';
  public newBankTableEndMarker = '';
  public newBankMaxLines = 3;
  public newBankInvertSign = false;
  public showAdvancedBankMapping = false;

  constructor() {
    const firstGroup = this.service.categoryGroups()[0];
    if (firstGroup) {
      this.selectedGroupIdForNewCat = firstGroup.id;
      this.newRuleCategoryGroup = firstGroup.name;
      if (firstGroup.items[0]) this.newRuleCategory = firstGroup.items[0].name;
    }
    this.newBankCurrency = this.service.currency();
  }

  public onNewRuleCategoryChange(composite: string): void {
    const parts = composite.split(':::');
    if (parts.length === 2) {
      this.newRuleCategoryGroup = parts[0];
      this.newRuleCategory = parts[1];
    } else {
      this.newRuleCategory = composite;
    }
  }

  public onEditRuleCategoryChange(composite: string): void {
    if (!this.editRuleModel) return;
    const parts = composite.split(':::');
    if (parts.length === 2) {
      this.editRuleModel.categoryGroup = parts[0];
      this.editRuleModel.categoryItem = parts[1];
    } else {
      this.editRuleModel.categoryItem = composite;
    }
  }

  public addBank() {
    if (!this.newBankName.trim()) return;
    this.service.addBankConfig({
      name: this.newBankName.trim(),
      defaultCurrency: this.newBankCurrency || this.service.currency(),
      accountNumber: this.newBankAccountNo.trim() || undefined,
      dateColName: this.newBankDateCol.trim() || undefined,
      descColName: this.newBankDescCol.trim() || undefined,
      descColName2: this.newBankDescCol2.trim() || undefined,
      amountColName: this.newBankAmountCol.trim() || undefined,
      currencyColName: this.newBankCurrencyCol.trim() || undefined,
      ignoreColName: this.newBankIgnoreCol.trim() || undefined,
      tableEndMarker: this.newBankTableEndMarker.trim() || undefined,
      maxDescLines: this.newBankMaxLines || undefined,
      invertAmountSign: this.newBankInvertSign || undefined
    });
    this.newBankName = '';
    this.newBankAccountNo = '';
    this.newBankDateCol = '';
    this.newBankDescCol = '';
    this.newBankDescCol2 = '';
    this.newBankAmountCol = '';
    this.newBankCurrencyCol = '';
    this.newBankIgnoreCol = '';
    this.newBankTableEndMarker = '';
    this.newBankMaxLines = 3;
    this.newBankInvertSign = false;
    this.showAdvancedBankMapping = false;
  }

  public editingBankId = signal<string | null>(null);
  public editBankModel: BankConfig | null = null;

  public startEditBank(b: BankConfig): void {
    this.editingBankId.set(b.id);
    this.editBankModel = { ...b };
  }

  public cancelEditBank(): void {
    this.editingBankId.set(null);
    this.editBankModel = null;
  }

  public saveEditBank(): void {
    if (!this.editBankModel || !this.editBankModel.name.trim()) return;
    this.service.updateBankConfig({
      ...this.editBankModel,
      name: this.editBankModel.name.trim()
    });
    this.editingBankId.set(null);
    this.editBankModel = null;
  }

  public async deleteBank(id: string, name: string) {
    const ok = await this.service.showConfirm('Remove Bank', `Remove "${name}" statement configuration?`);
    if (ok) {
      this.service.deleteBankConfig(id);
    }
  }

  // Category Rule Edit State
  public editingRuleId = signal<string | null>(null);
  public editRuleModel: CategoryRule | null = null;

  public startEditRule(r: CategoryRule): void {
    this.editingRuleId.set(r.id);
    this.editRuleModel = { ...r };
  }

  public cancelEditRule(): void {
    this.editingRuleId.set(null);
    this.editRuleModel = null;
  }

  public saveEditRule(): void {
    if (!this.editRuleModel || !this.editRuleModel.keyword.trim()) return;
    let group = this.editRuleModel.categoryGroup;
    if (!group) {
      for (const grp of this.service.categoryGroups()) {
        if (grp.items.some((i) => i.name === this.editRuleModel!.categoryItem)) {
          group = grp.name;
          break;
        }
      }
    }
    this.service.updateRule({
      ...this.editRuleModel,
      keyword: this.editRuleModel.keyword.trim(),
      categoryGroup: group
    });
    this.editingRuleId.set(null);
    this.editRuleModel = null;
  }

  public addRule() {
    if (!this.newRuleKeyword.trim() || !this.newRuleCategory) return;
    let group = this.newRuleCategoryGroup;
    if (!group) {
      for (const grp of this.service.categoryGroups()) {
        if (grp.items.some((i) => i.name === this.newRuleCategory)) {
          group = grp.name;
          break;
        }
      }
    }
    this.service.addRule({
      keyword: this.newRuleKeyword.trim(),
      categoryItem: this.newRuleCategory,
      categoryGroup: group,
      splitType: this.newRuleSplitType,
      paidBy: this.newRuleOwner || undefined,
      bank: this.newRuleBank || 'All'
    });
    this.newRuleKeyword = '';
    this.newRuleBank = 'All';
  }

  public deleteRule(id: string) {
    this.service.deleteRule(id);
  }

  // Exclude Rules Filter & Search
  public excludeRuleFilterBank = signal<string>('All');
  public excludeRuleSearch = signal<string>('');

  public filteredExcludeRules = computed(() => {
    const bankFilter = this.excludeRuleFilterBank().toLowerCase();
    const query = this.excludeRuleSearch().toLowerCase().trim();

    return this.service.excludeRules().filter((rule) => {
      const ruleBank = (rule.bank || 'All').toLowerCase();
      const matchesBank = bankFilter === 'all' || ruleBank === bankFilter || ruleBank.includes(bankFilter);
      const matchesQuery = !query || (rule.keyword && rule.keyword.toLowerCase().includes(query));
      return matchesBank && matchesQuery;
    });
  });

  // Category Rules Search
  public categoryRuleSearch = signal<string>('');

  public filteredCategoryRules = computed(() => {
    const query = this.categoryRuleSearch().toLowerCase().trim();
    if (!query) return this.service.rules();

    return this.service.rules().filter((rule) => {
      return (
        (rule.keyword && rule.keyword.toLowerCase().includes(query)) ||
        (rule.categoryItem && rule.categoryItem.toLowerCase().includes(query)) ||
        (rule.categoryGroup && rule.categoryGroup.toLowerCase().includes(query))
      );
    });
  });

  // Existing Rule Conflict / Overlap Detection
  public getExistingExcludeRuleWarning(keyword: string, bank: string): { type: 'exclude' | 'category'; rule: any; message: string } | null {
    const raw = (keyword || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
    if (!raw || raw.length < 2) return null;

    const existingExclude = this.service.excludeRules().find((r) => {
      const rKw = (r.keyword || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
      return rKw && (rKw === raw || rKw.includes(raw) || raw.includes(rKw));
    });
    if (existingExclude) {
      const b = (!existingExclude.bank || existingExclude.bank === 'All') ? 'All Banks' : existingExclude.bank;
      return {
        type: 'exclude',
        rule: existingExclude,
        message: `Existing Exclude Rule found: "${existingExclude.keyword}" for [${b}]`
      };
    }

    const existingCat = this.service.rules().find((r) => {
      const rKw = (r.keyword || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
      return rKw && (rKw === raw || rKw.includes(raw) || raw.includes(rKw));
    });
    if (existingCat) {
      const b = (!existingCat.bank || existingCat.bank === 'All') ? 'All Banks' : existingCat.bank;
      return {
        type: 'category',
        rule: existingCat,
        message: `Note: Category rule also exists: "${existingCat.keyword}" (${existingCat.categoryItem}) for [${b}]`
      };
    }

    return null;
  }

  public getExistingCategoryRuleWarning(keyword: string): { type: 'category' | 'exclude'; rule: any; message: string } | null {
    const raw = (keyword || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
    if (!raw || raw.length < 2) return null;

    const existingCat = this.service.rules().find((r) => {
      const rKw = (r.keyword || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
      return rKw && (rKw === raw || rKw.includes(raw) || raw.includes(rKw));
    });
    if (existingCat) {
      const b = (!existingCat.bank || existingCat.bank === 'All') ? 'All Banks' : existingCat.bank;
      return {
        type: 'category',
        rule: existingCat,
        message: `Existing Category Rule found: "${existingCat.keyword}" → ${existingCat.categoryItem} (${existingCat.splitType || 'SPLIT'}) for [${b}]`
      };
    }

    const existingExclude = this.service.excludeRules().find((r) => {
      const rKw = (r.keyword || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
      return rKw && (rKw === raw || rKw.includes(raw) || raw.includes(rKw));
    });
    if (existingExclude) {
      const b = (!existingExclude.bank || existingExclude.bank === 'All') ? 'All Banks' : existingExclude.bank;
      return {
        type: 'exclude',
        rule: existingExclude,
        message: `Note: Keyword is currently on the Exclude List for [${b}] ("${existingExclude.keyword}")`
      };
    }

    return null;
  }

  // Exclude Rule Edit State
  public editingExcludeRuleId = signal<string | null>(null);
  public editExcludeRuleModel: ExcludeRule | null = null;

  public startEditExcludeRule(r: ExcludeRule): void {
    this.editingExcludeRuleId.set(r.id);
    this.editExcludeRuleModel = { ...r };
  }

  public cancelEditExcludeRule(): void {
    this.editingExcludeRuleId.set(null);
    this.editExcludeRuleModel = null;
  }

  public saveEditExcludeRule(): void {
    if (!this.editExcludeRuleModel || !this.editExcludeRuleModel.keyword.trim()) return;
    this.service.updateExcludeRule({
      ...this.editExcludeRuleModel,
      keyword: this.editExcludeRuleModel.keyword.trim()
    });
    this.editingExcludeRuleId.set(null);
    this.editExcludeRuleModel = null;
  }

  public addExcludeRule() {
    if (!this.newExcludeKeyword.trim()) return;
    this.service.addExcludeRule(this.newExcludeBank, this.newExcludeKeyword.trim());
    this.newExcludeKeyword = '';
  }

  public deleteExcludeRule(id: string) {
    this.service.deleteExcludeRule(id);
  }

  public reapplyRules() {
    this.service.applyRulesToAllTransactions();
  }

  public addCurrency() {
    if (!this.newCurrencyCode.trim()) return;
    this.service.addVisibleCurrency(this.newCurrencyCode.trim());
    this.newCurrencyCode = '';
  }

  public addPerson() {
    if (!this.newPersonName.trim()) return;
    this.service.addPerson(this.newPersonName);
    this.newPersonName = '';
  }

  public updatePersonName(index: number, name: string) {
    this.service.updatePerson(index, name);
  }

  public async removePerson(index: number) {
    const p = this.service.persons()[index];
    const ok = await this.service.showConfirm('Remove Person', `Remove "${p.name}"?`);
    if (ok) {
      this.service.removePerson(index);
    }
  }

  public addGroup() {
    if (!this.newGroupName.trim()) return;
    this.service.addCategoryGroup(this.newGroupName);
    this.newGroupName = '';
  }

  public addCategory() {
    if (!this.newCategoryName.trim() || !this.selectedGroupIdForNewCat) return;
    this.service.addCategoryItem(this.selectedGroupIdForNewCat, this.newCategoryName);
    this.newCategoryName = '';
  }

  public async deleteCategoryItem(groupId: string, itemId: string, name: string) {
    const ok = await this.service.showConfirm('Delete Category', `Delete category "${name}"?`);
    if (ok) {
      this.service.deleteCategoryItem(groupId, itemId);
    }
  }

  public openEditGroupModal(grp: CategoryGroup) {
    this.editingGroup.set(grp);
    this.editGroupName = grp.name;
    this.editGroupIcon = grp.icon || '📁';
  }

  public closeEditGroupModal() {
    this.editingGroup.set(null);
  }

  public selectGroupIcon(icon: string) {
    this.editGroupIcon = icon;
  }

  public saveEditGroup() {
    const grp = this.editingGroup();
    if (!grp || !this.editGroupName.trim()) return;
    this.service.updateCategoryGroup(grp.id, this.editGroupName, this.editGroupIcon);
    this.closeEditGroupModal();
  }

  public async deleteGroupFromModal(grp: CategoryGroup) {
    const ok = await this.service.showConfirm('Delete Group', `Delete group "${grp.name}" and all its categories?`);
    if (ok) {
      this.service.deleteCategoryGroup(grp.id);
      this.closeEditGroupModal();
    }
  }

  public openEditItemModal(group: CategoryGroup, item: CategoryItem) {
    this.editingItem.set({ group, item });
    this.editItemName = item.name;
    this.editItemGroupId = group.id;
    this.editItemDefaultOwner = item.defaultOwner || '';
  }

  public closeEditItemModal() {
    this.editingItem.set(null);
  }

  public saveEditItem() {
    const data = this.editingItem();
    if (!data || !this.editItemName.trim()) return;
    this.service.updateCategoryItem(
      data.group.id,
      data.item.id,
      this.editItemName,
      this.editItemGroupId,
      this.editItemDefaultOwner || undefined
    );
    this.closeEditItemModal();
  }

  // Statement Batches Viewer / Manager
  public viewingBatch = signal<ImportedBatch | null>(null);

  public openBatchModal(b: ImportedBatch): void {
    this.viewingBatch.set(b);
  }

  public closeBatchModal(): void {
    this.viewingBatch.set(null);
  }

  public getBatchTransactions(fileName: string) {
    return this.service.transactions().filter((t) => t.sourceFile === fileName);
  }

  public async deleteBatchFromModal(fileName: string): Promise<void> {
    this.closeBatchModal();
    await this.service.undoImportBatch(fileName);
  }

  public onBackupFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    this.service.importBackupJson(file);
    input.value = '';
  }

  public async clearAllData() {
    const ok = await this.service.showConfirm(
      '⚠️ Clear All Transactions',
      'Are you sure you want to delete all transactions and split records? This cannot be undone.'
    );
    if (ok) {
      this.service.clearAllTransactions();
    }
  }

  public formatSyncTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(timestamp).toLocaleDateString();
  }

  // Settings Tab Navigation
  public activeSettingsTab = signal<'general' | 'categories' | 'banks' | 'everydollar'>('general');

  // EveryDollar Historical Importer State
  public edStartDate = signal<string>('2023-01-01');
  public edEndDate = signal<string>(new Date().toISOString().slice(0, 10));
  public edIsFetching = signal<boolean>(false);
  public edProgressMessage = signal<string>('');
  public edProgressPercent = signal<number>(0);
  public edPreviewTransactions = signal<Transaction[]>([]);
  public edRawJsonInput = signal<string>('');
  public edProxyStatus = signal<'unknown' | 'running' | 'offline'>('unknown');
  public edImportResult = signal<{ added: number; skipped: number } | null>(null);
  public edPreviewFilter = signal<'all' | 'new' | 'duplicate'>('all');
  public isJsonPasteOpen = signal<boolean>(false);
  public isEveryDollarGuideOpen = signal<boolean>(true);
  public activeGuideMethod = signal<'script' | 'proxy'>('script');
  public isScriptCopied = signal<boolean>(false);
  private edAbortController: AbortController | null = null;

  public async checkEveryDollarProxy(): Promise<boolean> {
    try {
      const res = await fetch('http://localhost:4000/health', { signal: AbortSignal.timeout(2000) });
      const ok = res.ok;
      this.edProxyStatus.set(ok ? 'running' : 'offline');
      return ok;
    } catch {
      this.edProxyStatus.set('offline');
      return false;
    }
  }

  public setEveryDollarPreset(preset: '12m' | '24m' | '60m' | '2024' | '2025' | '2026'): void {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const today = `${y}-${m}-${String(now.getDate()).padStart(2, '0')}`;

    if (preset === '12m') {
      this.edStartDate.set(`${y - 1}-${m}-01`);
      this.edEndDate.set(today);
    } else if (preset === '24m') {
      this.edStartDate.set(`${y - 2}-${m}-01`);
      this.edEndDate.set(today);
    } else if (preset === '60m') {
      this.edStartDate.set(`${y - 5}-01-01`);
      this.edEndDate.set(today);
    } else if (preset === '2024') {
      this.edStartDate.set('2024-01-01');
      this.edEndDate.set('2024-12-31');
    } else if (preset === '2025') {
      this.edStartDate.set('2025-01-01');
      this.edEndDate.set('2025-12-31');
    } else if (preset === '2026') {
      this.edStartDate.set('2026-01-01');
      this.edEndDate.set('2026-12-31');
    }
  }

  public generateMonthRanges(startStr: string, endStr: string): { start: string; end: string; month: string }[] {
    const ranges: { start: string; end: string; month: string }[] = [];
    if (!startStr || !endStr) return ranges;

    const [startYear, startMonth] = startStr.split('-').map(Number);
    const [endYear, endMonth] = endStr.split('-').map(Number);

    let currentYear = startYear;
    let currentMonth = startMonth;

    while (
      currentYear < endYear ||
      (currentYear === endYear && currentMonth <= endMonth)
    ) {
      const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

      const firstDayOfMonth = `${monthStr}-01`;
      const chunkStart = ranges.length === 0 && startStr > firstDayOfMonth ? startStr : firstDayOfMonth;

      const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
      const lastDayOfMonth = `${monthStr}-${String(daysInMonth).padStart(2, '0')}`;
      const chunkEnd =
        currentYear === endYear && currentMonth === endMonth && endStr < lastDayOfMonth
          ? endStr
          : lastDayOfMonth;

      ranges.push({
        start: chunkStart,
        end: chunkEnd,
        month: monthStr
      });

      currentMonth++;
      if (currentMonth > 12) {
        currentMonth = 1;
        currentYear++;
      }
    }

    return ranges;
  }

  public async fetchEveryDollarFromProxy(): Promise<void> {
    const start = this.edStartDate();
    const end = this.edEndDate();
    if (!start || !end) {
      this.service.showToast('Please select both start and end dates', 'error');
      return;
    }

    const ranges = this.generateMonthRanges(start, end);
    if (ranges.length === 0) {
      this.service.showToast('Invalid date range selected', 'error');
      return;
    }

    const isAlive = await this.checkEveryDollarProxy();
    if (!isAlive) {
      this.service.showToast(
        'EveryDollar proxy is not running. Please run "npm run start:proxy" in your terminal first.',
        'error'
      );
      return;
    }

    this.edIsFetching.set(true);
    this.edProgressPercent.set(0);
    this.edProgressMessage.set(`Connecting to EveryDollar for ${ranges.length} month(s)...`);
    this.edAbortController = new AbortController();
    this.edImportResult.set(null);

    const allParsed: Transaction[] = [];

    try {
      for (let i = 0; i < ranges.length; i++) {
        if (this.edAbortController.signal.aborted) {
          this.service.showToast('EveryDollar fetch cancelled', 'info');
          break;
        }

        const r = ranges[i];
        const pct = Math.round((i / ranges.length) * 100);
        this.edProgressPercent.set(pct);
        this.edProgressMessage.set(`Fetching month ${i + 1} of ${ranges.length} (${r.month})...`);

        const proxyUrl = `http://localhost:4000/everydollar?startDate=${encodeURIComponent(r.start)}&endDate=${encodeURIComponent(r.end)}`;

        let res: Response;
        try {
          res = await fetch(proxyUrl, { signal: this.edAbortController.signal });
        } catch (fetchErr: any) {
          if (this.edAbortController.signal.aborted) break;
          throw new Error(`Connection error on ${r.month}: ${fetchErr.message}`);
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} from proxy on ${r.month}`);
        }

        const data = await res.json();
        const rawTxs = Array.isArray(data) ? data : (data.transactions || []);
        const parsed = this.service.parseEveryDollarTransactions(rawTxs);
        allParsed.push(...parsed);
      }

      this.edProgressPercent.set(100);
      this.edPreviewTransactions.set(allParsed);
      this.service.showToast(
        `Fetched ${allParsed.length} transactions across ${ranges.length} month(s)! Review and click Save.`,
        'success'
      );
    } catch (err: any) {
      this.service.showToast(err.message, 'error');
    } finally {
      this.edIsFetching.set(false);
      this.edAbortController = null;
    }
  }

  public cancelEveryDollarFetch(): void {
    if (this.edAbortController) {
      this.edAbortController.abort();
    }
  }

  public parsePastedEveryDollarJson(): void {
    const raw = this.edRawJsonInput().trim();
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const rawTxs = Array.isArray(data) ? data : (data.transactions || []);
      const parsed = this.service.parseEveryDollarTransactions(rawTxs);
      this.edPreviewTransactions.set(parsed);
      this.edImportResult.set(null);
      this.service.showToast(`Parsed ${parsed.length} EveryDollar transactions!`, 'success');
    } catch (e: any) {
      this.service.showToast('Invalid JSON: ' + e.message, 'error');
    }
  }

  public onEveryDollarJsonFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        const data = JSON.parse(content);
        const rawTxs = Array.isArray(data) ? data : (data.transactions || []);
        const parsed = this.service.parseEveryDollarTransactions(rawTxs);
        this.edPreviewTransactions.set(parsed);
        this.edImportResult.set(null);
        this.service.showToast(`Loaded ${parsed.length} transactions from ${file.name}!`, 'success');
      } catch (err: any) {
        this.service.showToast('Could not parse JSON file: ' + err.message, 'error');
      }
      input.value = '';
    };
    reader.readAsText(file);
  }

  public commitEveryDollarImport(): void {
    const preview = this.edPreviewTransactions();
    if (preview.length === 0) return;

    const result = this.service.importEveryDollarTransactions(preview);
    this.edImportResult.set(result);
    this.edPreviewTransactions.set([]);
    this.service.showToast(
      `Successfully saved ${result.added} transactions (${result.skipped} duplicates skipped)!`,
      'success'
    );
  }

  public clearEveryDollarPreview(): void {
    this.edPreviewTransactions.set([]);
    this.edImportResult.set(null);
  }

  public isTransactionDuplicate(tx: Transaction): boolean {
    const sig = this.service.getTransactionSignature(tx);
    const existingSigs = new Set(this.service.transactions().map((t) => this.service.getTransactionSignature(t)));
    const existingIds = new Set(this.service.transactions().map((t) => t.id));
    return existingIds.has(tx.id) || existingSigs.has(sig);
  }

  public filteredPreviewTransactions = computed(() => {
    const txs = this.edPreviewTransactions();
    const filter = this.edPreviewFilter();
    if (filter === 'all') return txs;
    if (filter === 'new') return txs.filter((t) => !this.isTransactionDuplicate(t));
    if (filter === 'duplicate') return txs.filter((t) => this.isTransactionDuplicate(t));
    return txs;
  });

  public readonly everyDollarConsoleSnippet: string = `(async () => {
  const start = prompt('Start Date (YYYY-MM-DD):', '2025-01-01');
  const end = prompt('End Date (YYYY-MM-DD):', '2025-01-31');
  if (!start || !end) return;

  function getMonthRanges(s, e) {
    const cur = new Date(s + 'T00:00:00');
    const stop = new Date(e + 'T23:59:59');
    const ranges = [];
    while (cur <= stop) {
      const y = cur.getFullYear();
      const m = cur.getMonth();
      const startStr = y + '-' + String(m + 1).padStart(2, '0') + '-01';
      const lastDay = new Date(y, m + 1, 0).getDate();
      const endStr = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
      ranges.push({ start: startStr < s ? s : startStr, end: endStr > e ? e : endStr });
      cur.setMonth(cur.getMonth() + 1);
      cur.setDate(1);
    }
    return ranges;
  }

  const ranges = getMonthRanges(start, end);
  let allTxs = [];
  console.log(\`🚀 Slicing \${ranges.length} month(s) to stay safely under EveryDollar's 500-transaction query limit...\`);

  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    console.log(\`[\${i + 1}/\${ranges.length}] Fetching \${r.start} to \${r.end}...\`);
    try {
      const url = \`https://www.everydollar.com/app/api/transactions/search/findByDateRange?startDate=\${r.start}&endDate=\${r.end}&size=1000\`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        console.warn(\`Failed \${r.start} - status \${res.status}\`);
        continue;
      }
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data?._embedded?.transactions || []);
      allTxs.push(...items);
    } catch (err) {
      console.error(\`Error fetching \${r.start}:\`, err);
    }
  }

  const seen = new Set();
  const deduped = allTxs.filter(t => {
    if (!t || !t.id) return true;
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  const blob = new Blob([JSON.stringify(deduped, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = \`everydollar_\${start}_to_\${end}.json\`;
  a.click();
  alert(\`✅ Done! Downloaded \${deduped.length} transactions into everydollar_\${start}_to_\${end}.json. Now import it into Splitboard!\`);
})();`;

  public copyConsoleSnippet(): void {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(this.everyDollarConsoleSnippet).then(() => {
        this.isScriptCopied.set(true);
        this.service.showToast('📋 EveryDollar console script copied to clipboard!', 'success');
        setTimeout(() => this.isScriptCopied.set(false), 3000);
      }).catch(() => {
        this.service.showToast('Could not copy to clipboard automatically.', 'error');
      });
    }
  }

  public openEveryDollarUrl(): void {
    const start = this.edStartDate();
    const end = this.edEndDate();
    const url = `https://www.everydollar.com/app/api/transactions/search/findByDateRange?startDate=${start}&endDate=${end}&size=1000`;
    window.open(url, '_blank');
  }
}

