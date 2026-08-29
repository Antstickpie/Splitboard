import { Component, inject, signal, computed, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { StatementParserService, ParsedStatementResult } from '../../services/statement-parser.service';
import { Transaction, SplitType } from '../../models';

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

  @Output() public importCompleted = new EventEmitter<void>();

  public selectedBank = signal<string>('Auto-Detect');
  public selectedOwner = signal<string>('');
  public uploadedFileName = signal<string>('');
  public isParsing = signal<boolean>(false);
  public rawClipboardText = '';

  public previewResult = signal<ParsedStatementResult | null>(null);
  public previewTab = signal<'valid' | 'incomes' | 'duplicates' | 'excluded'>('valid');

  public sortColumn = signal<'date' | 'description' | 'amount' | 'bank' | 'paidBy' | 'categoryItem' | 'original'>('original');
  public sortAsc = signal<boolean>(true);

  // Side-by-Side Live PDF Viewer State
  public isPdfLoaded = signal<boolean>(false);
  public isPdfViewerOpen = signal<boolean>(true);
  public pdfZoom = signal<number>(1.0);
  public pdfPageCount = signal<number>(0);
  public pdfPagesList = signal<number[]>([]);
  public isRenderingPdf = signal<boolean>(false);
  private pdfDocInstance: any = null;
  private pdfArrayBuffer: ArrayBuffer | null = null;

  public sortedTransactions = computed(() => {
    const res = this.previewResult();
    if (!res || !res.transactions) return [];
    const col = this.sortColumn();
    if (col === 'original') {
      return [...res.transactions];
    }
    const asc = this.sortAsc();
    return [...res.transactions].sort((a, b) => {
      let valA: any = a[col] ?? '';
      let valB: any = b[col] ?? '';
      if (col === 'amount') {
        return asc ? (valA - valB) : (valB - valA);
      }
      return asc
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });
  });

  public toggleSort(column: 'date' | 'description' | 'amount' | 'bank' | 'paidBy' | 'categoryItem') {
    if (this.sortColumn() === column) {
      this.sortAsc.set(!this.sortAsc());
    } else {
      this.sortColumn.set(column);
      this.sortAsc.set(column === 'description' || column === 'bank');
    }
  }

  // Quick Rule Creator Modal
  public showRuleModal = signal<boolean>(false);
  public ruleTargetTx = signal<Transaction | null>(null);
  public ruleType = signal<'categorize' | 'exclude'>('categorize');
  public ruleKeyword = '';
  public ruleBank = 'All';
  public ruleCategory = '';
  public ruleSplitType: SplitType = 'SELF';
  public rulePaidBy = '';

  public openRuleModal(tx: Transaction): void {
    this.ruleTargetTx.set(tx);
    this.ruleKeyword = tx.description || '';
    this.ruleBank = tx.bank || 'All';
    this.ruleType.set('categorize');
    this.ruleCategory = tx.categoryItem || '';
    this.ruleSplitType = tx.splitType || 'SELF';
    this.rulePaidBy = tx.paidBy || this.service.personOne().name;
    this.showRuleModal.set(true);
  }

  public closeRuleModal(): void {
    this.showRuleModal.set(false);
    this.ruleTargetTx.set(null);
  }

  public saveRuleFromModal(): void {
    const keyword = this.ruleKeyword.trim();
    if (!keyword) return;

    if (this.ruleType() === 'exclude') {
      this.service.addExcludeRule(this.ruleBank, keyword);
      // Re-evaluate preview: move matching transactions to excluded
      const res = this.previewResult();
      if (res) {
        const lowerKw = keyword.toLowerCase();
        const ruleBank = this.ruleBank.toLowerCase();
        const matches = (t: Transaction) => {
          const tBank = (t.bank || '').toLowerCase();
          const matchesB = ruleBank === 'all' || !tBank || tBank.includes(ruleBank) || ruleBank.includes(tBank);
          return matchesB && (t.description || '').toLowerCase().includes(lowerKw);
        };

        const newlyExcluded = res.transactions.filter(matches);
        if (newlyExcluded.length > 0) {
          const remainingValid = res.transactions.filter((t) => !matches(t));
          this.previewResult.set({
            ...res,
            transactions: remainingValid,
            excluded: [...res.excluded, ...newlyExcluded],
            excludedCount: res.excludedCount + newlyExcluded.length
          });
          this.service.showToast(`Exclude rule applied: moved ${newlyExcluded.length} rows to Excluded tab`, 'info');
        }
      }
    } else {
      let catGroup = '';
      for (const grp of this.service.categoryGroups()) {
        if (grp.items.some((i) => i.name === this.ruleCategory)) {
          catGroup = grp.name;
          break;
        }
      }

      this.service.addRule({
        keyword,
        categoryItem: this.ruleCategory || 'Uncategorized',
        categoryGroup: catGroup,
        splitType: this.ruleSplitType,
        paidBy: this.rulePaidBy,
        bank: this.ruleBank
      });

      // Re-evaluate preview: update matching transactions
      const res = this.previewResult();
      if (res) {
        const lowerKw = keyword.toLowerCase();
        const ruleBank = this.ruleBank.toLowerCase();
        const matches = (t: Transaction) => {
          const tBank = (t.bank || '').toLowerCase();
          const matchesB = ruleBank === 'all' || !tBank || tBank.includes(ruleBank) || ruleBank.includes(tBank);
          return matchesB && (t.description || '').toLowerCase().includes(lowerKw);
        };

        let updatedInPreview = 0;
        const updatedValid = res.transactions.map((t) => {
          if (matches(t)) {
            updatedInPreview++;
            return {
              ...t,
              categoryItem: this.ruleCategory || t.categoryItem,
              categoryGroup: catGroup || t.categoryGroup,
              splitType: this.ruleSplitType,
              paidBy: this.rulePaidBy || t.paidBy
            };
          }
          return t;
        });

        this.previewResult.set({
          ...res,
          transactions: updatedValid
        });
        if (updatedInPreview > 0) {
          this.service.showToast(`Updated ${updatedInPreview} matching rows in preview!`, 'success');
        }
      }
    }

    this.closeRuleModal();
  }

  // Inline Preview Table Editing
  public toggleTxOwner(tx: Transaction): void {
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;
    tx.paidBy = tx.paidBy === p1 ? p2 : p1;
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
  }

  public onRowCategoryChange(tx: Transaction, newCategory: string): void {
    tx.categoryItem = newCategory;
    for (const grp of this.service.categoryGroups()) {
      if (grp.items.some((i) => i.name === newCategory)) {
        tx.categoryGroup = grp.name;
        break;
      }
    }
    if (newCategory.toLowerCase().includes('reimburse')) {
      tx.isReimbursable = true;
      tx.reimbursementStatus = 'PENDING';
      tx.splitType = 'SELF';
    }
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
  }

  public getInlineSplitValue(tx: Transaction): 'SPLIT_5050' | '100_P1' | '100_P2' {
    const p1 = this.service.personOne().name;
    if (tx.splitType === 'SPLIT') return 'SPLIT_5050';
    if (tx.paidBy === p1) {
      return tx.splitType === 'SELF' ? '100_P1' : '100_P2';
    } else {
      return tx.splitType === 'SELF' ? '100_P2' : '100_P1';
    }
  }

  public onInlineSplitButtonClick(tx: Transaction, choice: 'SPLIT_5050' | '100_P1' | '100_P2'): void {
    const p1 = this.service.personOne().name;
    if (choice === 'SPLIT_5050') {
      tx.splitType = 'SPLIT';
    } else if (choice === '100_P1') {
      tx.splitType = tx.paidBy === p1 ? 'SELF' : 'OTHER';
    } else {
      tx.splitType = tx.paidBy === p1 ? 'OTHER' : 'SELF';
    }
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
  }

  public invertPreviewSigns(): void {
    const res = this.previewResult();
    if (!res) return;

    const swappedTransactions = res.incomes.map((t) => ({ ...t, type: 'EXPENSE' as const }));
    const swappedIncomes = res.transactions.map((t) => ({ ...t, type: 'INCOME' as const }));

    this.previewResult.set({
      ...res,
      transactions: swappedTransactions,
      incomes: swappedIncomes,
      incomesCount: swappedIncomes.length
    });

    this.service.showToast(
      `Inverted signs: ${swappedTransactions.length} expenses, ${swappedIncomes.length} incomes/payments`,
      'info'
    );
  }

  constructor() {
    this.selectedBank.set('Auto-Detect');
    this.selectedOwner.set(this.service.personOne().name);
  }

  public onBankChange(bankName: string): void {
    this.selectedBank.set(bankName);
    const res = this.previewResult();
    if (res) {
      res.transactions.forEach((t) => (t.bank = bankName));
      res.incomes.forEach((t) => (t.bank = bankName));
      res.duplicates.forEach((t) => (t.bank = bankName));
      res.excluded.forEach((t) => (t.bank = bankName));
      res.bankName = bankName;
      res.bankMismatch = undefined;
      this.previewResult.set({ ...res });
    }
  }

  public isCustomBank(name: string): boolean {
    if (!name || name === 'Generic Bank' || name === 'Auto-Detect') return false;
    return !this.service.bankConfigs().some((b) => b.name.toLowerCase() === name.toLowerCase());
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
    this.sortColumn.set('original');

    // If PDF, prepare live rendering
    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    if (isPdf) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        this.pdfArrayBuffer = arrayBuffer;
        await this.renderPdfDoc(arrayBuffer);
      } catch (err) {
        console.warn('PDF pre-render notice:', err);
      }
    } else {
      this.isPdfLoaded.set(false);
      this.pdfDocInstance = null;
      this.pdfArrayBuffer = null;
      this.pdfPagesList.set([]);
    }

    try {
      const res = await this.parser.parseFile(file, 'Auto-Detect', this.selectedOwner());
      if (res.bankName) {
        this.selectedBank.set(res.bankName);
      }
      this.previewResult.set(res);
      this.service.showToast(
        `Parsed ${res.transactions.length} expenses (${res.incomesCount} incomes/credits, ${res.duplicatesCount} duplicates, ${res.excludedCount} excluded)`,
        'info'
      );
    } catch (e: any) {
      this.service.showToast('Error parsing file: ' + e.message, 'error');
    } finally {
      this.isParsing.set(false);
      input.value = '';
    }
  }

  public async renderPdfDoc(arrayBuffer: ArrayBuffer): Promise<void> {
    try {
      this.isRenderingPdf.set(true);
      let pdfLib = (window as any).pdfjsLib;
      if (!pdfLib) {
        try {
          pdfLib = await (new Function('return import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs")'))();
          if (pdfLib?.GlobalWorkerOptions && !pdfLib.GlobalWorkerOptions.workerSrc) {
            pdfLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
          }
        } catch {
          // ignore
        }
      }
      if (!pdfLib) return;

      const pdf = await pdfLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
      this.pdfDocInstance = pdf;
      this.pdfPageCount.set(pdf.numPages);
      const pages = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
      this.pdfPagesList.set(pages);
      this.currentPdfPage.set(1);
      this.isPdfLoaded.set(true);
      this.isPdfViewerOpen.set(true);

      setTimeout(() => {
        this.fitPdfWidth();
      }, 100);
    } catch (e) {
      console.warn('PDF document load error:', e);
    } finally {
      this.isRenderingPdf.set(false);
    }
  }

  public currentPdfPage = signal<number>(1);

  public async renderAllPages(): Promise<void> {
    if (!this.pdfDocInstance) return;
    const zoom = this.pdfZoom();
    const dpr = window.devicePixelRatio || 1;

    for (let pageNum = 1; pageNum <= this.pdfDocInstance.numPages; pageNum++) {
      const canvas = document.getElementById('pdf-canvas-' + pageNum) as HTMLCanvasElement;
      if (!canvas) continue;

      try {
        const page = await this.pdfDocInstance.getPage(pageNum);
        const viewport = page.getViewport({ scale: zoom });

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = Math.floor(viewport.width) + 'px';
        canvas.style.height = Math.floor(viewport.height) + 'px';

        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport
        };
        await page.render(renderContext).promise;
      } catch (err) {
        console.warn(`Error rendering page ${pageNum}:`, err);
      }
    }
  }

  public async fitPdfWidth(): Promise<void> {
    if (!this.pdfDocInstance) return;
    try {
      const page = await this.pdfDocInstance.getPage(1);
      const baseViewport = page.getViewport({ scale: 1.0 });
      const scroller = document.querySelector('.pdf-single-page-scrollable') as HTMLElement;
      if (scroller && baseViewport.width > 0) {
        const availableWidth = scroller.clientWidth - 40;
        if (availableWidth > 50) {
          const fitRatio = availableWidth / baseViewport.width;
          const cleanZoom = Math.min(2.0, Math.max(0.3, fitRatio));
          this.pdfZoom.set(Number(cleanZoom.toFixed(2)));
        } else {
          this.pdfZoom.set(0.70);
        }
      } else {
        this.pdfZoom.set(0.70);
      }
    } catch {
      this.pdfZoom.set(0.70);
    }
    this.renderAllPages();
  }

  public onPdfScroll(event: Event): void {
    const scroller = event.target as HTMLElement;
    if (!scroller || this.pdfPageCount() <= 1) return;

    const scrollTop = scroller.scrollTop;
    const cards = Array.from(scroller.querySelectorAll('.pdf-page-card')) as HTMLElement[];
    let activePage = 1;
    let minDistance = Infinity;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const offsetTop = card.offsetTop - scroller.offsetTop;
      const distance = Math.abs(scrollTop - offsetTop);
      if (distance < minDistance) {
        minDistance = distance;
        activePage = i + 1;
      }
    }

    if (this.currentPdfPage() !== activePage) {
      this.currentPdfPage.set(activePage);
    }
  }

  public scrollToPage(pageNum: number): void {
    const targetPage = Math.max(1, Math.min(this.pdfPageCount(), pageNum));
    this.currentPdfPage.set(targetPage);
    const card = document.getElementById('pdf-page-card-' + targetPage);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  public prevPdfPage(): void {
    this.scrollToPage(this.currentPdfPage() - 1);
  }

  public nextPdfPage(): void {
    this.scrollToPage(this.currentPdfPage() + 1);
  }

  public zoomPdf(delta: number): void {
    const newZoom = Math.min(2.5, Math.max(0.3, this.pdfZoom() + delta));
    this.pdfZoom.set(Number(newZoom.toFixed(2)));
    this.renderAllPages();
  }

  public resetPdfZoom(): void {
    this.fitPdfWidth();
  }

  public togglePdfViewer(): void {
    this.isPdfViewerOpen.set(!this.isPdfViewerOpen());
    if (this.isPdfViewerOpen()) {
      setTimeout(() => this.fitPdfWidth(), 100);
    }
  }

  public parseClipboardText() {
    if (!this.rawClipboardText.trim()) return;
    this.isParsing.set(true);
    this.previewTab.set('valid');
    this.sortColumn.set('original');

    try {
      const res = this.parser.parseText(
        this.rawClipboardText,
        'Auto-Detect',
        this.selectedOwner(),
        'Clipboard Paste'
      );
      if (res.bankName) {
        this.selectedBank.set(res.bankName);
      }
      this.previewResult.set(res);
      this.service.showToast(
        `Parsed ${res.transactions.length} expenses (${res.incomesCount} incomes/credits, ${res.duplicatesCount} duplicates, ${res.excludedCount} excluded)`,
        'info'
      );
    } catch (e: any) {
      this.service.showToast('Error parsing text: ' + e.message, 'error');
    } finally {
      this.isParsing.set(false);
    }
  }

  public includeIncome(tx: Transaction): void {
    const res = this.previewResult();
    if (!res) return;
    this.previewResult.set({
      ...res,
      incomes: res.incomes.filter((t) => t.id !== tx.id),
      transactions: [tx, ...res.transactions],
      incomesCount: Math.max(0, res.incomesCount - 1)
    });
    this.service.showToast('Included transaction in import list', 'success');
  }

  public includeAllIncomes(): void {
    const res = this.previewResult();
    if (!res || res.incomes.length === 0) return;
    const count = res.incomes.length;
    this.previewResult.set({
      ...res,
      transactions: [...res.transactions, ...res.incomes],
      incomes: [],
      incomesCount: 0
    });
    this.service.showToast(`Included all ${count} income/payment rows into import list`, 'success');
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
    this.importCompleted.emit();
  }

  public async undoAndReopenBatch(fileName: string): Promise<void> {
    const batchTxns = this.service.transactions().filter((t) => t.sourceFile === fileName);
    if (batchTxns.length === 0) return;

    const ok = await this.service.showConfirm(
      'Re-open Statement for Editing',
      `Re-open ${batchTxns.length} transactions from "${fileName}" into the preview table with all your configured categories and splits?\n\nThey will be staged in the editor so you can review, edit, and click "Import" to save again.`
    );
    if (!ok) return;

    // 1. Temporarily remove from DB ledger so they are ready to be re-saved without duplicating
    this.service.transactions.update((curr) => curr.filter((t) => t.sourceFile !== fileName));

    // 2. Clone transactions back into previewResult with all configured categories & splits intact
    const cloned = batchTxns.map((t) => ({ ...t }));
    const bankName = cloned[0]?.bank || 'Generic Bank';

    this.uploadedFileName.set(fileName);
    this.selectedBank.set(bankName);
    this.previewResult.set({
      transactions: cloned,
      incomes: [],
      duplicates: [],
      excluded: [],
      incomesCount: 0,
      duplicatesCount: 0,
      excludedCount: 0,
      bankName: bankName,
      totalParsed: cloned.length
    });

    this.previewTab.set('valid');
    this.sortColumn.set('original');

    setTimeout(() => {
      document.querySelector('.preview-card')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);

    this.service.showToast(`Loaded ${cloned.length} transactions into editor. Edit and click "Import" to save!`, 'info');
  }

  public viewingBatch = signal<{ fileName: string; count: number; minDate: string; maxDate: string; totalAmount: number } | null>(null);

  public openBatchModal(b: { fileName: string; count: number; minDate: string; maxDate: string; totalAmount: number }): void {
    this.viewingBatch.set(b);
  }

  public closeBatchModal(): void {
    this.viewingBatch.set(null);
  }

  public getBatchTransactions(fileName: string): Transaction[] {
    return this.service.transactions().filter((t) => t.sourceFile === fileName);
  }

  public async editBatchFromModal(fileName: string): Promise<void> {
    this.closeBatchModal();
    await this.undoAndReopenBatch(fileName);
  }

  public async deleteBatchFromModal(fileName: string): Promise<void> {
    this.closeBatchModal();
    await this.service.undoImportBatch(fileName);
  }

  public clearPreview() {
    this.previewResult.set(null);
    this.uploadedFileName.set('');
    this.rawClipboardText = '';
    this.isPdfLoaded.set(false);
    this.pdfDocInstance = null;
    this.pdfArrayBuffer = null;
    this.pdfPagesList.set([]);
  }
}
