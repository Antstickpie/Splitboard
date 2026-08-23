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

  public selectedBank = signal<string>('Sparkasse');
  public selectedOwner = signal<string>('');
  public uploadedFileName = signal<string>('');
  public isParsing = signal<boolean>(false);
  public rawClipboardText = '';

  public previewResult = signal<ParsedStatementResult | null>(null);

  constructor() {
    this.selectedOwner.set(this.service.personOne().name);
  }

  public async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.uploadedFileName.set(file.name);
    this.isParsing.set(true);

    try {
      const res = await this.parser.parseFile(file, this.selectedBank(), this.selectedOwner());
      this.previewResult.set(res);
      this.service.showToast(`Parsed ${res.transactions.length} transactions (${res.duplicatesCount} duplicates skipped)`, 'info');
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

    try {
      const res = this.parser.parseText(
        this.rawClipboardText,
        this.selectedBank(),
        this.selectedOwner(),
        'Clipboard Paste'
      );
      this.previewResult.set(res);
      this.service.showToast(`Parsed ${res.transactions.length} transactions from text`, 'info');
    } catch (e: any) {
      this.service.showToast('Error parsing text: ' + e.message, 'error');
    } finally {
      this.isParsing.set(false);
    }
  }

  public async commitImport() {
    const res = this.previewResult();
    if (!res || res.transactions.length === 0) return;

    this.service.addTransactions(res.transactions);
    this.service.showToast(`Successfully imported ${res.transactions.length} transactions!`, 'success');

    if (res.duplicatesCount > 0) {
      await this.service.showAlert(
        'Import Completed',
        `Imported ${res.transactions.length} new transactions.\nSkipped ${res.duplicatesCount} duplicate rows that already existed.`
      );
    }

    this.clearPreview();
  }

  public clearPreview() {
    this.previewResult.set(null);
    this.uploadedFileName.set('');
    this.rawClipboardText = '';
  }
}
