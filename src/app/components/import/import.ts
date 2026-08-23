import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { StatementParserService, ParsedStatementResult } from '../../services/statement-parser.service';
import { Transaction } from '../../models';

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
      this.selectedOwner.set(firstBank.defaultOwner || this.service.personOne().name);
    } else {
      this.selectedOwner.set(this.service.personOne().name);
    }
  }

  public onBankChange(bankName: string): void {
    this.selectedBank.set(bankName);
    const bank = this.service.bankConfigs().find((b) => b.name === bankName);
    if (bank && bank.defaultOwner) {
      this.selectedOwner.set(bank.defaultOwner);
    }
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
