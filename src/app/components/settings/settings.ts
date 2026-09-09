import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CategorySelectComponent } from '../category-select/category-select';
import { TransactionService, ImportedBatch } from '../../services/transaction.service';
import { BankConfig, CategoryRule, ExcludeRule, CategoryGroup, CategoryItem, Transaction, SplitType, EveryDollarPeriodCurrencyRule } from '../../models';

export interface EveryDollarCategoryMapping {
  rawCategory: string;
  count: number;
  totalAmount: number;
  selectedItem: string;
  selectedGroup: string;
  selectedPerson: string;
  selectedSplitType: SplitType;
  isIncome?: boolean;
}

export interface EveryDollarDescriptionMapping {
  description: string;
  count: number;
  totalAmount: number;
  selectedItem: string;
  selectedGroup: string;
  selectedPerson: string;
  selectedSplitType: SplitType;
  rawCategories: string[];
  isIncome?: boolean;
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
  public edProxyBaseUrl: string = 'http://localhost:4000';

  public async checkEveryDollarProxy(showToast = false): Promise<boolean> {
    const urls = ['http://localhost:4000', 'http://127.0.0.1:4000'];
    let workingUrl: string | null = null;

    for (const u of urls) {
      try {
        const res = await fetch(`${u}/health`, { signal: AbortSignal.timeout(2500) });
        if (res.ok) {
          workingUrl = u;
          break;
        }
      } catch (_) {}
    }

    const ok = Boolean(workingUrl);
    if (workingUrl) {
      this.edProxyBaseUrl = workingUrl;
      this.edProxyStatus.set('running');
      if (showToast) {
        this.service.showToast('✅ EveryDollar proxy is connected and online!', 'success');
      }
    } else {
      this.edProxyStatus.set('offline');
      if (showToast) {
        this.service.showToast('❌ Proxy offline. Run "npm run start:proxy" in your terminal.', 'error');
      }
    }
    return ok;
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

        const proxyUrl = `${this.edProxyBaseUrl}/everydollar?startDate=${encodeURIComponent(r.start)}&endDate=${encodeURIComponent(r.end)}`;

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
      const converted = await this.service.applyCurrencyConversionToTransactions(allParsed);
      this.edPreviewTransactions.set(converted);
      this.updateCategoryMappingsFromPreview();

      if (allParsed.length > 0) {
        this.service.showToast(
          `Fetched ${allParsed.length} transactions across ${ranges.length} month(s)! Review categories and click Save.`,
          'success'
        );
      } else {
        this.service.showToast(
          'No transactions returned. Please verify that the proxy is running and you are logged into EveryDollar.',
          'error'
        );
      }
    } catch (err: any) {
      this.service.showToast(err.message, 'error');
    } finally {
      this.edIsFetching.set(false);
      this.edAbortController = null;
      // Tell proxy to cleanly quit Chrome now that fetch is done
      try {
        await fetch(`${this.edProxyBaseUrl}/close-browser`);
      } catch (_) {}
    }
  }

  public cancelEveryDollarFetch(): void {
    if (this.edAbortController) {
      this.edAbortController.abort();
    }
  }

  public async parsePastedEveryDollarJson(): Promise<void> {
    const raw = this.edRawJsonInput().trim();
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const rawTxs = Array.isArray(data) ? data : (data.transactions || []);
      const parsed = this.service.parseEveryDollarTransactions(rawTxs);
      const converted = await this.service.applyCurrencyConversionToTransactions(parsed);
      this.edPreviewTransactions.set(converted);
      this.updateCategoryMappingsFromPreview();
      this.edImportResult.set(null);
      this.service.showToast(`Parsed ${converted.length} EveryDollar transactions!`, 'success');
    } catch (e: any) {
      this.service.showToast('Invalid JSON: ' + e.message, 'error');
    }
  }

  public onEveryDollarJsonFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target?.result as string;
      try {
        const data = JSON.parse(content);
        const rawTxs = Array.isArray(data) ? data : (data.transactions || []);
        const parsed = this.service.parseEveryDollarTransactions(rawTxs);
        const converted = await this.service.applyCurrencyConversionToTransactions(parsed);
        this.edPreviewTransactions.set(converted);
        this.updateCategoryMappingsFromPreview();
        this.edImportResult.set(null);
        this.service.showToast(`Loaded ${converted.length} transactions from ${file.name}!`, 'success');
      } catch (err: any) {
        this.service.showToast('Could not parse JSON file: ' + err.message, 'error');
      }
      input.value = '';
    };
    reader.readAsText(file);
  }

  // EveryDollar View Mode & Category Mapping State
  public edGroupByMode = signal<'category' | 'description'>('category');
  public edCategoryMappings = signal<EveryDollarCategoryMapping[]>([]);
  public edExpandedCategory = signal<string | null>(null);
  public edSelectedCategoryFilter = signal<string | null>(null);
  public edCategoryMatchKeyword = signal<string>('');
  public edTypeMatchKeyword = signal<string>('');
  public edTypeBatchItem = signal<string>('');
  public edTypeBatchGroup = signal<string>('');
  public edEditingBatchFileName = signal<string | null>(null);
  public edTypeExcludeAssigned = signal<boolean>(false);
  public edDescExcludeAssigned = signal<boolean>(false);

  // EveryDollar Period Currency Rules State
  public edShowCurrencyPeriods = signal<boolean>(false);
  public newRuleFromMonth = signal<string>('');
  public newRuleToMonth = signal<string>('');
  public newRuleCurrency = signal<string>('EUR');
  public newRuleCustomCurrency = signal<string>('');

  public async addEdCurrencyRule(): Promise<void> {
    let from = this.newRuleFromMonth().trim();
    let to = this.newRuleToMonth().trim();

    // Auto-normalize if user typed 201708 or 2017-8
    if (/^\d{4}\d{2}$/.test(from)) from = `${from.slice(0, 4)}-${from.slice(4, 6)}`;
    if (/^\d{4}\d{2}$/.test(to)) to = `${to.slice(0, 4)}-${to.slice(4, 6)}`;
    if (/^\d{4}-\d{1}$/.test(from)) from = `${from.slice(0, 5)}0${from.slice(5)}`;
    if (/^\d{4}-\d{1}$/.test(to)) to = `${to.slice(0, 5)}0${to.slice(5)}`;

    let curr = (this.newRuleCurrency() === 'CUSTOM' ? this.newRuleCustomCurrency() : this.newRuleCurrency()).trim().toUpperCase();
    if (!curr) curr = 'EUR';

    if (!from || !to) {
      this.service.showToast('Please specify both From Month and To Month (format: YYYY-MM).', 'info');
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
      this.service.showToast('Please use YYYY-MM format (e.g. 2017-08).', 'error');
      return;
    }
    if (from > to) {
      this.service.showToast('From Month cannot be later than To Month.', 'error');
      return;
    }

    // Automatically add to visible currencies if not already present
    if (!this.service.visibleCurrencies().includes(curr)) {
      this.service.addVisibleCurrency(curr);
    }

    const newRule: EveryDollarPeriodCurrencyRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      fromMonth: from,
      toMonth: to,
      currency: curr
    };

    const updated = [...this.service.edCurrencyRules(), newRule];
    this.service.saveEdCurrencyRules(updated);
    this.newRuleFromMonth.set('');
    this.newRuleToMonth.set('');
    this.newRuleCustomCurrency.set('');

    await this.refreshPreviewCurrencyConversion();
    this.service.showToast(`Added period rule: ${from} to ${to} is ${curr}!`, 'success');
  }

  public async removeEdCurrencyRule(id: string): Promise<void> {
    const updated = this.service.edCurrencyRules().filter((r) => r.id !== id);
    this.service.saveEdCurrencyRules(updated);
    await this.refreshPreviewCurrencyConversion();
    this.service.showToast('Period rule removed.', 'info');
  }

  public async onEdDefaultCurrencyChange(curr: string): Promise<void> {
    this.service.saveEdDefaultCurrency(curr);
    await this.refreshPreviewCurrencyConversion();
  }

  public async refreshPreviewCurrencyConversion(): Promise<void> {
    const current = this.edPreviewTransactions();
    if (current.length === 0) return;
    const updated = await this.service.applyCurrencyConversionToTransactions(current);
    this.edPreviewTransactions.set(updated);
    this.updateCategoryMappingsFromPreview();
  }

  public async reapplyCurrencyRulesToExistingTransactions(): Promise<void> {
    const count = await this.service.reapplyCurrencyConversionToAllEveryDollarTransactions();
    if (count > 0) {
      this.service.showToast(`Updated currency conversion on ${count} EveryDollar transactions in ledger!`, 'success');
    } else {
      this.service.showToast('No EveryDollar transactions found in ledger to update.', 'info');
    }
  }

  // Description Grouping & Matching State
  public edDescriptionMatchKeyword = signal<string>('');
  public edDescriptionBatchItem = signal<string>('');
  public edDescriptionBatchGroup = signal<string>('');
  public edExpandedDescription = signal<string | null>(null);
  public edSelectedDescriptionFilter = signal<string | null>(null);

  // Performance & DOM Optimization Limits
  public edCategoryDisplayLimit = signal<number>(40);
  public edDescriptionDisplayLimit = signal<number>(30);
  public edShowPreviewTable = signal<boolean>(false);

  public togglePreviewTable(): void {
    this.edShowPreviewTable.update((v) => !v);
  }

  public loadMoreCategories(): void {
    this.edCategoryDisplayLimit.update((c) => c + 40);
  }

  public loadAllCategories(): void {
    this.edCategoryDisplayLimit.set(99999);
  }

  public loadMoreDescriptions(): void {
    this.edDescriptionDisplayLimit.update((c) => c + 40);
  }

  public loadAllDescriptions(): void {
    this.edDescriptionDisplayLimit.set(99999);
  }

  public edDescriptionMappings = computed<EveryDollarDescriptionMapping[]>(() => {
    // Ultra-fast optimization: only compute heavy description aggregation when in description mode
    if (this.edGroupByMode() !== 'description') {
      return [];
    }

    const txs = this.edPreviewTransactions();
    if (txs.length === 0) return [];

    const map = new Map<string, {
      count: number;
      totalAmount: number;
      categories: Set<string>;
      item: string;
      group: string;
      person: string;
      splitType: SplitType;
      isIncome: boolean;
    }>();

    for (const t of txs) {
      const desc = (t.description || 'No Description').trim();
      let entry = map.get(desc);
      if (!entry) {
        entry = {
          count: 0,
          totalAmount: 0,
          categories: new Set<string>(),
          item: t.categoryItem || 'Uncategorized',
          group: t.categoryGroup || 'Uncategorized',
          person: t.paidBy || this.service.personOne().name,
          splitType: t.splitType || 'SELF',
          isIncome: false,
        };
        map.set(desc, entry);
      }
      entry.count += 1;
      entry.totalAmount += t.amount;
      if (t.type === 'INCOME') {
        entry.isIncome = true;
      }
      if (t.rawCategory) {
        entry.categories.add(t.rawCategory);
      }
      if (entry.item === 'Uncategorized' && t.categoryItem && t.categoryItem !== 'Uncategorized') {
        entry.item = t.categoryItem;
        entry.group = t.categoryGroup || 'Uncategorized';
      }
    }

    const result: EveryDollarDescriptionMapping[] = [];
    map.forEach((val, desc) => {
      result.push({
        description: desc,
        count: val.count,
        totalAmount: Math.round(val.totalAmount * 100) / 100,
        selectedItem: val.item,
        selectedGroup: val.group,
        selectedPerson: val.person,
        selectedSplitType: val.splitType,
        rawCategories: Array.from(val.categories),
        isIncome: val.isIncome,
      });
    });

    result.sort((a, b) => b.count - a.count);
    return result;
  });

  public isCategoryMappingAssigned(m: EveryDollarCategoryMapping): boolean {
    return Boolean(m.selectedItem && m.selectedItem !== 'Uncategorized');
  }

  public isCategoryAssigned(rawCategory: string): boolean {
    const m = this.edCategoryMappings().find((c) => c.rawCategory === rawCategory);
    return m ? this.isCategoryMappingAssigned(m) : false;
  }

  public displayedDescriptionMappings = computed(() => {
    let list = this.edDescriptionMappings();
    if (this.edDescExcludeAssigned()) {
      list = list.filter((m) => !m.selectedItem || m.selectedItem === 'Uncategorized');
    }
    const q = this.edDescriptionMatchKeyword().trim().toLowerCase();
    if (!q) return list;

    const matched: EveryDollarDescriptionMapping[] = [];
    const unmatched: EveryDollarDescriptionMapping[] = [];
    for (const m of list) {
      if (m.description.toLowerCase().includes(q)) {
        matched.push(m);
      } else {
        unmatched.push(m);
      }
    }
    return [...matched, ...unmatched];
  });

  public displayedCategoryMappings = computed(() => {
    let list = this.edCategoryMappings();
    if (this.edTypeExcludeAssigned()) {
      list = list.filter((m) => !this.isCategoryMappingAssigned(m));
    }
    const qOwner = this.edCategoryMatchKeyword().trim().toLowerCase();
    const qType = this.edTypeMatchKeyword().trim().toLowerCase();

    if (!qOwner && !qType) {
      return list;
    }

    const matched: EveryDollarCategoryMapping[] = [];
    const unmatched: EveryDollarCategoryMapping[] = [];

    for (const m of list) {
      const cat = (m.rawCategory || '').toLowerCase();
      const isOwnerHit = qOwner ? cat.includes(qOwner) : false;
      const isTypeHit = qType ? cat.includes(qType) : false;
      if (isOwnerHit || isTypeHit) {
        matched.push(m);
      } else {
        unmatched.push(m);
      }
    }

    return [...matched, ...unmatched];
  });

  public isFirstUnmatched(m: EveryDollarCategoryMapping, idx: number): boolean {
    const qOwner = this.edCategoryMatchKeyword().trim().toLowerCase();
    const qType = this.edTypeMatchKeyword().trim().toLowerCase();
    if (!qOwner && !qType) return false;
    if (idx === 0) return false;
    if (this.isCategoryMatched(m.rawCategory)) return false;
    const prev = this.displayedCategoryMappings()[idx - 1];
    return prev ? this.isCategoryMatched(prev.rawCategory) : false;
  }

  public getMatchingCategoriesCount(keyword: string): number {
    const q = keyword.trim().toLowerCase();
    if (!q) return 0;
    return this.edCategoryMappings().filter((m) =>
      (m.rawCategory || '').toLowerCase().includes(q)
    ).length;
  }

  public getTypeMatchingCategoriesCount(keyword: string): number {
    const q = keyword.trim().toLowerCase();
    if (!q) return 0;
    const excludeAssigned = this.edTypeExcludeAssigned();
    return this.edCategoryMappings().filter((m) => {
      if (excludeAssigned && this.isCategoryMappingAssigned(m)) return false;
      return (m.rawCategory || '').toLowerCase().includes(q);
    }).length;
  }

  public isOwnerMatched(rawCategory: string): boolean {
    const q = this.edCategoryMatchKeyword().trim().toLowerCase();
    if (!q) return false;
    return (rawCategory || '').toLowerCase().includes(q);
  }

  public isTypeMatched(rawCategory: string): boolean {
    const q = this.edTypeMatchKeyword().trim().toLowerCase();
    if (!q) return false;
    if (this.edTypeExcludeAssigned() && this.isCategoryAssigned(rawCategory)) return false;
    return (rawCategory || '').toLowerCase().includes(q);
  }

  public isCategoryMatched(rawCategory: string): boolean {
    const q1 = this.edCategoryMatchKeyword().trim().toLowerCase();
    const isOwnerHit = q1 ? (rawCategory || '').toLowerCase().includes(q1) : false;
    const isTypeHit = this.isTypeMatched(rawCategory);
    return isOwnerHit || isTypeHit;
  }

  public getHighlightedCategoryHtml(text: string): string {
    const q1 = this.edCategoryMatchKeyword().trim();
    const q2 = (this.edTypeExcludeAssigned() && this.isCategoryAssigned(text))
      ? ''
      : this.edTypeMatchKeyword().trim();
    return this.highlightText(text, [q1, q2].filter(Boolean));
  }

  public getHighlightedDescriptionHtml(text: string): string {
    const q = this.edDescriptionMatchKeyword().trim();
    return this.highlightText(text, [q].filter(Boolean));
  }

  public highlightText(text: string, keywords: string[]): string {
    if (!text) return '';
    const valid = keywords.map((k) => k.trim()).filter((k) => k.length > 0);
    if (valid.length === 0) {
      return this.escapeHtml(text);
    }

    const escaped = valid
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .sort((a, b) => b.length - a.length);

    if (escaped.length === 0) return this.escapeHtml(text);

    const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = text.split(regex);
    const validLower = new Set(valid.map((k) => k.toLowerCase()));

    return parts
      .map((part) => {
        if (validLower.has(part.toLowerCase())) {
          return `<mark class="ed-highlight-mark">${this.escapeHtml(part)}</mark>`;
        }
        return this.escapeHtml(part);
      })
      .join('');
  }

  public escapeHtml(str: string): string {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  public assignMatchingCategoriesToPerson(personName: string): void {
    const q = this.edCategoryMatchKeyword().trim().toLowerCase();
    if (!q) {
      this.service.showToast('Please enter text in the box to match categories.', 'info');
      return;
    }

    let matchedCount = 0;
    const updatedMappings = this.edCategoryMappings().map((m) => {
      if ((m.rawCategory || '').toLowerCase().includes(q)) {
        matchedCount++;
        return { ...m, selectedPerson: personName, selectedSplitType: 'SELF' as SplitType };
      }
      return m;
    });

    if (matchedCount === 0) {
      this.service.showToast(`No categories contain "${this.edCategoryMatchKeyword().trim()}".`, 'info');
      return;
    }

    this.edCategoryMappings.set(updatedMappings);

    // Also update all staged preview transactions
    const categoryToPersonMap = new Map(updatedMappings.map((m) => [m.rawCategory, m.selectedPerson]));
    this.edPreviewTransactions.update((txs) =>
      txs.map((t) => {
        const p = categoryToPersonMap.get(t.rawCategory || 'Uncategorized');
        return p ? { ...t, paidBy: p, splitType: 'SELF' } : t;
      })
    );

    this.service.showToast(
      `Assigned ${matchedCount} categories containing "${this.edCategoryMatchKeyword().trim()}" to ${personName}!`,
      'success'
    );
  }

  public assignMatchingCategoriesToSplit(): void {
    const q = this.edCategoryMatchKeyword().trim().toLowerCase();
    if (!q) {
      this.service.showToast('Please enter text in the box to match categories.', 'info');
      return;
    }

    let matchedCount = 0;
    const updatedMappings = this.edCategoryMappings().map((m) => {
      if ((m.rawCategory || '').toLowerCase().includes(q)) {
        matchedCount++;
        return { ...m, selectedSplitType: 'SPLIT' as SplitType };
      }
      return m;
    });

    if (matchedCount === 0) {
      this.service.showToast(`No categories contain "${this.edCategoryMatchKeyword().trim()}".`, 'info');
      return;
    }

    this.edCategoryMappings.set(updatedMappings);

    // Update all matching preview transactions to splitType = 'SPLIT'
    const categorySplitMap = new Map(updatedMappings.map((m) => [m.rawCategory, m.selectedSplitType]));
    this.edPreviewTransactions.update((txs) =>
      txs.map((t) => {
        const sType = categorySplitMap.get(t.rawCategory || 'Uncategorized');
        return sType === 'SPLIT' ? { ...t, splitType: 'SPLIT' } : t;
      })
    );

    this.service.showToast(
      `Set ${matchedCount} categories containing "${this.edCategoryMatchKeyword().trim()}" to 50/50 Split!`,
      'success'
    );
  }

  public onTypeKeywordChange(keyword: string): void {
    this.edTypeMatchKeyword.set(keyword);
    this.edTypeBatchItem.set('');
    this.edTypeBatchGroup.set('');
  }

  public clearTypeMatchKeyword(): void {
    this.edTypeMatchKeyword.set('');
    this.edTypeBatchItem.set('');
    this.edTypeBatchGroup.set('');
  }

  public assignMatchingCategoriesToType(selection: { item: string; group: string }): void {
    const q = this.edTypeMatchKeyword().trim().toLowerCase();
    if (!q) {
      this.service.showToast('Please enter text in the category matcher box.', 'info');
      return;
    }
    const chosenItem = selection.item || 'Uncategorized';
    const chosenGroup = selection.group || 'Uncategorized';
    const excludeAssigned = this.edTypeExcludeAssigned();

    let matchedCount = 0;
    let skippedCount = 0;
    const updatedMappings = this.edCategoryMappings().map((m) => {
      if ((m.rawCategory || '').toLowerCase().includes(q)) {
        const isAssigned = this.isCategoryMappingAssigned(m);
        if (excludeAssigned && isAssigned) {
          skippedCount++;
          return m;
        }
        matchedCount++;
        return { ...m, selectedItem: chosenItem, selectedGroup: chosenGroup };
      }
      return m;
    });

    if (matchedCount === 0) {
      if (skippedCount > 0) {
        this.service.showToast(
          `All categories containing "${this.edTypeMatchKeyword().trim()}" are already assigned (${skippedCount} excluded).`,
          'info'
        );
      } else {
        this.service.showToast(`No categories contain "${this.edTypeMatchKeyword().trim()}".`, 'info');
      }
      return;
    }

    this.edTypeBatchItem.set(chosenItem);
    this.edTypeBatchGroup.set(chosenGroup);
    this.edCategoryMappings.set(updatedMappings);

    // Also update all staged preview transactions
    const categoryToTypeMap = new Map(
      updatedMappings.map((m) => [m.rawCategory, { item: m.selectedItem, group: m.selectedGroup }])
    );
    this.edPreviewTransactions.update((txs) =>
      txs.map((t) => {
        const typeInfo = categoryToTypeMap.get(t.rawCategory || 'Uncategorized');
        if (!typeInfo) return t;
        const isIncomeGroup = (typeInfo.group || '').toLowerCase().includes('income');
        return {
          ...t,
          categoryItem: typeInfo.item,
          categoryGroup: typeInfo.group,
          type: isIncomeGroup ? 'INCOME' : t.type
        };
      })
    );

    const skippedMsg = skippedCount > 0 ? ` (${skippedCount} already assigned excluded)` : '';
    this.service.showToast(
      `Assigned ${matchedCount} categories containing "${this.edTypeMatchKeyword().trim()}" to ${chosenItem}!${skippedMsg}`,
      'success'
    );
  }

  public setGroupByMode(mode: 'category' | 'description'): void {
    this.edGroupByMode.set(mode);
    this.edExpandedCategory.set(null);
    this.edExpandedDescription.set(null);
  }

  public onDescriptionKeywordChange(keyword: string): void {
    this.edDescriptionMatchKeyword.set(keyword);
    this.edDescriptionBatchItem.set('');
    this.edDescriptionBatchGroup.set('');
  }

  public clearDescriptionMatchKeyword(): void {
    this.edDescriptionMatchKeyword.set('');
    this.edDescriptionBatchItem.set('');
    this.edDescriptionBatchGroup.set('');
  }

  public isDescriptionMatched(desc: string): boolean {
    const q = this.edDescriptionMatchKeyword().trim().toLowerCase();
    if (!q) return false;
    return (desc || '').toLowerCase().includes(q);
  }

  public isFirstUnmatchedDescription(desc: string, idx: number): boolean {
    const q = this.edDescriptionMatchKeyword().trim().toLowerCase();
    if (!q || idx === 0) return false;
    if (this.isDescriptionMatched(desc)) return false;
    const prev = this.displayedDescriptionMappings()[idx - 1];
    return prev ? this.isDescriptionMatched(prev.description) : false;
  }

  public getMatchingDescriptionsCount(keyword: string): number {
    const q = keyword.trim().toLowerCase();
    if (!q) return 0;
    return this.edDescriptionMappings().filter((m) =>
      m.description.toLowerCase().includes(q)
    ).length;
  }

  public getMatchingTransactionsByDescriptionCount(keyword: string): number {
    const q = keyword.trim().toLowerCase();
    if (!q) return 0;
    return this.edPreviewTransactions().filter((t) =>
      (t.description || '').toLowerCase().includes(q)
    ).length;
  }

  public getDescriptionMatchingCount(keyword: string): number {
    const q = keyword.trim().toLowerCase();
    if (!q) return 0;
    const excludeAssigned = this.edDescExcludeAssigned();
    return this.edPreviewTransactions().filter((t) => {
      if (excludeAssigned && t.categoryItem && t.categoryItem !== 'Uncategorized') return false;
      return (t.description || '').toLowerCase().includes(q);
    }).length;
  }

  public toggleExpandDescription(desc: string): void {
    if (this.edExpandedDescription() === desc) {
      this.edExpandedDescription.set(null);
    } else {
      this.edExpandedDescription.set(desc);
    }
  }

  public getTransactionsForDescription(desc: string): Transaction[] {
    return this.edPreviewTransactions().filter(
      (t) => (t.description || 'No Description').trim() === desc
    );
  }

  public setDescriptionFilter(desc: string | null): void {
    this.edSelectedDescriptionFilter.set(desc);
    if (desc) {
      this.edSelectedCategoryFilter.set(null);
      this.edShowPreviewTable.set(true);
    }
  }

  public onDescriptionMappingCategoryChange(desc: string, selection: { item: string; group: string }): void {
    const chosenItem = selection.item || 'Uncategorized';
    const chosenGroup = selection.group || 'Uncategorized';
    const isIncomeGroup = chosenGroup.toLowerCase().includes('income');

    this.edPreviewTransactions.update((curr) =>
      curr.map((tx) => {
        if ((tx.description || 'No Description').trim() === desc) {
          return {
            ...tx,
            categoryItem: chosenItem,
            categoryGroup: chosenGroup,
            type: isIncomeGroup ? 'INCOME' : tx.type
          };
        }
        return tx;
      })
    );
    this.syncCategoryMappingsFromPreview();
  }

  public onDescriptionPersonChange(desc: string, personName: string): void {
    if (!personName) return;
    this.edPreviewTransactions.update((curr) =>
      curr.map((tx) => {
        if ((tx.description || 'No Description').trim() === desc) {
          return { ...tx, paidBy: personName, splitType: 'SELF' };
        }
        return tx;
      })
    );
    this.syncCategoryMappingsFromPreview();
    this.service.showToast(`Assigned transactions in "${desc}" to ${personName}.`, 'info');
  }

  public onDescriptionSplitTypeChange(desc: string, splitType: SplitType): void {
    this.edPreviewTransactions.update((curr) =>
      curr.map((tx) => {
        if ((tx.description || 'No Description').trim() === desc) {
          return { ...tx, splitType };
        }
        return tx;
      })
    );
    this.syncCategoryMappingsFromPreview();
    this.service.showToast(`Set split for "${desc}" to ${splitType === 'SPLIT' ? '50/50' : splitType}.`, 'info');
  }

  public assignMatchingDescriptionsToType(selection: { item: string; group: string }): void {
    const q = this.edDescriptionMatchKeyword().trim().toLowerCase();
    if (!q) {
      this.service.showToast('Please type a description in the box to match.', 'info');
      return;
    }
    const chosenItem = selection.item || 'Uncategorized';
    const chosenGroup = selection.group || 'Uncategorized';
    const isIncomeGroup = chosenGroup.toLowerCase().includes('income');
    const excludeAssigned = this.edDescExcludeAssigned();

    let matchedCount = 0;
    let skippedCount = 0;
    this.edPreviewTransactions.update((curr) =>
      curr.map((tx) => {
        if ((tx.description || '').toLowerCase().includes(q)) {
          const isAssigned = Boolean(tx.categoryItem && tx.categoryItem !== 'Uncategorized');
          if (excludeAssigned && isAssigned) {
            skippedCount++;
            return tx;
          }
          matchedCount++;
          return {
            ...tx,
            categoryItem: chosenItem,
            categoryGroup: chosenGroup,
            type: isIncomeGroup ? 'INCOME' : tx.type
          };
        }
        return tx;
      })
    );

    if (matchedCount === 0) {
      if (skippedCount > 0) {
        this.service.showToast(
          `All transactions matching "${this.edDescriptionMatchKeyword().trim()}" already have a category assigned (${skippedCount} excluded).`,
          'info'
        );
      } else {
        this.service.showToast(`No transactions found with description containing "${this.edDescriptionMatchKeyword().trim()}".`, 'info');
      }
      return;
    }

    this.edDescriptionBatchItem.set(chosenItem);
    this.edDescriptionBatchGroup.set(chosenGroup);
    this.syncCategoryMappingsFromPreview();
    const skippedMsg = skippedCount > 0 ? ` (${skippedCount} already assigned excluded)` : '';
    this.service.showToast(
      `Assigned ${matchedCount} transactions matching "${this.edDescriptionMatchKeyword().trim()}" to ${chosenItem}!${skippedMsg}`,
      'success'
    );
  }

  public assignMatchingDescriptionsToPerson(personName: string): void {
    const q = this.edDescriptionMatchKeyword().trim().toLowerCase();
    if (!q) {
      this.service.showToast('Please type a description in the box to match.', 'info');
      return;
    }

    let matchedCount = 0;
    this.edPreviewTransactions.update((curr) =>
      curr.map((tx) => {
        if ((tx.description || '').toLowerCase().includes(q)) {
          matchedCount++;
          return { ...tx, paidBy: personName, splitType: 'SELF' };
        }
        return tx;
      })
    );

    if (matchedCount === 0) {
      this.service.showToast(`No transactions found with description containing "${this.edDescriptionMatchKeyword().trim()}".`, 'info');
      return;
    }

    this.syncCategoryMappingsFromPreview();
    this.service.showToast(
      `Assigned ${matchedCount} transactions matching "${this.edDescriptionMatchKeyword().trim()}" to ${personName}!`,
      'success'
    );
  }

  public assignMatchingDescriptionsToSplit(): void {
    const q = this.edDescriptionMatchKeyword().trim().toLowerCase();
    if (!q) {
      this.service.showToast('Please type a description in the box to match.', 'info');
      return;
    }

    let matchedCount = 0;
    this.edPreviewTransactions.update((curr) =>
      curr.map((tx) => {
        if ((tx.description || '').toLowerCase().includes(q)) {
          matchedCount++;
          return { ...tx, splitType: 'SPLIT' };
        }
        return tx;
      })
    );

    if (matchedCount === 0) {
      this.service.showToast(`No transactions found with description containing "${this.edDescriptionMatchKeyword().trim()}".`, 'info');
      return;
    }

    this.syncCategoryMappingsFromPreview();
    this.service.showToast(
      `Set ${matchedCount} transactions matching "${this.edDescriptionMatchKeyword().trim()}" to 50/50 Split!`,
      'success'
    );
  }

  public syncCategoryMappingsFromPreview(): void {
    const txs = this.edPreviewTransactions();
    if (txs.length === 0) return;
    this.edCategoryMappings.update((curr) =>
      curr.map((m) => {
        const catTxs = txs.filter((t) => (t.rawCategory || 'Uncategorized') === m.rawCategory);
        if (catTxs.length === 0) return m;
        const defined = catTxs.find((t) => t.categoryItem && t.categoryItem !== 'Uncategorized');
        return {
          ...m,
          selectedItem: defined ? defined.categoryItem! : m.selectedItem,
          selectedGroup: defined ? (defined.categoryGroup || 'Uncategorized') : m.selectedGroup,
          selectedPerson: catTxs[0].paidBy || m.selectedPerson,
          selectedSplitType: catTxs[0].splitType || m.selectedSplitType,
        };
      })
    );
  }

  public autoMatchAllCategories(): void {
    const groups = this.service.categoryGroups();
    const allCandidates: { item: string; group: string; normItem: string; normGroup: string }[] = [];
    for (const g of groups) {
      const normGroup = this.normalizeCategoryText(g.name);
      for (const it of g.items) {
        allCandidates.push({
          item: it.name,
          group: g.name,
          normItem: this.normalizeCategoryText(it.name),
          normGroup,
        });
      }
    }

    let matchedCatCount = 0;
    const currentMappings = this.edCategoryMappings();
    const updatedMappings = currentMappings.map((m) => {
      const match = this.findBestCategoryMatch(m.rawCategory, allCandidates);
      if (match) {
        matchedCatCount++;
        return {
          ...m,
          selectedItem: match.item,
          selectedGroup: match.group,
        };
      }
      return m;
    });

    this.edCategoryMappings.set(updatedMappings);

    // Update preview transactions from category matches
    const categoryToTypeMap = new Map(
      updatedMappings.map((m) => [m.rawCategory, { item: m.selectedItem, group: m.selectedGroup }])
    );

    let txsUpdated = 0;
    this.edPreviewTransactions.update((txs) =>
      txs.map((t) => {
        const typeInfo = categoryToTypeMap.get(t.rawCategory || 'Uncategorized');
        if (typeInfo && typeInfo.item !== 'Uncategorized') {
          txsUpdated++;
          return { ...t, categoryItem: typeInfo.item, categoryGroup: typeInfo.group };
        }
        // Fallback: If still uncategorized, attempt matching against description
        const descMatch = this.findBestCategoryMatch(t.description || '', allCandidates);
        if (descMatch) {
          txsUpdated++;
          return { ...t, categoryItem: descMatch.item, categoryGroup: descMatch.group };
        }
        return t;
      })
    );

    this.syncCategoryMappingsFromPreview();

    if (matchedCatCount > 0 || txsUpdated > 0) {
      this.service.showToast(
        `✨ Auto-matched ${matchedCatCount} categories (${txsUpdated} transactions) to Splitboard categories!`,
        'success'
      );
    } else {
      this.service.showToast('No automatic category matches found.', 'info');
    }
  }

  private normalizeCategoryText(s: string): string {
    if (!s) return '';
    return s
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private findBestCategoryMatch(
    text: string,
    candidates: { item: string; group: string; normItem: string; normGroup: string }[]
  ): { item: string; group: string } | null {
    const normText = this.normalizeCategoryText(text);
    if (!normText || normText === 'uncategorized') return null;

    let bestMatch: { item: string; group: string } | null = null;
    let highestScore = 0;

    const stopWords = new Set(['and', '&', 'the', 'for', 'of', 'in', 'an', 'ai', 'to', 'a', 'or', 'on', 'at', 'with', 'inc', 'llc']);
    const rawWords = normText.split(' ').filter((w) => w.length >= 3 && !stopWords.has(w));

    for (const cand of candidates) {
      let score = 0;

      // 1. Exact match with item name
      if (normText === cand.normItem) {
        score = 1000;
      }
      // 2. Exact match with group name
      else if (normText === cand.normGroup) {
        score = 800;
      }
      // 3. Raw text contains the full item name (e.g. "Groceries (An)" contains "groceries")
      else if (normText.includes(cand.normItem) && cand.normItem.length >= 3) {
        score = 600 + cand.normItem.length * 10;
      }
      // 4. Item contains the full raw text (e.g. "Rent and Utilities" contains "rent" or "utilities")
      else if (cand.normItem.includes(normText) && normText.length >= 3) {
        score = 500 + normText.length * 10;
      }
      // 5. Raw text contains full group name
      else if (normText.includes(cand.normGroup) && cand.normGroup.length >= 3) {
        score = 400 + cand.normGroup.length * 5;
      }
      // 6. Group contains full raw text
      else if (cand.normGroup.includes(normText) && normText.length >= 3) {
        score = 350 + normText.length * 5;
      }
      // 7. Word overlap / stem partial matching
      else if (rawWords.length > 0) {
        const itemWords = cand.normItem.split(' ').filter((w) => w.length >= 3 && !stopWords.has(w));
        const groupWords = cand.normGroup.split(' ').filter((w) => w.length >= 3 && !stopWords.has(w));

        let matchedWords = 0;
        for (const rw of rawWords) {
          const itemHit = itemWords.some(
            (iw) => iw === rw || iw.startsWith(rw) || rw.startsWith(iw) || this.isFuzzyWordMatch(rw, iw)
          );
          const groupHit = groupWords.some(
            (gw) => gw === rw || gw.startsWith(rw) || rw.startsWith(gw) || this.isFuzzyWordMatch(rw, gw)
          );
          if (itemHit) matchedWords += 2;
          else if (groupHit) matchedWords += 1;
        }

        if (matchedWords > 0) {
          score = 200 + matchedWords * 50;
        }
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = { item: cand.item, group: cand.group };
      }
    }

    return highestScore >= 200 ? bestMatch : null;
  }

  private isFuzzyWordMatch(w1: string, w2: string): boolean {
    if (w1.length < 4 || w2.length < 4) return false;
    const prefixLen = Math.min(4, Math.min(w1.length, w2.length));
    return w1.slice(0, prefixLen) === w2.slice(0, prefixLen);
  }

  public autoDetectOwnerForCategory(rawCategory: string): string {
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;
    const catLower = (rawCategory || '').toLowerCase();
    if (p2 && catLower.includes(p2.toLowerCase())) return p2;
    if (p1 && catLower.includes(p1.toLowerCase())) return p1;
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
    if (rawCategory) {
      this.edSelectedDescriptionFilter.set(null);
      this.edShowPreviewTable.set(true);
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

    const currentMappings = new Map<string, { item: string; group: string; person: string; splitType: SplitType }>();
    for (const m of this.edCategoryMappings()) {
      currentMappings.set(m.rawCategory, {
        item: m.selectedItem,
        group: m.selectedGroup,
        person: m.selectedPerson,
        splitType: m.selectedSplitType
      });
    }

    const defaultPerson = this.service.personOne().name;

    const groupMap = new Map<string, { count: number; totalAmount: number; isIncome: boolean }>();
    for (const tx of txs) {
      const cat = tx.rawCategory || 'Uncategorized';
      const existing = groupMap.get(cat) || { count: 0, totalAmount: 0, isIncome: false };
      existing.count += 1;
      existing.totalAmount += tx.amount;
      if (tx.type === 'INCOME') {
        existing.isIncome = true;
      }
      groupMap.set(cat, existing);
    }

    const result: EveryDollarCategoryMapping[] = [];
    groupMap.forEach((val, rawCategory) => {
      const existingMap = currentMappings.get(rawCategory);
      // If transactions already carry person and category info (e.g. editing an existing batch)
      const sampleTx = txs.find((t) => (t.rawCategory || 'Uncategorized') === rawCategory);
      const txPerson = sampleTx?.paidBy;
      const txSplitType = sampleTx?.splitType || 'SELF';
      const txItem = sampleTx?.categoryItem && sampleTx.categoryItem !== 'Uncategorized' ? sampleTx.categoryItem : null;
      const txGroup = sampleTx?.categoryGroup && sampleTx.categoryGroup !== 'Uncategorized' ? sampleTx.categoryGroup : null;

      // Auto-detect person based on category name if not already manually set
      const detectedPerson = this.autoDetectOwnerForCategory(rawCategory);
      const selectedItem = existingMap?.item || txItem || 'Uncategorized';
      const selectedGroup = existingMap?.group || txGroup || 'Uncategorized';
      const selectedPerson = existingMap?.person || txPerson || detectedPerson;
      const selectedSplitType = existingMap?.splitType || txSplitType || 'SELF';

      result.push({
        rawCategory,
        count: val.count,
        totalAmount: Math.round(val.totalAmount * 100) / 100,
        selectedItem,
        selectedGroup,
        selectedPerson,
        selectedSplitType,
        isIncome: val.isIncome,
      });
    });

    result.sort((a, b) => b.count - a.count);
    this.edCategoryMappings.set(result);

    // Propagate assigned person, split type, and category to all staged transactions
    const catPersonMap = new Map(result.map((m) => [m.rawCategory, m.selectedPerson]));
    const catSplitMap = new Map(result.map((m) => [m.rawCategory, m.selectedSplitType]));
    const catTypeMap = new Map(result.map((m) => [m.rawCategory, { item: m.selectedItem, group: m.selectedGroup }]));
    this.edPreviewTransactions.update((curr) =>
      curr.map((t) => {
        const p = catPersonMap.get(t.rawCategory || 'Uncategorized') || defaultPerson;
        const sType = catSplitMap.get(t.rawCategory || 'Uncategorized') || 'SELF';
        const typeInfo = catTypeMap.get(t.rawCategory || 'Uncategorized');
        const catItem = typeInfo?.item || t.categoryItem || 'Uncategorized';
        const catGroup = typeInfo?.group || t.categoryGroup || 'Uncategorized';
        return { ...t, paidBy: p, splitType: sType, categoryItem: catItem, categoryGroup: catGroup };
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
          const isIncomeGroup = chosenGroup.toLowerCase().includes('income');
          return {
            ...tx,
            categoryItem: chosenItem,
            categoryGroup: chosenGroup,
            type: isIncomeGroup ? 'INCOME' : tx.type
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
          ? { ...m, selectedPerson: personName, selectedSplitType: 'SELF' as SplitType }
          : m
      )
    );

    // Update all matching staged preview transactions (split is SELF)
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

  public onCategorySplitTypeChange(rawCategory: string, splitType: SplitType): void {
    this.edCategoryMappings.update((curr) =>
      curr.map((m) =>
        m.rawCategory === rawCategory
          ? { ...m, selectedSplitType: splitType }
          : m
      )
    );

    this.edPreviewTransactions.update((curr) =>
      curr.map((tx) => {
        if ((tx.rawCategory || 'Uncategorized') === rawCategory) {
          return { ...tx, splitType };
        }
        return tx;
      })
    );

    this.service.showToast(`Set split for "${rawCategory}" to ${splitType === 'SPLIT' ? '50/50' : splitType}.`, 'info');
  }

  public assignAllMappingsToPerson(personName: string): void {
    if (!personName) return;

    this.edCategoryMappings.update((curr) =>
      curr.map((m) => ({ ...m, selectedPerson: personName, selectedSplitType: 'SELF' as SplitType }))
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

  public setTxSplit(tx: Transaction, splitType: SplitType): void {
    this.edPreviewTransactions.update((curr) =>
      curr.map((t) => (t.id === tx.id ? { ...t, splitType } : t))
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

  public async consolidateEveryDollarBatches(): Promise<void> {
    const edTxs = this.service.transactions().filter((t) => t.sourceFile?.startsWith('EveryDollar'));
    if (edTxs.length === 0) {
      this.service.showToast('No EveryDollar transactions found to consolidate.', 'info');
      return;
    }

    let minMonth = '';
    let maxMonth = '';
    for (const tx of edTxs) {
      const m = tx.date.slice(0, 7);
      if (!minMonth || m < minMonth) minMonth = m;
      if (!maxMonth || m > maxMonth) maxMonth = m;
    }

    const unifiedBatchName = minMonth === maxMonth
      ? `EveryDollar (${minMonth})`
      : `EveryDollar (${minMonth} to ${maxMonth})`;

    const ok = await this.service.showConfirm(
      'Consolidate EveryDollar Batches',
      `Merge all ${this.everyDollarBatches.length} separate EveryDollar batches (${edTxs.length} transactions) into a single batch named "${unifiedBatchName}"?`
    );
    if (!ok) return;

    const updated = edTxs.map((t) => ({ ...t, sourceFile: unifiedBatchName }));
    this.service.updateTransactionsBatch(updated);

    this.service.showToast(
      `✓ Successfully consolidated ${edTxs.length} transactions into "${unifiedBatchName}"!`,
      'success'
    );
  }

  public editEveryDollarBatch(batchFileName: string): void {
    const batchTxs = this.service.transactions().filter((t) => t.sourceFile === batchFileName);
    if (batchTxs.length === 0) {
      this.service.showToast(`No transactions found for batch "${batchFileName}".`, 'info');
      return;
    }

    // Clone to isolate edits until explicitly saved
    const clonedTxs: Transaction[] = batchTxs.map((t) => ({ ...t }));

    this.edEditingBatchFileName.set(batchFileName);
    this.edPreviewTransactions.set(clonedTxs);
    this.updateCategoryMappingsFromPreview();
    this.edImportResult.set(null);
    this.activeSettingsTab.set('everydollar');

    setTimeout(() => {
      const el = document.getElementById('ed-category-mapping-section');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);

    this.service.showToast(`Loaded ${batchTxs.length} transactions from "${batchFileName}" for editing.`, 'info');
  }

  public editLastEveryDollarImport(): void {
    const last = this.service.lastEveryDollarImport();
    if (!last || last.ids.length === 0) {
      this.service.showToast('No recent EveryDollar import to edit.', 'info');
      return;
    }
    const idSet = new Set(last.ids);
    const txs = this.service.transactions().filter((t) => idSet.has(t.id));
    if (txs.length === 0) {
      this.service.showToast('Transactions from the last import could not be found.', 'info');
      return;
    }
    const batchName = txs[0]?.sourceFile || 'Last EveryDollar Import';
    this.editEveryDollarBatch(batchName);
  }

  public saveEditedEveryDollarBatch(): void {
    const batchName = this.edEditingBatchFileName();
    if (!batchName) return;

    const updatedTxs = this.edPreviewTransactions();
    if (updatedTxs.length === 0) {
      this.cancelEditEveryDollarBatch();
      return;
    }

    this.service.updateTransactionsBatch(updatedTxs);
    this.service.showToast(
      `✓ Successfully updated ${updatedTxs.length} transactions in "${batchName}"!`,
      'success'
    );

    this.edEditingBatchFileName.set(null);
    this.edPreviewTransactions.set([]);
    this.edCategoryMappings.set([]);
    this.edCategoryMatchKeyword.set('');
    this.clearTypeMatchKeyword();
    this.clearDescriptionMatchKeyword();
    this.edSelectedCategoryFilter.set(null);
    this.edSelectedDescriptionFilter.set(null);
  }

  public cancelEditEveryDollarBatch(): void {
    this.edEditingBatchFileName.set(null);
    this.edPreviewTransactions.set([]);
    this.edCategoryMappings.set([]);
    this.edCategoryMatchKeyword.set('');
    this.clearTypeMatchKeyword();
    this.clearDescriptionMatchKeyword();
    this.edSelectedCategoryFilter.set(null);
    this.edSelectedDescriptionFilter.set(null);
    this.service.showToast('Edit cancelled; no changes were saved.', 'info');
  }

  public clearEveryDollarPreview(): void {
    this.edEditingBatchFileName.set(null);
    this.edPreviewTransactions.set([]);
    this.edCategoryMappings.set([]);
    this.edCategoryMatchKeyword.set('');
    this.clearTypeMatchKeyword();
    this.clearDescriptionMatchKeyword();
    this.edSelectedCategoryFilter.set(null);
    this.edSelectedDescriptionFilter.set(null);
    this.edImportResult.set(null);
  }

  public existingTxSignatures = computed(() => {
    return new Set(this.service.transactions().map((t) => this.service.getTransactionSignature(t)));
  });
  public existingTxIds = computed(() => {
    return new Set(this.service.transactions().map((t) => t.id));
  });

  public isTransactionDuplicate(tx: Transaction): boolean {
    const sig = this.service.getTransactionSignature(tx);
    return this.existingTxIds().has(tx.id) || this.existingTxSignatures().has(sig);
  }

  public filteredPreviewTransactions = computed(() => {
    // Ultra-fast optimization: don't compute expensive table filtering/matching when table is hidden
    if (!this.edShowPreviewTable()) {
      return [];
    }

    let txs = this.edPreviewTransactions();
    const catFilter = this.edSelectedCategoryFilter();
    const descFilter = this.edSelectedDescriptionFilter();
    if (catFilter) {
      txs = txs.filter((t) => (t.rawCategory || 'Uncategorized') === catFilter);
    } else if (descFilter) {
      txs = txs.filter((t) => (t.description || 'No Description').trim() === descFilter);
    }

    const filter = this.edPreviewFilter();
    if (filter === 'new') {
      txs = txs.filter((t) => !this.isTransactionDuplicate(t));
    } else if (filter === 'duplicate') {
      txs = txs.filter((t) => this.isTransactionDuplicate(t));
    }

    // If matcher keyword is active and not isolated to a single category/desc filter,
    // sort matching transactions to the top and the rest below
    if (!catFilter && !descFilter) {
      if (this.edGroupByMode() === 'category') {
        const qOwner = this.edCategoryMatchKeyword().trim().toLowerCase();
        const qType = this.edTypeMatchKeyword().trim().toLowerCase();
        if (qOwner || qType) {
          const matched: typeof txs = [];
          const unmatched: typeof txs = [];
          for (const t of txs) {
            const cat = (t.rawCategory || '').toLowerCase();
            const isMatched = (qOwner && cat.includes(qOwner)) || (qType && cat.includes(qType));
            if (isMatched) {
              matched.push(t);
            } else {
              unmatched.push(t);
            }
          }
          return [...matched, ...unmatched];
        }
      } else if (this.edGroupByMode() === 'description') {
        const qDesc = this.edDescriptionMatchKeyword().trim().toLowerCase();
        if (qDesc) {
          const matched: typeof txs = [];
          const unmatched: typeof txs = [];
          for (const t of txs) {
            if ((t.description || '').toLowerCase().includes(qDesc)) {
              matched.push(t);
            } else {
              unmatched.push(t);
            }
          }
          return [...matched, ...unmatched];
        }
      }
    }

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

