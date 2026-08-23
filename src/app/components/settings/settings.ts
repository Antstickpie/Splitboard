import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';

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

  // Rule Engine Form
  public newRuleKeyword = '';
  public newRuleCategory = '';
  public newRuleSplitType: 'SELF' | 'OTHER' | 'SPLIT' = 'SPLIT';
  public newRuleOwner = '';

  // Exclude Rules Form
  public newExcludeBank = 'All';
  public newExcludeKeyword = '';

  constructor() {
    const firstGroup = this.service.categoryGroups()[0];
    if (firstGroup) this.selectedGroupIdForNewCat = firstGroup.id;
    if (firstGroup && firstGroup.items[0]) this.newRuleCategory = firstGroup.items[0].name;
  }

  public addRule() {
    if (!this.newRuleKeyword.trim() || !this.newRuleCategory) return;
    this.service.addRule({
      keyword: this.newRuleKeyword.trim(),
      categoryItem: this.newRuleCategory,
      splitType: this.newRuleSplitType,
      paidBy: this.newRuleOwner || undefined
    });
    this.newRuleKeyword = '';
  }

  public deleteRule(id: string) {
    this.service.deleteRule(id);
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
