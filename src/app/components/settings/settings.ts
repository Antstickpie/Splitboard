import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CategorySelectComponent } from '../category-select/category-select';
import { TransactionService, ImportedBatch } from '../../services/transaction.service';
import { BankConfig, CategoryRule, ExcludeRule, CategoryGroup, CategoryItem, Transaction } from '../../models';

export interface EveryDollarCategoryMapping {
  rawCategory: string;
  count: number;
  totalAmount: number;
  selectedItem: string;
  selectedGroup: string;
  selectedPerson: string;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, CategorySelectComponent],
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

  public onEdStartDateChange(val: string): void {
    this.edStartDate.set(val);
    if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
      const parts = val.split('-');
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const lastDay = new Date(y, m, 0).getDate();
      this.edEndDate.set(`${parts[0]}-${parts[1]}-${String(lastDay).padStart(2, '0')}`);
    }
  }

  public onEdStartDateTextChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input) return;
    const parsed = this.service.parseNumericDate(input.value);
    if (parsed) {
      this.onEdStartDateChange(parsed);
    } else {
      input.value = this.service.formatNumericDate(this.edStartDate());
    }
  }

  public onEdEndDateTextChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input) return;
    const parsed = this.service.parseNumericDate(input.value);
    if (parsed) {
      this.edEndDate.set(parsed);
    } else {
      input.value = this.service.formatNumericDate(this.edEndDate());
    }
  }

  public openNativeDatePicker(el: HTMLInputElement): void {
    try {
      if (el && typeof el.showPicker === 'function') {
        el.showPicker();
      } else {
        el?.focus();
      }
    } catch {
      el?.focus();
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

        let res: Response | null = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            res = await fetch(proxyUrl, { signal: this.edAbortController.signal });
            if (res.ok) {
              break;
            } else if (attempt === 1) {
              console.warn(`Attempt 1 failed for ${r.month} (HTTP ${res.status}), retrying in 1.2s...`);
              await new Promise((resolve) => setTimeout(resolve, 1200));
            }
          } catch (fetchErr: any) {
            if (this.edAbortController.signal.aborted) break;
            if (attempt === 1) {
              await new Promise((resolve) => setTimeout(resolve, 1200));
            } else {
              console.warn(`Connection error on ${r.month}:`, fetchErr.message);
            }
          }
        }

        if (this.edAbortController.signal.aborted) break;

        if (!res || !res.ok) {
          console.warn(`Skipping month ${r.month} due to error (${res ? res.status : 'no response'})`);
          continue;
        }

        const data = await res.json();
        const rawTxs = Array.isArray(data) ? data : (data.transactions || []);
        const parsed = this.service.parseEveryDollarTransactions(rawTxs);
        allParsed.push(...parsed);
      }

      this.edProgressPercent.set(100);
      this.edPreviewTransactions.set(allParsed);
      this.updateCategoryMappingsFromPreview();
      this.service.showToast(
        `Fetched ${allParsed.length} transactions across ${ranges.length} month(s)! Review categories and click Save.`,
        'success'
      );
    } catch (err: any) {
      this.service.showToast(err.message, 'error');
    } finally {
      this.edIsFetching.set(false);
      this.edAbortController = null;
      // Tell proxy to cleanly quit Chrome now that fetch is done
      try {
        await fetch('http://localhost:4000/close-browser');
      } catch (_) {}
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
      this.updateCategoryMappingsFromPreview();
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
        this.updateCategoryMappingsFromPreview();
        this.edImportResult.set(null);
        this.service.showToast(`Loaded ${parsed.length} transactions from ${file.name}!`, 'success');
      } catch (err: any) {
        this.service.showToast('Could not parse JSON file: ' + err.message, 'error');
      }
      input.value = '';
    };
    reader.readAsText(file);
  }

  // EveryDollar Category Mapping State
  public edCategoryMappings = signal<EveryDollarCategoryMapping[]>([]);
  public edExpandedCategory = signal<string | null>(null);
  public edSelectedCategoryFilter = signal<string | null>(null);
  public edAutoMatchedCount = signal<number>(0);

  public matchesPersonName(text: string, personName: string): boolean {
    if (!text || !personName) return false;
    const trimmed = personName.trim();
    if (!trimmed) return false;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^a-zA-Z0-9À-ÿ])${escaped}(?:$|[^a-zA-Z0-9À-ÿ])`, 'i');
    return regex.test(text);
  }

  public autoDetectOwnerForCategory(rawCategory: string): string {
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;
    if (this.matchesPersonName(rawCategory, p2)) return p2;
    if (this.matchesPersonName(rawCategory, p1)) return p1;
    return p1;
  }

  public toggleExpandCategory(rawCategory: string): void {
    if (this.edExpandedCategory() === rawCategory) {
      this.edExpandedCategory.set(null);
    } else {
      this.edExpandedCategory.set(rawCategory);
    }
  }

  public getTransactionsForCategory(rawCategory: string): Transaction[] {
    return this.edPreviewTransactions().filter((t) => (t.rawCategory || 'Uncategorized') === rawCategory);
  }

  public setCategoryFilter(rawCategory: string | null): void {
    this.edSelectedCategoryFilter.set(rawCategory);
  }

  public autoMatchAllCategoriesByName(): void {
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;
    let matchedCount = 0;

    const updatedMappings = this.edCategoryMappings().map((m) => {
      let targetPerson = m.selectedPerson;
      if (this.matchesPersonName(m.rawCategory, p2)) {
        targetPerson = p2;
        matchedCount++;
      } else if (this.matchesPersonName(m.rawCategory, p1)) {
        targetPerson = p1;
        matchedCount++;
      }
      return { ...m, selectedPerson: targetPerson };
    });

    this.edCategoryMappings.set(updatedMappings);

    // Also update all staged preview transactions
    const categoryToPersonMap = new Map(updatedMappings.map((m) => [m.rawCategory, m.selectedPerson]));
    this.edPreviewTransactions.update((txs) =>
      txs.map((t) => {
        const person = categoryToPersonMap.get(t.rawCategory || 'Uncategorized');
        return person ? { ...t, paidBy: person, splitType: 'SELF' } : t;
      })
    );

    this.edAutoMatchedCount.set(matchedCount);
    if (matchedCount > 0) {
      this.service.showToast(`Auto-assigned ${matchedCount} categories matching "${p1}" or "${p2}"!`, 'success');
    } else {
      this.service.showToast(`No category names matched "${p1}" or "${p2}".`, 'info');
    }
  }

  public updateCategoryMappingsFromPreview(): void {
    const txs = this.edPreviewTransactions();
    if (txs.length === 0) {
      this.edCategoryMappings.set([]);
      this.edExpandedCategory.set(null);
      this.edSelectedCategoryFilter.set(null);
      return;
    }

    const currentMappings = new Map<string, { item: string; group: string; person: string }>();
    for (const m of this.edCategoryMappings()) {
      currentMappings.set(m.rawCategory, { item: m.selectedItem, group: m.selectedGroup, person: m.selectedPerson });
    }

    const defaultPerson = this.service.personOne().name;

    const groupMap = new Map<string, { count: number; totalAmount: number }>();
    for (const tx of txs) {
      const cat = tx.rawCategory || 'Uncategorized';
      const existing = groupMap.get(cat) || { count: 0, totalAmount: 0 };
      existing.count += 1;
      existing.totalAmount += tx.amount;
      groupMap.set(cat, existing);
    }

    let autoMatches = 0;
    const result: EveryDollarCategoryMapping[] = [];
    groupMap.forEach((val, rawCategory) => {
      const existingMap = currentMappings.get(rawCategory);
      // Auto-detect person based on category name if not already manually set
      const detectedPerson = this.autoDetectOwnerForCategory(rawCategory);
      const selectedItem = existingMap?.item || 'Uncategorized';
      const selectedGroup = existingMap?.group || 'Uncategorized';
      const selectedPerson = existingMap?.person || detectedPerson;

      if (selectedPerson !== defaultPerson) autoMatches++;

      result.push({
        rawCategory,
        count: val.count,
        totalAmount: Math.round(val.totalAmount * 100) / 100,
        selectedItem,
        selectedGroup,
        selectedPerson,
      });
    });

    result.sort((a, b) => b.count - a.count);
    this.edCategoryMappings.set(result);
    this.edAutoMatchedCount.set(autoMatches);

    // Propagate assigned person and SELF split to all staged transactions
    const catPersonMap = new Map(result.map((m) => [m.rawCategory, m.selectedPerson]));
    this.edPreviewTransactions.update((curr) =>
      curr.map((t) => {
        const p = catPersonMap.get(t.rawCategory || 'Uncategorized') || defaultPerson;
        return { ...t, paidBy: p, splitType: 'SELF' };
      })
    );
  }

  public onCategoryMappingChange(rawCategory: string, selection: { item: string; group: string }): void {
    const chosenItem = selection.item || 'Uncategorized';
    const chosenGroup = selection.group || 'Uncategorized';

    // Update in mapping array
    this.edCategoryMappings.update((curr) =>
      curr.map((m) =>
        m.rawCategory === rawCategory
          ? { ...m, selectedItem: chosenItem, selectedGroup: chosenGroup }
          : m
      )
    );

    // Update all matching staged preview transactions
    this.edPreviewTransactions.update((curr) =>
      curr.map((tx) => {
        if ((tx.rawCategory || 'Uncategorized') === rawCategory) {
          return {
            ...tx,
            categoryItem: chosenItem,
            categoryGroup: chosenGroup,
          };
        }
        return tx;
      })
    );
  }

  public onCategoryPersonChange(rawCategory: string, personName: string): void {
    if (!personName) return;

    // Update in mapping array
    this.edCategoryMappings.update((curr) =>
      curr.map((m) =>
        m.rawCategory === rawCategory
          ? { ...m, selectedPerson: personName }
          : m
      )
    );

    // Update all matching staged preview transactions (split is always SELF)
    this.edPreviewTransactions.update((curr) =>
      curr.map((tx) => {
        if ((tx.rawCategory || 'Uncategorized') === rawCategory) {
          return {
            ...tx,
            paidBy: personName,
            splitType: 'SELF',
          };
        }
        return tx;
      })
    );

    this.service.showToast(`Assigned all transactions in "${rawCategory}" to ${personName}.`, 'info');
  }

  public assignAllMappingsToPerson(personName: string): void {
    if (!personName) return;

    this.edCategoryMappings.update((curr) =>
      curr.map((m) => ({ ...m, selectedPerson: personName }))
    );

    this.edPreviewTransactions.update((curr) =>
      curr.map((tx) => ({ ...tx, paidBy: personName, splitType: 'SELF' }))
    );

    this.service.showToast(`Assigned all EveryDollar transactions to ${personName} (split: SELF).`, 'info');
  }

  public setTxPerson(tx: Transaction, personName: string): void {
    if (!personName) return;
    this.edPreviewTransactions.update((curr) =>
      curr.map((t) => (t.id === tx.id ? { ...t, paidBy: personName, splitType: 'SELF' } : t))
    );
  }

  public resetAllCategoryMappingsToUncategorized(): void {
    this.edCategoryMappings.update((curr) =>
      curr.map((m) => ({
        ...m,
        selectedItem: 'Uncategorized',
        selectedGroup: 'Uncategorized',
      }))
    );

    this.edPreviewTransactions.update((curr) =>
      curr.map((tx) => ({
        ...tx,
        categoryItem: 'Uncategorized',
        categoryGroup: 'Uncategorized',
      }))
    );

    this.service.showToast('All EveryDollar categories reset to Uncategorized.', 'info');
  }

  public commitEveryDollarImport(): void {
    const preview = this.edPreviewTransactions();
    if (preview.length === 0) return;

    const result = this.service.importEveryDollarTransactions(preview);
    this.edImportResult.set(result);
    this.edPreviewTransactions.set([]);
    this.edCategoryMappings.set([]);
    this.service.showToast(
      `Successfully saved ${result.added} transactions (${result.skipped} duplicates skipped)!`,
      'success'
    );
  }

  public async undoLastEveryDollarImport(): Promise<void> {
    const last = this.service.lastEveryDollarImport();
    if (!last || last.ids.length === 0) {
      this.service.showToast('No recent EveryDollar import to undo.', 'info');
      return;
    }

    const ok = await this.service.showConfirm(
      'Undo EveryDollar Import',
      `Are you sure you want to delete all ${last.ids.length} imported transactions from Splitboard? They will be restored to your staging area.`
    );
    if (!ok) return;

    const { removed } = this.service.undoEveryDollarImport(last.ids);
    this.edPreviewTransactions.set(last.transactions);
    this.updateCategoryMappingsFromPreview();
    this.edImportResult.set(null);
    this.service.showToast(`Import undone: removed ${removed} transactions and restored to preview.`, 'success');
  }

  public get everyDollarBatches(): ImportedBatch[] {
    return this.service.importedBatches().filter((b) => b.fileName.startsWith('EveryDollar'));
  }

  public clearEveryDollarPreview(): void {
    this.edPreviewTransactions.set([]);
    this.edCategoryMappings.set([]);
    this.edImportResult.set(null);
  }

  public isTransactionDuplicate(tx: Transaction): boolean {
    const sig = this.service.getTransactionSignature(tx);
    const existingSigs = new Set(this.service.transactions().map((t) => this.service.getTransactionSignature(t)));
    const existingIds = new Set(this.service.transactions().map((t) => t.id));
    return existingIds.has(tx.id) || existingSigs.has(sig);
  }

  public filteredPreviewTransactions = computed(() => {
    let txs = this.edPreviewTransactions();
    const catFilter = this.edSelectedCategoryFilter();
    if (catFilter) {
      txs = txs.filter((t) => (t.rawCategory || 'Uncategorized') === catFilter);
    }
    const filter = this.edPreviewFilter();
    if (filter === 'all') return txs;
    if (filter === 'new') return txs.filter((t) => !this.isTransactionDuplicate(t));
    if (filter === 'duplicate') return txs.filter((t) => this.isTransactionDuplicate(t));
    return txs;
  });

  public readonly everyDollarConsoleSnippet: string = `(() => {
  const old = document.getElementById('splitboard-ed-modal');
  if (old) old.remove();

  const now = new Date();
  const defYear = now.getFullYear();
  const defMonth = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(defYear, now.getMonth() + 1, 0).getDate();

  const overlay = document.createElement('div');
  overlay.id = 'splitboard-ed-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.65);z-index:999999;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;backdrop-filter:blur(3px);';

  overlay.innerHTML = [
    '<div style="background:#131722;color:#f8fafc;padding:24px;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,0.6);border:1px solid rgba(56,189,248,0.3);width:420px;max-width:90vw;">',
    '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">',
    '    <div style="font-weight:700;font-size:15px;color:#38bdf8;display:flex;align-items:center;gap:6px;">',
    '      <span>💵</span> EveryDollar Exporter for Splitboard',
    '    </div>',
    '    <button id="sb-close" style="background:transparent;border:none;color:#94a3b8;font-size:18px;cursor:pointer;line-height:1;">✕</button>',
    '  </div>',
    '  <p style="font-size:12px;color:#94a3b8;margin:0 0 14px 0;line-height:1.4;">',
    '    Select a date range. The end date auto-fills to the month end to ensure full monthly queries under EveryDollar\\'s 500-tx limit.',
    '  </p>',
    '  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">',
    '    <div>',
    '      <label style="display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px;">START DATE</label>',
    '      <input id="sb-start" type="date" value="' + defYear + '-' + defMonth + '-01" style="width:100%;box-sizing:border-box;background:#1e293b;border:1px solid #334155;color:#f8fafc;padding:8px;border-radius:6px;font-size:13px;outline:none;">',
    '    </div>',
    '    <div>',
    '      <label style="display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px;">END DATE (AUTO)</label>',
    '      <input id="sb-end" type="date" value="' + defYear + '-' + defMonth + '-' + String(lastDay).padStart(2, '0') + '" style="width:100%;box-sizing:border-box;background:#1e293b;border:1px solid #334155;color:#f8fafc;padding:8px;border-radius:6px;font-size:13px;outline:none;">',
    '    </div>',
    '  </div>',
    '  <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;">',
    '    <button id="sb-prev" style="background:#1e293b;border:1px solid #334155;color:#cbd5e1;padding:4px 8px;border-radius:5px;font-size:11px;cursor:pointer;">◀ Last Month</button>',
    '    <button id="sb-cur" style="background:#1e293b;border:1px solid #334155;color:#cbd5e1;padding:4px 8px;border-radius:5px;font-size:11px;cursor:pointer;">This Month</button>',
    '    <button id="sb-3m" style="background:#1e293b;border:1px solid #334155;color:#cbd5e1;padding:4px 8px;border-radius:5px;font-size:11px;cursor:pointer;">Last 3 Mos</button>',
    '    <button id="sb-year" style="background:#1e293b;border:1px solid #334155;color:#cbd5e1;padding:4px 8px;border-radius:5px;font-size:11px;cursor:pointer;">Full Year</button>',
    '  </div>',
    '  <div id="sb-status" style="font-size:12px;color:#38bdf8;margin-bottom:12px;min-height:18px;"></div>',
    '  <button id="sb-run" style="width:100%;background:#0284c7;color:#fff;border:none;padding:10px;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">',
    '    🚀 Download Transactions JSON',
    '  </button>',
    '</div>'
  ].join('');

  document.body.appendChild(overlay);

  const startInput = document.getElementById('sb-start');
  const endInput = document.getElementById('sb-end');
  const statusEl = document.getElementById('sb-status');
  const runBtn = document.getElementById('sb-run');
  const closeBtn = document.getElementById('sb-close');

  closeBtn.onclick = () => overlay.remove();

  // Auto fill end date to end of the month when start date is changed!
  startInput.onchange = () => {
    const val = startInput.value;
    if (val) {
      const parts = val.split('-');
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const last = new Date(y, m, 0).getDate();
      endInput.value = parts[0] + '-' + parts[1] + '-' + String(last).padStart(2, '0');
    }
  };

  document.getElementById('sb-prev').onclick = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const last = new Date(y, d.getMonth() + 1, 0).getDate();
    startInput.value = y + '-' + m + '-01';
    endInput.value = y + '-' + m + '-' + String(last).padStart(2, '0');
  };

  document.getElementById('sb-cur').onclick = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const last = new Date(y, d.getMonth() + 1, 0).getDate();
    startInput.value = y + '-' + m + '-01';
    endInput.value = y + '-' + m + '-' + String(last).padStart(2, '0');
  };

  document.getElementById('sb-3m').onclick = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const last = new Date(y, d.getMonth() + 1, 0).getDate();
    endInput.value = y + '-' + m + '-' + String(last).padStart(2, '0');
    d.setMonth(d.getMonth() - 2);
    const sy = d.getFullYear();
    const sm = String(d.getMonth() + 1).padStart(2, '0');
    startInput.value = sy + '-' + sm + '-01';
  };

  document.getElementById('sb-year').onclick = () => {
    const y = new Date().getFullYear();
    startInput.value = y + '-01-01';
    endInput.value = y + '-12-31';
  };

  runBtn.onclick = async () => {
    const start = startInput.value;
    const end = endInput.value;
    if (!start || !end) {
      statusEl.textContent = '⚠️ Please select both start and end dates.';
      statusEl.style.color = '#f87171';
      return;
    }

    runBtn.disabled = true;
    runBtn.textContent = '⏳ Fetching EveryDollar...';
    runBtn.style.opacity = '0.6';

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

    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      statusEl.style.color = '#38bdf8';
      statusEl.textContent = 'Fetching [' + (i + 1) + '/' + ranges.length + '] ' + r.start + ' to ' + r.end + '...';
      try {
        const url = 'https://www.everydollar.com/app/api/transactions/search/findByDateRange?startDate=' + r.start + '&endDate=' + r.end + '&size=1000';
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) {
          console.warn('Failed ' + r.start + ': ' + res.status);
          continue;
        }
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data?._embedded?.transactions || []);
        allTxs.push(...items);
      } catch (err) {
        console.error('Error ' + r.start + ':', err);
      }
    }

    const seen = new Set();
    const deduped = allTxs.filter(t => {
      if (!t || !t.id) return true;
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    statusEl.style.color = '#4ade80';
    statusEl.textContent = '✅ Complete! ' + deduped.length + ' transactions fetched. Downloading...';

    const blob = new Blob([JSON.stringify(deduped, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'everydollar_' + start + '_to_' + end + '.json';
    a.click();

    setTimeout(() => {
      overlay.remove();
    }, 2500);
  };
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

