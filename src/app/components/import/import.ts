import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { StatementParserService, ParsedStatementResult } from '../../services/statement-parser.service';
import { Transaction } from '../../models';

export interface TransactionGroup {
  id: string;
  title: string;
  count: number;
  totalAmount: number;
  items: Transaction[];
}

@Component({
  selector: 'app-import',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './import.html',
  styleUrl: './import.css'
})
export class ImportComponent {
  public service = inject(TransactionService);
  private parser = inject(StatementParserService);

  public selectedBank = signal<string>('Deutsche Bank');
  public selectedOwner = signal<string>('');
  public uploadedFileName = signal<string>('');
  public isParsing = signal<boolean>(false);
  public rawClipboardText = '';

  public previewResult = signal<ParsedStatementResult | null>(null);
  public previewTab = signal<'valid' | 'duplicates' | 'excluded'>('valid');

  constructor() {
    const firstBank = this.service.bankConfigs()[0];
    if (firstBank) {
      this.selectedBank.set(firstBank.name);
    }
    this.selectedOwner.set(this.service.personOne().name);
  }

  public onBankChange(bankName: string): void {
    this.selectedBank.set(bankName);
  }

  // Quick Add Bank Directly from Import Page
  public isAddingBankInline = false;
  public newInlineBankName = '';

  public saveInlineBank(): void {
    if (!this.newInlineBankName.trim()) return;
    const name = this.newInlineBankName.trim();
    this.service.addBankConfig({
      name
    });
    this.selectedBank.set(name);
    this.newInlineBankName = '';
    this.isAddingBankInline = false;
  }

  public async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.uploadedFileName.set(file.name);
    this.isParsing.set(true);
    this.previewTab.set('valid');

    try {
      const res = await this.parser.parseFile(file, this.selectedBank(), this.selectedOwner());
      this.previewResult.set(res);
      this.service.showToast(
        `Parsed ${res.transactions.length} new transactions (${res.duplicatesCount} duplicates, ${res.excludedCount} excluded)`,
        'info'
      );
    } catch (e: any) {
      this.service.showToast('Error parsing file: ' + e.message, 'error');
    } finally {
      this.isParsing.set(false);
      input.value = '';
    }
  }

  public parseClipboardText() {
    if (!this.rawClipboardText.trim()) return;
    this.isParsing.set(true);
    this.previewTab.set('valid');

    try {
      const res = this.parser.parseText(
        this.rawClipboardText,
        this.selectedBank(),
        this.selectedOwner(),
        'Clipboard Paste'
      );
      this.previewResult.set(res);
      this.service.showToast(
        `Parsed ${res.transactions.length} new transactions (${res.duplicatesCount} duplicates, ${res.excludedCount} excluded)`,
        'info'
      );
    } catch (e: any) {
      this.service.showToast('Error parsing text: ' + e.message, 'error');
    } finally {
      this.isParsing.set(false);
    }
  }

  public includeDuplicate(tx: Transaction): void {
    const res = this.previewResult();
    if (!res) return;
    this.previewResult.set({
      ...res,
      duplicates: res.duplicates.filter((t) => t.id !== tx.id),
      transactions: [tx, ...res.transactions],
      duplicatesCount: Math.max(0, res.duplicatesCount - 1)
    });
    this.service.showToast('Included transaction in import list', 'success');
  }

  public includeAllDuplicates(): void {
    const res = this.previewResult();
    if (!res || res.duplicates.length === 0) return;
    const count = res.duplicates.length;
    this.previewResult.set({
      ...res,
      transactions: [...res.transactions, ...res.duplicates],
      duplicates: [],
      duplicatesCount: 0
    });
    this.service.showToast(`Included all ${count} duplicate rows into import list`, 'success');
  }

  public includeExcluded(tx: Transaction): void {
    const res = this.previewResult();
    if (!res) return;
    this.previewResult.set({
      ...res,
      excluded: res.excluded.filter((t) => t.id !== tx.id),
      transactions: [tx, ...res.transactions],
      excludedCount: Math.max(0, res.excludedCount - 1)
    });
    this.service.showToast('Included transaction in import list', 'success');
  }

  // Smart Grouping for Excluded & Duplicate Transactions
  public expandedGroups = signal<Set<string>>(new Set());

  public toggleGroup(groupId: string): void {
    this.expandedGroups.update((set) => {
      const next = new Set(set);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  public isGroupExpanded(groupId: string): boolean {
    return this.expandedGroups().has(groupId);
  }

  private groupTransactions(txs: Transaction[], isExcluded: boolean): TransactionGroup[] {
    const rules = this.service.excludeRules();
    const map = new Map<string, TransactionGroup>();

    for (const tx of txs) {
      let groupKey = '';
      const desc = tx.description || 'Other';

      if (isExcluded) {
        const matchedRule = rules.find((r) => desc.toLowerCase().includes(r.keyword.toLowerCase().trim()));
        if (matchedRule) {
          groupKey = matchedRule.keyword;
        }
      }

      if (!groupKey) {
        let cleaned = desc
          .replace(/for\s+[A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?/gi, '')
          .replace(/\b\d{4}[./-]\d{2}[./-]\d{2}\b/g, '')
          .replace(/\b\d{2}[./-]\d{2}[./-]\d{4}\b/g, '')
          .replace(/\*\d{4}/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        const words = cleaned.split(' ');
        groupKey = words.slice(0, Math.min(5, words.length)).join(' ');
        if (!groupKey) groupKey = desc.slice(0, 30);
      }

      const id = 'grp-' + groupKey.toLowerCase().replace(/[^a-z0-9]/g, '-');
      if (!map.has(groupKey)) {
        map.set(groupKey, {
          id,
          title: groupKey,
          count: 0,
          totalAmount: 0,
          items: []
        });
      }

      const g = map.get(groupKey)!;
      g.count++;
      g.totalAmount += Number(tx.amount) || 0;
      g.items.push(tx);
    }

    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }

  public groupedExcluded = computed(() => {
    const res = this.previewResult();
    if (!res || !res.excluded || res.excluded.length === 0) return [];
    return this.groupTransactions(res.excluded, true);
  });

  public groupedDuplicates = computed(() => {
    const res = this.previewResult();
    if (!res || !res.duplicates || res.duplicates.length === 0) return [];
    return this.groupTransactions(res.duplicates, false);
  });

  public includeExcludedGroup(group: TransactionGroup): void {
    const res = this.previewResult();
    if (!res) return;
    const groupItemIds = new Set(group.items.map((t) => t.id));
    this.previewResult.set({
      ...res,
      excluded: res.excluded.filter((t) => !groupItemIds.has(t.id)),
      transactions: [...group.items, ...res.transactions],
      excludedCount: Math.max(0, res.excludedCount - group.count)
    });
    this.service.showToast(`Included all ${group.count} transactions from "${group.title}"`, 'success');
  }

  public includeDuplicateGroup(group: TransactionGroup): void {
    const res = this.previewResult();
    if (!res) return;
    const groupItemIds = new Set(group.items.map((t) => t.id));
    this.previewResult.set({
      ...res,
      duplicates: res.duplicates.filter((t) => !groupItemIds.has(t.id)),
      transactions: [...group.items, ...res.transactions],
      duplicatesCount: Math.max(0, res.duplicatesCount - group.count)
    });
    this.service.showToast(`Included all ${group.count} transactions from "${group.title}"`, 'success');
  }

  public includeAllExcluded(): void {
    const res = this.previewResult();
    if (!res || res.excluded.length === 0) return;
    const count = res.excluded.length;
    this.previewResult.set({
      ...res,
      transactions: [...res.transactions, ...res.excluded],
      excluded: [],
      excludedCount: 0
    });
    this.service.showToast(`Included all ${count} excluded rows into import list`, 'success');
  }

  public removeValidTransaction(txId: string): void {
    const res = this.previewResult();
    if (!res) return;
    this.previewResult.set({
      ...res,
      transactions: res.transactions.filter((t) => t.id !== txId)
    });
  }

  public async commitImport() {
    const res = this.previewResult();
    if (!res || res.transactions.length === 0) return;

    this.service.addTransactions(res.transactions);
    this.service.showToast(`Successfully imported ${res.transactions.length} transactions!`, 'success');

    if (res.duplicatesCount > 0 || res.excludedCount > 0) {
      let msg = `Imported ${res.transactions.length} new transactions.`;
      if (res.duplicatesCount > 0) msg += `\n• Skipped ${res.duplicatesCount} duplicates.`;
      if (res.excludedCount > 0) msg += `\n• Filtered ${res.excludedCount} excluded by bank rules.`;
      await this.service.showAlert('Import Completed', msg);
    }

    this.clearPreview();
  }

  public clearPreview() {
    this.previewResult.set(null);
    this.uploadedFileName.set('');
    this.rawClipboardText = '';
  }
}
