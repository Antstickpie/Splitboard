import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService, ImportedBatch } from '../../services/transaction.service';
import { BankConfig, CategoryRule, ExcludeRule, CategoryGroup, CategoryItem } from '../../models';

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
    if (firstGroup) this.selectedGroupIdForNewCat = firstGroup.id;
    if (firstGroup && firstGroup.items[0]) this.newRuleCategory = firstGroup.items[0].name;
    this.newBankCurrency = this.service.currency();
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
    let group = '';
    for (const grp of this.service.categoryGroups()) {
      if (grp.items.some((i) => i.name === this.newRuleCategory)) {
        group = grp.name;
        break;
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
}
