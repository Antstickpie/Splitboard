import { Component, inject, signal, computed, HostListener, ElementRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService, ImportedBatch } from '../../services/transaction.service';
import { Transaction, SplitType, SplitMode } from '../../models';
import { ImportComponent } from '../import/import';
import { CategorySelectComponent } from '../category-select/category-select';

export interface MonthCategoryGroup {
  category: string;
  totalAmount: number;
  count: number;
  transactions: Transaction[];
}

export interface MonthOwesItem {
  month: string;
  monthLabel: string;
  totalSpend: number;
  sharedSpend: number;
  p1Paid: number;
  p2Paid: number;
  p1Share: number;
  p2Share: number;
  thisMonthP1OwesP2: number;
  thisMonthP2OwesP1: number;
  thisMonthNetOwed: number;
  thisMonthDebtor: string;
  thisMonthCreditor: string;
  thisMonthIsSettled: boolean;
  cumulativeNetOwed: number;
  cumulativeDebtor: string;
  cumulativeCreditor: string;
  cumulativeIsSettled: boolean;
  transactions: Transaction[];
  filteredTransactions: Transaction[];
  categoryGroups: MonthCategoryGroup[];
}

@Component({
  selector: 'app-ledger',
  standalone: true,
  imports: [CommonModule, FormsModule, ImportComponent, CategorySelectComponent],
  templateUrl: './ledger.html',
  styleUrl: './ledger.css'
})
export class LedgerComponent {
  public service = inject(TransactionService);
  private elementRef = inject(ElementRef);
  public isImportOpen = signal<boolean>(false);
  public pendingImportFile = signal<File | null>(null);
  public isImportDragOver = signal<boolean>(false);

  // Monthly Owes Review & Breakdown Modal
  public isMonthlyOwesModalOpen = signal<boolean>(false);
  public monthlyOwesSelectedMonth = signal<string>('ALL');
  public isMonthlyOwesMonthPickerOpen = signal<boolean>(false);
  public monthlyOwesPickerYear = signal<number>(new Date().getFullYear());
  public monthlyOwesExpandedMonths = signal<Set<string>>(new Set());
  public monthlyOwesSearchQuery = signal<string>('');
  public monthlyOwesBankFilter = signal<string>('ALL');
  public monthlyOwesOwnerFilter = signal<string>('ALL');
  public monthlyOwesSplitFilter = signal<string>('ALL');
  public monthlyOwesCategoryFilter = signal<string>('ALL');
  public monthlyOwesGroupByMode = signal<'table' | 'category'>('table');
  public monthlyOwesSortColumn = signal<'date' | 'bank' | 'paidBy' | 'description' | 'category' | 'amount' | 'split'>('date');
  public monthlyOwesSortDirection = signal<'asc' | 'desc'>('desc');
  public ledgerViewMode = signal<'TRANSACTIONS' | 'MONTHLY_REVIEW'>('TRANSACTIONS');

  // Statement Batches Viewer / Manager Modal
  public isManageBatchesModalOpen = signal<boolean>(false);
  public isBatchesCollapsed = signal<boolean>(true);
  public expandedPeriods = signal<Set<string>>(new Set());
  public expandedOwners = signal<Set<string>>(new Set());
  public viewingBatch = signal<ImportedBatch | null>(null);
  public editStatementBatch(fileName: string): void {
    this.closeBatchModal();
    this.service.batchToEdit.set(fileName);
    this.isImportOpen.set(true);
    this.scrollToImportSection();
  }

  public toggleBatchesCollapsed(): void {
    const next = !this.isBatchesCollapsed();
    this.isBatchesCollapsed.set(next);
    if (!next) {
      setTimeout(() => {
        const el = document.getElementById('imported-statements-section');
        if (el) {
          const topGap = 32;
          const targetY = Math.max(0, el.getBoundingClientRect().top + window.pageYOffset - topGap);
          window.scrollTo({ top: targetY, behavior: 'smooth' });
        }
      }, 50);
    }
  }

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

  public openBatchModal(b: ImportedBatch): void {
    this.viewingBatch.set(b);
  }

  public closeBatchModal(): void {
    this.viewingBatch.set(null);
  }

  public getBatchTransactions(fileName: string): Transaction[] {
    return this.service.transactions().filter((t) => t.sourceFile === fileName);
  }

  public async deleteBatchFromModal(fileName: string): Promise<void> {
    this.closeBatchModal();
    await this.service.undoImportBatch(fileName);
  }

  public scrollToImportSection(): void {
    setTimeout(() => {
      const el = (document.getElementById('inline-import-section') || document.querySelector('app-import')) as HTMLElement | null;
      if (el) {
        const topGap = 32;
        const targetY = Math.max(0, el.getBoundingClientRect().top + window.pageYOffset - topGap);
        window.scrollTo({ top: targetY, behavior: 'smooth' });
      }
    }, 100);
  }

  public toggleImport(): void {
    if (this.isImportOpen()) {
      this.closeImport();
    } else {
      this.isImportOpen.set(true);
      this.scrollToImportSection();
    }
  }

  public onImportButtonClick(input: HTMLInputElement): void {
    if (this.isImportOpen()) {
      this.closeImport();
    } else {
      input.click();
    }
  }

  public onStatementFileChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    this.pendingImportFile.set(file);
    this.isImportOpen.set(true);
    this.scrollToImportSection();
    input.value = '';
  }

  public onImportDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isImportDragOver.set(true);
  }

  public onImportDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isImportDragOver.set(false);
  }

  public onImportFileDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isImportDragOver.set(false);
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      this.pendingImportFile.set(file);
      this.isImportOpen.set(true);
      this.scrollToImportSection();
    }
  }

  public isResumingDraft = signal<boolean>(false);

  public resumeDraftFromLedger(): void {
    this.pendingImportFile.set(null);
    this.isResumingDraft.set(true);
    this.isImportOpen.set(true);
    this.scrollToImportSection();
  }

  public closeImport(): void {
    this.isImportOpen.set(false);
    this.pendingImportFile.set(null);
    this.isResumingDraft.set(false);
    this.service.batchToEdit.set(null);
  }

  public discardDraftFromLedger(event: MouseEvent): void {
    event.stopPropagation();
    this.service.clearImportDraft();
    this.closeImport();
    this.service.showToast('Import draft discarded', 'info');
  }

  public openGoogleRate(from: string, to: string): void {
    const query = encodeURIComponent(`1 ${from} to ${to}`);
    window.open(`https://www.google.com/search?q=${query}`, '_blank');
  }

  public isPastMonth = computed(() => {
    const sm = this.service.selectedMonth();
    return sm !== 'ALL' && sm < this.service.getCurrentMonthString();
  });

  public isFutureMonth = computed(() => {
    const sm = this.service.selectedMonth();
    return sm !== 'ALL' && sm > this.service.getCurrentMonthString();
  });

  @HostListener('document:click', ['$event'])
  public onDocumentClick(event: MouseEvent): void {
    if (this.isMonthPickerOpen()) {
      const container = this.elementRef.nativeElement.querySelector('.everydollar-month-container:not(.monthly-owes-month-container)');
      if (container && !container.contains(event.target as Node)) {
        this.isMonthPickerOpen.set(false);
      }
    }
    if (this.isMonthlyOwesMonthPickerOpen()) {
      const owesContainer = this.elementRef.nativeElement.querySelector('.monthly-owes-month-container');
      if (owesContainer && !owesContainer.contains(event.target as Node)) {
        this.isMonthlyOwesMonthPickerOpen.set(false);
      }
    }
  }

  @HostListener('window:keydown.escape')
  public onEscapeKey(): void {
    if (this.isMonthlyOwesMonthPickerOpen()) {
      this.isMonthlyOwesMonthPickerOpen.set(false);
      return;
    }
    if (this.reimbursingTx()) {
      this.closeReimbursementModal();
      return;
    }
    if (this.editingTx()) {
      this.editingTx.set(null);
      return;
    }
    if (this.activeCustomSplitTx()) {
      this.activeCustomSplitTx.set(null);
      return;
    }
    if (this.isMonthlyOwesModalOpen()) {
      this.closeMonthlyOwesModal();
      return;
    }
    if (this.isCashModalOpen()) {
      this.isCashModalOpen.set(false);
      return;
    }
    if (this.isMonthPickerOpen()) {
      this.isMonthPickerOpen.set(false);
      return;
    }
  }

  // Monthly Owes Review & Breakdown State & Helpers
  public hasMonthlyOwesFilters = computed<boolean>(() => {
    return Boolean(
      this.monthlyOwesSearchQuery().trim() ||
      this.monthlyOwesBankFilter() !== 'ALL' ||
      this.monthlyOwesOwnerFilter() !== 'ALL' ||
      this.monthlyOwesSplitFilter() !== 'ALL' ||
      this.monthlyOwesCategoryFilter() !== 'ALL'
    );
  });

  public monthlyOwesOverallSummary = computed(() => {
    const breakdown = this.monthlyOwesBreakdown();
    let totalAllSpend = 0;
    let totalAllSharedSpend = 0;
    let totalTxs = 0;
    for (const m of breakdown) {
      totalAllSpend += m.totalSpend;
      totalAllSharedSpend += m.sharedSpend;
      totalTxs += m.filteredTransactions.length;
    }
    return {
      monthCount: breakdown.length,
      totalSpend: parseFloat(totalAllSpend.toFixed(2)),
      totalSharedSpend: parseFloat(totalAllSharedSpend.toFixed(2)),
      totalFilteredTxs: totalTxs
    };
  });

  public monthlyOwesBreakdown = computed<MonthOwesItem[]>(() => {
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;
    const allTxs = this.service.transactions();

    // Collect all unique months from transactions
    const monthsSet = new Set<string>();
    for (const tx of allTxs) {
      if (tx.date && tx.date.length >= 7) {
        monthsSet.add(tx.date.slice(0, 7));
      }
    }

    // Sort chronologically ascending (earliest first) to compute running cumulative balances
    const chronologicalMonths = Array.from(monthsSet).sort();

    let cumP1OwesP2 = 0;
    let cumP2OwesP1 = 0;

    const q = this.monthlyOwesSearchQuery().toLowerCase().trim();
    const bank = this.monthlyOwesBankFilter();
    const owner = this.monthlyOwesOwnerFilter();
    const split = this.monthlyOwesSplitFilter();
    const cat = this.monthlyOwesCategoryFilter();
    const sortCol = this.monthlyOwesSortColumn();
    const sortDir = this.monthlyOwesSortDirection() === 'asc' ? 1 : -1;

    const items: MonthOwesItem[] = [];

    for (const m of chronologicalMonths) {
      const monthTxs = allTxs.filter((tx) => tx.date && tx.date.slice(0, 7) === m);

      let p1Paid = 0;
      let p2Paid = 0;
      let p1Share = 0;
      let p2Share = 0;
      let sharedSpend = 0;
      let totalSpend = 0;
      let monthP1OwesP2 = 0;
      let monthP2OwesP1 = 0;

      for (const tx of monthTxs) {
        if (!this.service.edIncludeInSplit() && this.service.isEveryDollarTransaction(tx)) {
          continue;
        }

        const res = this.service.calculateTxDebt(tx, p1, p2);
        p1Paid += res.p1Paid;
        p2Paid += res.p2Paid;
        if (tx.type !== 'INCOME') {
          p1Share += res.p1Share;
          p2Share += res.p2Share;
          sharedSpend += (res.p1Share + res.p2Share);
          totalSpend += (Number(tx.amount) || 0);
        }
        monthP1OwesP2 += res.p1OwesP2;
        monthP2OwesP1 += res.p2OwesP1;
      }

      cumP1OwesP2 += monthP1OwesP2;
      cumP2OwesP1 += monthP2OwesP1;

      const monthDiff = monthP2OwesP1 - monthP1OwesP2;
      const thisMonthNetOwed = parseFloat(Math.abs(monthDiff).toFixed(2));
      let thisMonthDebtor = '';
      let thisMonthCreditor = '';
      if (monthDiff > 0.005) {
        thisMonthDebtor = p2;
        thisMonthCreditor = p1;
      } else if (monthDiff < -0.005) {
        thisMonthDebtor = p1;
        thisMonthCreditor = p2;
      }

      const cumDiff = cumP2OwesP1 - cumP1OwesP2;
      const cumulativeNetOwed = parseFloat(Math.abs(cumDiff).toFixed(2));
      let cumulativeDebtor = '';
      let cumulativeCreditor = '';
      if (cumDiff > 0.005) {
        cumulativeDebtor = p2;
        cumulativeCreditor = p1;
      } else if (cumDiff < -0.005) {
        cumulativeDebtor = p1;
        cumulativeCreditor = p2;
      }

      // Filter transactions for this month
      const filtered = monthTxs.filter((tx) => {
        if (bank !== 'ALL' && tx.bank !== bank) return false;
        if (owner !== 'ALL' && tx.paidBy !== owner) return false;
        if (split !== 'ALL' && tx.splitType !== split) return false;
        if (cat !== 'ALL' && tx.categoryItem !== cat && tx.categoryGroup !== cat) return false;
        if (q) {
          const matchDesc = (tx.description || '').toLowerCase().includes(q);
          const matchBank = (tx.bank || '').toLowerCase().includes(q);
          const matchNote = (tx.note || '').toLowerCase().includes(q);
          const matchCat = (tx.categoryItem || '').toLowerCase().includes(q);
          const matchGrp = (tx.categoryGroup || '').toLowerCase().includes(q);
          const matchOwner = (tx.paidBy || '').toLowerCase().includes(q);
          const matchAmt = String(tx.amount || '').includes(q);
          const matchSplit = (tx.splitType || '').toLowerCase().includes(q);
          if (!matchDesc && !matchBank && !matchNote && !matchCat && !matchGrp && !matchOwner && !matchAmt && !matchSplit) {
            return false;
          }
        }
        return true;
      });

      // Sort filtered transactions
      filtered.sort((a, b) => {
        if (sortCol === 'date') {
          return sortDir * (a.date || '').localeCompare(b.date || '');
        }
        if (sortCol === 'bank') {
          return sortDir * (a.bank || '').localeCompare(b.bank || '');
        }
        if (sortCol === 'paidBy') {
          return sortDir * (a.paidBy || '').localeCompare(b.paidBy || '');
        }
        if (sortCol === 'description') {
          return sortDir * (a.description || '').localeCompare(b.description || '');
        }
        if (sortCol === 'category') {
          const aCat = a.categoryItem || a.categoryGroup || '';
          const bCat = b.categoryItem || b.categoryGroup || '';
          return sortDir * aCat.localeCompare(bCat);
        }
        if (sortCol === 'amount') {
          return sortDir * ((Number(a.amount) || 0) - (Number(b.amount) || 0));
        }
        if (sortCol === 'split') {
          return sortDir * (a.splitType || '').localeCompare(b.splitType || '');
        }
        return 0;
      });

      // Build Category Groups
      const catMap = new Map<string, Transaction[]>();
      for (const tx of filtered) {
        const c = tx.categoryItem || tx.categoryGroup || 'Uncategorized';
        if (!catMap.has(c)) {
          catMap.set(c, []);
        }
        catMap.get(c)!.push(tx);
      }

      const categoryGroups: MonthCategoryGroup[] = Array.from(catMap.entries()).map(([category, txs]) => {
        const total = txs.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
        return {
          category,
          totalAmount: parseFloat(total.toFixed(2)),
          count: txs.length,
          transactions: txs
        };
      }).sort((a, b) => b.totalAmount - a.totalAmount);

      items.push({
        month: m,
        monthLabel: this.service.formatMonth(m),
        totalSpend: parseFloat(totalSpend.toFixed(2)),
        sharedSpend: parseFloat(sharedSpend.toFixed(2)),
        p1Paid: parseFloat(p1Paid.toFixed(2)),
        p2Paid: parseFloat(p2Paid.toFixed(2)),
        p1Share: parseFloat(p1Share.toFixed(2)),
        p2Share: parseFloat(p2Share.toFixed(2)),
        thisMonthP1OwesP2: parseFloat(monthP1OwesP2.toFixed(2)),
        thisMonthP2OwesP1: parseFloat(monthP2OwesP1.toFixed(2)),
        thisMonthNetOwed,
        thisMonthDebtor,
        thisMonthCreditor,
        thisMonthIsSettled: thisMonthNetOwed <= 0.005,
        cumulativeNetOwed,
        cumulativeDebtor,
        cumulativeCreditor,
        cumulativeIsSettled: cumulativeNetOwed <= 0.005,
        transactions: monthTxs,
        filteredTransactions: filtered,
        categoryGroups
      });
    }

    // Return in reverse chronological order (newest month first)
    const result = items.reverse();

    // If a specific month is selected in the modal, filter down to that month
    const selMonth = this.monthlyOwesSelectedMonth();
    let displayList = result;
    if (selMonth !== 'ALL') {
      displayList = displayList.filter((m) => m.month === selMonth);
    }

    const hasFilter = Boolean(q || bank !== 'ALL' || owner !== 'ALL' || split !== 'ALL' || cat !== 'ALL');
    if (hasFilter) {
      return displayList.filter((m) => m.filteredTransactions.length > 0);
    }

    return displayList;
  });

  public openMonthlyOwesModal(): void {
    this.isMonthlyOwesModalOpen.set(true);
    const curMonth = this.service.selectedMonth();
    if (curMonth && curMonth !== 'ALL') {
      this.monthlyOwesSelectedMonth.set(curMonth);
      this.monthlyOwesPickerYear.set(parseInt(curMonth.slice(0, 4), 10));
      this.monthlyOwesExpandedMonths.set(new Set([curMonth]));
    } else {
      this.monthlyOwesSelectedMonth.set('ALL');
      const breakdown = this.monthlyOwesBreakdown();
      if (breakdown.length > 0 && this.monthlyOwesExpandedMonths().size === 0) {
        this.monthlyOwesExpandedMonths.set(new Set([breakdown[0].month]));
      }
    }
  }

  public closeMonthlyOwesModal(): void {
    this.isMonthlyOwesModalOpen.set(false);
    this.isMonthlyOwesMonthPickerOpen.set(false);
  }

  public getMonthlyOwesDateRangeLabel(): string {
    if (this.monthlyOwesSelectedMonth() === 'ALL') return 'All Time';
    return this.service.formatMonth(this.monthlyOwesSelectedMonth());
  }

  public toggleMonthlyOwesMonthPicker(): void {
    this.isMonthlyOwesMonthPickerOpen.set(!this.isMonthlyOwesMonthPickerOpen());
  }

  public selectMonthlyOwesMonth(monthIdx: number): void {
    const mStr = `${this.monthlyOwesPickerYear()}-${String(monthIdx + 1).padStart(2, '0')}`;
    this.monthlyOwesSelectedMonth.set(mStr);
    this.isMonthlyOwesMonthPickerOpen.set(false);
    this.monthlyOwesExpandedMonths.update((s) => new Set([...s, mStr]));
  }

  public selectMonthlyOwesAllTime(): void {
    this.monthlyOwesSelectedMonth.set('ALL');
    this.isMonthlyOwesMonthPickerOpen.set(false);
  }

  public isMonthlyOwesMonthSelected(monthIdx: number): boolean {
    if (this.monthlyOwesSelectedMonth() === 'ALL') return false;
    const mStr = `${this.monthlyOwesPickerYear()}-${String(monthIdx + 1).padStart(2, '0')}`;
    return this.monthlyOwesSelectedMonth() === mStr;
  }

  public hasMonthlyOwesMonthData(monthIdx: number): boolean {
    const mStr = `${this.monthlyOwesPickerYear()}-${String(monthIdx + 1).padStart(2, '0')}`;
    return this.service.transactions().some((t) => t.date && t.date.startsWith(mStr));
  }

  public monthlyOwesPrevYear(): void {
    this.monthlyOwesPickerYear.update((y) => y - 1);
  }

  public monthlyOwesNextYear(): void {
    this.monthlyOwesPickerYear.update((y) => y + 1);
  }

  public monthlyOwesPrevMonth(): void {
    const curr = this.monthlyOwesSelectedMonth() === 'ALL' ? this.service.getCurrentMonthString() : this.monthlyOwesSelectedMonth();
    const [y, m] = curr.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    const newY = d.getFullYear();
    const newM = String(d.getMonth() + 1).padStart(2, '0');
    const target = `${newY}-${newM}`;
    this.monthlyOwesSelectedMonth.set(target);
    this.monthlyOwesPickerYear.set(newY);
    this.monthlyOwesExpandedMonths.update((s) => new Set([...s, target]));
  }

  public monthlyOwesNextMonth(): void {
    const curr = this.monthlyOwesSelectedMonth() === 'ALL' ? this.service.getCurrentMonthString() : this.monthlyOwesSelectedMonth();
    const [y, m] = curr.split('-').map(Number);
    const d = new Date(y, m, 1);
    const newY = d.getFullYear();
    const newM = String(d.getMonth() + 1).padStart(2, '0');
    const target = `${newY}-${newM}`;
    this.monthlyOwesSelectedMonth.set(target);
    this.monthlyOwesPickerYear.set(newY);
    this.monthlyOwesExpandedMonths.update((s) => new Set([...s, target]));
  }

  public goToMonthlyOwesCurrentMonth(): void {
    const cur = this.service.getCurrentMonthString();
    this.monthlyOwesSelectedMonth.set(cur);
    this.monthlyOwesPickerYear.set(parseInt(cur.slice(0, 4), 10));
    this.isMonthlyOwesMonthPickerOpen.set(false);
    this.monthlyOwesExpandedMonths.update((s) => new Set([...s, cur]));
  }

  public toggleMonthlyMonthExpanded(month: string): void {
    this.monthlyOwesExpandedMonths.update((set) => {
      const next = new Set(set);
      if (next.has(month)) {
        next.delete(month);
      } else {
        next.add(month);
      }
      return next;
    });
  }

  public isMonthlyMonthExpanded(month: string): boolean {
    return this.monthlyOwesExpandedMonths().has(month);
  }

  public areAllMonthlyOwesExpanded(): boolean {
    const list = this.monthlyOwesBreakdown();
    if (list.length === 0) return false;
    const currentSet = this.monthlyOwesExpandedMonths();
    return list.every((m) => currentSet.has(m.month));
  }

  public toggleAllMonthlyOwesExpanded(): void {
    const list = this.monthlyOwesBreakdown();
    if (this.areAllMonthlyOwesExpanded()) {
      this.monthlyOwesExpandedMonths.set(new Set());
    } else {
      this.monthlyOwesExpandedMonths.set(new Set(list.map((m) => m.month)));
    }
  }

  public toggleMonthlyOwesGroupByMode(): void {
    this.monthlyOwesGroupByMode.set(this.monthlyOwesGroupByMode() === 'category' ? 'table' : 'category');
  }

  public setMonthlyOwesSort(column: 'date' | 'bank' | 'paidBy' | 'description' | 'category' | 'amount' | 'split'): void {
    if (this.monthlyOwesSortColumn() === column) {
      this.monthlyOwesSortDirection.set(this.monthlyOwesSortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.monthlyOwesSortColumn.set(column);
      this.monthlyOwesSortDirection.set(column === 'amount' || column === 'date' ? 'desc' : 'asc');
    }
  }

  public toggleMonthlyReviewView(): void {
    if (this.ledgerViewMode() === 'MONTHLY_REVIEW') {
      this.ledgerViewMode.set('TRANSACTIONS');
    } else {
      this.ledgerViewMode.set('MONTHLY_REVIEW');
      const curMonth = this.service.selectedMonth();
      if (curMonth && curMonth !== 'ALL') {
        this.monthlyOwesSelectedMonth.set(curMonth);
        this.monthlyOwesPickerYear.set(parseInt(curMonth.slice(0, 4), 10));
        this.monthlyOwesExpandedMonths.set(new Set([curMonth]));
      }
      setTimeout(() => {
        const el = document.getElementById('ledger-table-section');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 50);
    }
  }

  public resetMonthlyOwesFilters(): void {
    this.monthlyOwesSearchQuery.set('');
    this.monthlyOwesBankFilter.set('ALL');
    this.monthlyOwesOwnerFilter.set('ALL');
    this.monthlyOwesSplitFilter.set('ALL');
    this.monthlyOwesCategoryFilter.set('ALL');
  }

  public getTxSplitShares(tx: Transaction): { p1Share: number; p2Share: number } {
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;
    const res = this.service.calculateTxDebt(tx, p1, p2);
    return { p1Share: res.p1Share, p2Share: res.p2Share };
  }

  // Settlement breakdown drawer toggle
  public isSettlementExpanded = signal(false);

  // Quick filters collapsible
  public isFiltersOpen = signal(true);
  public hasActiveFilters = computed(() => {
    return (
      this.service.filterOwner() !== 'ALL' ||
      this.service.filterBank() !== 'ALL' ||
      this.service.filterSplitType() !== 'ALL' ||
      this.service.filterCategory() !== 'ALL' ||
      this.service.filterStatus() !== 'ALL'
    );
  });

  public totalMonthTxs = computed(() => {
    return this.service.transactions().filter(
      (tx) => this.service.isTransactionInActiveRange(tx)
    ).length;
  });

  public resetFilters(): void {
    this.service.filterOwner.set('ALL');
    this.service.filterBank.set('ALL');
    this.service.filterSplitType.set('ALL');
    this.service.filterCategory.set('ALL');
    this.service.filterStatus.set('ALL');
    this.service.searchQuery.set('');
  }

  public async recordSettlement(): Promise<void> {
    const s = this.service.monthSettlement();
    if (s.isSettled || s.netOwedAmount <= 0) return;

    const month = this.service.selectedMonth() === 'ALL' ? this.service.getCurrentMonthString() : this.service.selectedMonth();
    const date = `${month}-28`;

    const ok = await this.service.showConfirm(
      'Confirm Settle Up',
      `Record settlement of ${this.service.formatCurrency(s.netOwedAmount)} from ${s.debtorName} to ${s.creditorName} for ${this.service.formatMonth(month)}?\n\nThis will record a transfer transaction balancing accounts to ${this.service.formatCurrency(0)}.`
    );
    if (!ok) return;

    this.service.addTransaction({
      id: crypto.randomUUID(),
      date,
      amount: s.netOwedAmount,
      description: `Settlement: ${s.debtorName} paid ${s.creditorName}`,
      paidBy: s.debtorName,
      bank: 'Cash',
      splitType: 'SELF',
      isCashTransfer: true,
      transferTo: s.creditorName,
      type: 'EXPENSE'
    });

    this.service.showToast(`Settlement of ${this.service.formatCurrency(s.netOwedAmount)} recorded!`, 'success');
  }

  // Quick Cash / Transfer / Income modal
  public isCashModalOpen = signal(false);
  public cashDate = new Date().toISOString().slice(0, 10);
  public cashAmount = 0;
  public cashDescription = '';
  public cashPaidBy = '';
  public cashTxType: 'EXPENSE' | 'INCOME' | 'TRANSFER' = 'EXPENSE';
  public cashIsTransfer = false;
  public cashTransferTo = '';
  public cashCategoryGroup = 'Housing';
  public cashCategoryItem = '';
  public cashCurrency = 'EUR';
  public cashSplitOption: 'PAYER_ONLY' | 'OTHER_ONLY' | 'SPLIT_5050' | 'CUSTOM' = 'SPLIT_5050';
  public cashSplitMode: SplitMode = 'PERCENTAGE';
  public cashCustomP1Amount = 0;
  public cashCustomP2Amount = 0;
  public cashCustomPercentage = 50;
  public cashIncomeMonth = '';

  // Edit Transaction Modal State
  public editingTx = signal<Transaction | null>(null);
  public editDate = '';
  public editAmount = 0;
  public editDescription = '';
  public editPaidBy = '';
  public editCategoryItem = '';
  public editCategoryGroup = '';
  public editSplitOption: 'PAYER_ONLY' | 'OTHER_ONLY' | 'SPLIT_5050' | 'CUSTOM' = 'SPLIT_5050';
  public editSplitMode: SplitMode = 'PERCENTAGE';
  public editCustomP1Amount = 0;
  public editCustomP2Amount = 0;
  public editCustomPercentage = 50;
  public editNote = '';
  public editIncomeMonth = '';

  // Split customization modal
  public activeCustomSplitTx = signal<Transaction | null>(null);
  public customSplitP1Amount = 0;
  public customSplitP2Amount = 0;
  public customSplitPercentage = 50;

  // EveryDollar Month / Year / Date Range Picker Popover State
  public isMonthPickerOpen = signal<boolean>(false);
  public pickerTab = signal<'MONTH' | 'YEAR' | 'RANGE'>('MONTH');
  public pickerYear = signal<number>(new Date().getFullYear());
  public customRangeStart = signal<string>('');
  public customRangeEnd = signal<string>('');
  public monthsList = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  constructor() {
    this.cashPaidBy = this.service.personOne().name;
    this.cashTransferTo = this.service.personTwo().name;
    this.cashCurrency = this.service.currency();
    effect(() => {
      const batch = this.service.batchToEdit();
      if (batch) {
        this.isImportOpen.set(true);
        this.scrollToImportSection();
      }
    });
  }

  public getOtherPersonName(paidBy?: string): string {
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;
    const current = paidBy || this.cashPaidBy;
    return current === p1 ? p2 : p1;
  }

  public onCashAmountChange() {
    if (this.cashSplitMode === 'PERCENTAGE') {
      this.cashCustomP1Amount = parseFloat(((this.cashAmount * this.cashCustomPercentage) / 100).toFixed(2));
      this.cashCustomP2Amount = parseFloat((this.cashAmount - this.cashCustomP1Amount).toFixed(2));
    } else {
      const half = parseFloat((this.cashAmount / 2).toFixed(2));
      this.cashCustomP1Amount = half;
      this.cashCustomP2Amount = parseFloat((this.cashAmount - half).toFixed(2));
    }
  }

  public setCashSplitOption(opt: 'PAYER_ONLY' | 'OTHER_ONLY' | 'SPLIT_5050' | 'CUSTOM') {
    this.cashSplitOption = opt;
    if (opt === 'CUSTOM') {
      this.onCashAmountChange();
    }
  }

  public setCashCustomPercentage(pct: number) {
    this.cashCustomPercentage = pct;
    this.cashCustomP1Amount = parseFloat(((this.cashAmount * pct) / 100).toFixed(2));
    this.cashCustomP2Amount = parseFloat((this.cashAmount - this.cashCustomP1Amount).toFixed(2));
  }

  public onCashP1AmountChange(val: number) {
    this.cashCustomP1Amount = val;
    this.cashCustomP2Amount = Math.max(0, parseFloat((this.cashAmount - val).toFixed(2)));
  }

  public onCashP2AmountChange(val: number) {
    this.cashCustomP2Amount = val;
    this.cashCustomP1Amount = Math.max(0, parseFloat((this.cashAmount - val).toFixed(2)));
  }

  public onCashTxTypeChange(type: 'EXPENSE' | 'INCOME' | 'TRANSFER') {
    this.cashTxType = type;
    this.cashIsTransfer = type === 'TRANSFER';
    if (type === 'INCOME') {
      this.cashCategoryGroup = 'Income & Inflows';
      this.cashCategoryItem = 'Salary';
      this.cashSplitOption = 'PAYER_ONLY';
      if (!this.cashDescription || this.cashDescription === 'Cash Expense') {
        this.cashDescription = 'Salary';
      }
    } else if (type === 'EXPENSE') {
      if (this.cashCategoryGroup === 'Income & Inflows') {
        this.cashCategoryGroup = 'Food';
        this.cashCategoryItem = 'Dining Out and Food Chill';
      }
      if (this.cashDescription === 'Salary') {
        this.cashDescription = '';
      }
    }
  }

  public openCashModal() {
    const selMonth = this.service.selectedMonth();
    if (selMonth && selMonth !== 'ALL' && /^\d{4}-\d{2}$/.test(selMonth)) {
      const today = new Date().toISOString().slice(0, 10);
      if (today.startsWith(selMonth)) {
        this.cashDate = today;
      } else {
        this.cashDate = `${selMonth}-01`;
      }
    } else {
      this.cashDate = new Date().toISOString().slice(0, 10);
    }
    this.cashAmount = 0;
    this.cashCurrency = this.service.currency();
    this.cashDescription = '';
    this.cashPaidBy = this.service.personOne().name;
    this.cashTransferTo = this.service.personTwo().name;
    this.cashTxType = 'EXPENSE';
    this.cashIsTransfer = false;
    this.cashCategoryGroup = 'Food';
    this.cashCategoryItem = 'Dining Out and Food Chill';
    this.cashSplitOption = 'SPLIT_5050';
    this.cashSplitMode = 'PERCENTAGE';
    this.cashCustomPercentage = 50;
    this.cashCustomP1Amount = 0;
    this.cashCustomP2Amount = 0;
    this.cashIncomeMonth = this.cashDate.slice(0, 7);
    this.isCashModalOpen.set(true);
  }

  public saveCashSpend() {
    if (this.cashAmount <= 0) {
      this.service.showToast('Please enter a valid amount', 'error');
      return;
    }

    const baseCurrency = this.service.currency();
    let finalAmount = this.cashAmount;
    let originalAmount: number | undefined = undefined;
    let originalCurrency: string | undefined = undefined;
    let rate: number | undefined = undefined;

    if (this.cashCurrency !== baseCurrency) {
      finalAmount = this.service.convertAmount(this.cashAmount, this.cashCurrency, baseCurrency);
      originalAmount = this.cashAmount;
      originalCurrency = this.cashCurrency;
      rate = this.service.getExchangeRate(this.cashCurrency, baseCurrency);
    }

    const isIncome = this.cashTxType === 'INCOME';
    let splitType: SplitType = 'SPLIT';
    let splitMode: SplitMode = 'PERCENTAGE';
    let splitPercentage = 50;
    let customSplitAmounts: Record<string, number> | undefined = undefined;

    if (this.cashIsTransfer) {
      splitType = 'OTHER';
    } else if (this.cashSplitOption === 'PAYER_ONLY') {
      splitType = 'SELF';
    } else if (this.cashSplitOption === 'OTHER_ONLY') {
      splitType = 'OTHER';
    } else if (this.cashSplitOption === 'SPLIT_5050') {
      splitType = 'SPLIT';
      splitPercentage = 50;
      splitMode = 'PERCENTAGE';
    } else if (this.cashSplitOption === 'CUSTOM') {
      splitType = 'SPLIT';
      splitMode = this.cashSplitMode;
      if (this.cashSplitMode === 'EXACT') {
        const p1 = this.service.personOne().name;
        const p2 = this.service.personTwo().name;
        const finalP1 = this.cashCurrency !== baseCurrency 
          ? this.service.convertAmount(this.cashCustomP1Amount, this.cashCurrency, baseCurrency) 
          : this.cashCustomP1Amount;
        const finalP2 = this.cashCurrency !== baseCurrency 
          ? this.service.convertAmount(this.cashCustomP2Amount, this.cashCurrency, baseCurrency) 
          : this.cashCustomP2Amount;
        customSplitAmounts = { [p1]: finalP1, [p2]: finalP2 };
      } else {
        splitPercentage = this.cashCustomPercentage;
      }
    }

    let categoryGroup = this.cashCategoryGroup;
    if (this.cashCategoryItem) {
      const existingGrp = this.service.categoryGroups().find((g) => g.name === categoryGroup);
      if (!existingGrp || !existingGrp.items.some((it) => it.name === this.cashCategoryItem)) {
        const found = this.service.categoryGroups().find((g) => g.items.some((it) => it.name === this.cashCategoryItem));
        if (found) categoryGroup = found.name;
      }
    }

    const receiptMonth = (this.cashDate || '').slice(0, 7);
    const assignedIncomeMonth = isIncome && this.cashIncomeMonth && this.cashIncomeMonth !== receiptMonth
      ? this.cashIncomeMonth
      : undefined;

    const tx: Transaction = {
      id: 'cash-' + Date.now(),
      date: this.cashDate,
      bank: 'Cash',
      account: isIncome ? 'Income' : 'Cash Wallet',
      description: this.cashDescription.trim() || (isIncome ? 'Salary / Income' : (this.cashIsTransfer ? `Transfer to ${this.cashTransferTo}` : 'Cash Expense')),
      amount: finalAmount,
      type: isIncome ? 'INCOME' : 'EXPENSE',
      paidBy: this.cashPaidBy,
      isCash: true,
      isCashTransfer: this.cashIsTransfer,
      transferTo: this.cashIsTransfer ? this.cashTransferTo : undefined,
      categoryGroup: categoryGroup || (isIncome ? 'Income & Inflows' : undefined),
      categoryItem: this.cashCategoryItem || (isIncome ? 'Salary' : undefined),
      splitType,
      splitMode,
      splitPercentage,
      customSplitAmounts,
      currency: this.cashCurrency,
      originalAmount,
      originalCurrency,
      exchangeRate: rate,
      incomeMonth: assignedIncomeMonth,
      createdAt: new Date().toISOString()
    };

    this.service.addTransaction(tx);
    this.isCashModalOpen.set(false);
    this.service.showToast(isIncome ? 'Income logged successfully' : 'Entry logged successfully', 'success');
  }

  public getEffectiveDateRangeLabel(): string {
    const mode = this.service.dateFilterMode();
    if (mode === 'ALL') return 'All Time';
    if (mode === 'MONTH') {
      return this.service.selectedMonth() === 'ALL'
        ? 'All Months'
        : this.service.formatMonth(this.service.selectedMonth());
    }
    if (mode === 'YEAR') {
      return `Full Year ${this.service.selectedYear()}`;
    }
    if (mode === 'RANGE') {
      const s = this.service.dateRangeStart();
      const e = this.service.dateRangeEnd();
      if (s && e) return `${s} → ${e}`;
      if (s) return `From ${s}`;
      if (e) return `Until ${e}`;
      return 'Custom Range';
    }
    return 'All Time';
  }

  public toggleMonthPicker(): void {
    const curr = this.service.selectedMonth();
    if (curr !== 'ALL') {
      const [y] = curr.split('-').map(Number);
      if (!isNaN(y)) this.pickerYear.set(y);
    } else {
      this.pickerYear.set(new Date().getFullYear());
    }
    this.isMonthPickerOpen.update((v) => !v);
  }

  public prevYear(): void {
    this.pickerYear.update((y) => y - 1);
  }

  public nextYear(): void {
    this.pickerYear.update((y) => y + 1);
  }

  public selectMonth(monthIdx: number): void {
    const mStr = `${this.pickerYear()}-${String(monthIdx + 1).padStart(2, '0')}`;
    this.service.dateFilterMode.set('MONTH');
    this.service.selectedMonth.set(mStr);
    this.isMonthPickerOpen.set(false);
  }

  public selectYearFilter(year: string): void {
    this.service.dateFilterMode.set('YEAR');
    this.service.selectedYear.set(year);
    this.isMonthPickerOpen.set(false);
  }

  public applyCustomRange(startVal?: string, endVal?: string): void {
    const s = startVal !== undefined ? startVal : this.customRangeStart();
    const e = endVal !== undefined ? endVal : this.customRangeEnd();
    this.service.dateRangeStart.set(s);
    this.service.dateRangeEnd.set(e);
    this.service.dateFilterMode.set('RANGE');
    this.isMonthPickerOpen.set(false);
  }

  public applyPresetRange(preset: 'L12M' | 'L2Y' | 'YTD' | 'ALL'): void {
    const d = new Date();
    const todayStr = d.toISOString().slice(0, 10);
    if (preset === 'ALL') {
      this.showAllMonths();
      return;
    }
    if (preset === 'YTD') {
      const start = `${d.getFullYear()}-01-01`;
      this.customRangeStart.set(start);
      this.customRangeEnd.set(todayStr);
      this.applyCustomRange(start, todayStr);
    } else if (preset === 'L12M') {
      const past = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate());
      const start = past.toISOString().slice(0, 10);
      this.customRangeStart.set(start);
      this.customRangeEnd.set(todayStr);
      this.applyCustomRange(start, todayStr);
    } else if (preset === 'L2Y') {
      const past = new Date(d.getFullYear() - 2, d.getMonth(), d.getDate());
      const start = past.toISOString().slice(0, 10);
      this.customRangeStart.set(start);
      this.customRangeEnd.set(todayStr);
      this.applyCustomRange(start, todayStr);
    }
  }

  public showAllMonths(): void {
    this.service.resetAllTimeToInitial();
    this.service.dateFilterMode.set('ALL');
    this.service.selectedMonth.set('ALL');
    this.isMonthPickerOpen.set(false);
  }

  public goToCurrentMonth(): void {
    const today = this.service.getCurrentMonthString();
    this.service.dateFilterMode.set('MONTH');
    this.service.selectedMonth.set(today);
    this.pickerYear.set(new Date().getFullYear());
    this.isMonthPickerOpen.set(false);
  }

  public isMonthSelected(monthIdx: number): boolean {
    if (this.service.dateFilterMode() !== 'MONTH') return false;
    const mStr = `${this.pickerYear()}-${String(monthIdx + 1).padStart(2, '0')}`;
    return this.service.selectedMonth() === mStr;
  }

  public hasMonthData(monthIdx: number): boolean {
    const mStr = `${this.pickerYear()}-${String(monthIdx + 1).padStart(2, '0')}`;
    return this.service.transactions().some((t) => t.date && t.date.startsWith(mStr));
  }

  public prevMonth(): void {
    this.service.dateFilterMode.set('MONTH');
    const curr = this.service.selectedMonth() === 'ALL' ? this.service.getCurrentMonthString() : this.service.selectedMonth();
    const [y, m] = curr.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    const newY = d.getFullYear();
    const newM = String(d.getMonth() + 1).padStart(2, '0');
    this.service.selectedMonth.set(`${newY}-${newM}`);
  }

  public nextMonth(): void {
    this.service.dateFilterMode.set('MONTH');
    const curr = this.service.selectedMonth() === 'ALL' ? this.service.getCurrentMonthString() : this.service.selectedMonth();
    const [y, m] = curr.split('-').map(Number);
    const d = new Date(y, m, 1);
    const newY = d.getFullYear();
    const newM = String(d.getMonth() + 1).padStart(2, '0');
    this.service.selectedMonth.set(`${newY}-${newM}`);
  }



  public getSplitBadgeText(tx: Transaction): string {
    if (tx.isCashTransfer) {
      return `Transfer → ${tx.transferTo || this.getOtherPersonName(tx.paidBy)}`;
    }
    if (tx.splitType === 'SELF') {
      return `100% ${tx.paidBy}`;
    }
    if (tx.splitType === 'OTHER') {
      return `100% ${this.getOtherPersonName(tx.paidBy)}`;
    }
    if (tx.splitType === 'SPLIT') {
      if (tx.splitMode === 'EXACT' && tx.customSplitAmounts) {
        const p1 = this.service.personOne().name;
        const p2 = this.service.personTwo().name;
        const a1 = tx.customSplitAmounts[p1] || 0;
        const a2 = tx.customSplitAmounts[p2] || 0;
        return `Custom (${this.service.formatCurrency(a1)} / ${this.service.formatCurrency(a2)})`;
      }
      const pct = tx.splitPercentage !== undefined ? tx.splitPercentage : 50;
      if (pct === 50) return 'Split 50/50';
      return `Split ${pct}% / ${100 - pct}%`;
    }
    return '100% ' + tx.paidBy;
  }

  public getInlineSplitValue(tx: Transaction): string {
    if (tx.isCashTransfer) return 'TRANSFER';
    if (tx.splitType === 'SPLIT') {
      if (tx.splitMode === 'EXACT' || (tx.splitPercentage !== undefined && tx.splitPercentage !== 50)) {
        return 'CUSTOM';
      }
      return 'SPLIT_5050';
    }
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;
    if (tx.splitType === 'SELF') {
      return tx.paidBy === p1 ? '100_P1' : '100_P2';
    }
    if (tx.splitType === 'OTHER') {
      return tx.paidBy === p1 ? '100_P2' : '100_P1';
    }
    return 'SPLIT_5050';
  }

  public onInlineSplitChange(tx: Transaction, value: string): void {
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;

    if (value === 'SPLIT_5050') {
      this.service.updateTransaction(tx.id, {
        splitType: 'SPLIT',
        splitMode: 'PERCENTAGE',
        splitPercentage: 50,
        customSplitAmounts: undefined
      });
      this.service.showToast('Split updated to 50/50', 'success');
    } else if (value === '100_P1') {
      const splitType: SplitType = tx.paidBy === p1 ? 'SELF' : 'OTHER';
      this.service.updateTransaction(tx.id, {
        splitType,
        splitMode: 'PERCENTAGE',
        splitPercentage: tx.paidBy === p1 ? 100 : 0,
        customSplitAmounts: undefined
      });
      this.service.showToast(`Allocated 100% to ${p1}`, 'success');
    } else if (value === '100_P2') {
      const splitType: SplitType = tx.paidBy === p2 ? 'SELF' : 'OTHER';
      this.service.updateTransaction(tx.id, {
        splitType,
        splitMode: 'PERCENTAGE',
        splitPercentage: tx.paidBy === p2 ? 100 : 0,
        customSplitAmounts: undefined
      });
      this.service.showToast(`Allocated 100% to ${p2}`, 'success');
    } else if (value === 'CUSTOM') {
      this.openEditTxModal(tx);
    }
  }

  public onInlineCategoryChange(tx: Transaction, itemCategoryName: string, groupName?: string): void {
    if (!itemCategoryName) {
      this.service.updateTransaction(tx.id, {
        categoryGroup: undefined,
        categoryItem: undefined
      });
      return;
    }

    let parentGroupName: string | undefined = groupName;
    if (!parentGroupName) {
      const existingGrp = this.service.categoryGroups().find((g) => g.name === tx.categoryGroup);
      if (existingGrp && existingGrp.items.some((i) => i.name === itemCategoryName)) {
        parentGroupName = existingGrp.name;
      } else {
        for (const grp of this.service.categoryGroups()) {
          if (grp.items.some((i) => i.name === itemCategoryName)) {
            parentGroupName = grp.name;
            break;
          }
        }
      }
    }

    const isIncomeGroup = (parentGroupName || '').toLowerCase().includes('income');
    const isReimbCategory = itemCategoryName.toLowerCase().includes('reimburse');
    this.service.updateTransaction(tx.id, {
      type: isIncomeGroup ? 'INCOME' : (tx.type === 'INCOME' ? 'EXPENSE' : tx.type),
      categoryGroup: parentGroupName || tx.categoryGroup,
      categoryItem: itemCategoryName,
      isReimbursable: isReimbCategory ? true : tx.isReimbursable,
      reimbursementStatus: isReimbCategory ? (tx.reimbursementStatus || 'PENDING') : tx.reimbursementStatus
    });
    this.service.showToast(`Category updated to "${itemCategoryName}"`, 'success');
  }

  // Reimbursement Tracking Modal & Actions
  public reimbursingTx = signal<Transaction | null>(null);
  public reimburseStatus: 'PENDING' | 'REIMBURSED' = 'PENDING';
  public reimburseCollectedBy = '';
  public reimburseNote = '';

  public openReimbursementModal(tx: Transaction): void {
    this.reimbursingTx.set(tx);
    this.reimburseStatus = tx.reimbursementStatus || 'PENDING';
    this.reimburseCollectedBy = tx.reimbursedTo || tx.paidBy || this.service.personOne().name;
    this.reimburseNote = tx.reimbursementNote || '';
  }

  public closeReimbursementModal(): void {
    this.reimbursingTx.set(null);
  }

  public saveReimbursement(): void {
    const tx = this.reimbursingTx();
    if (!tx) return;

    this.service.updateTransaction(tx.id, {
      isReimbursable: true,
      reimbursementStatus: this.reimburseStatus,
      reimbursedTo: this.reimburseStatus === 'REIMBURSED' ? this.reimburseCollectedBy : undefined,
      reimbursementNote: this.reimburseNote.trim() || undefined
    });

    this.closeReimbursementModal();
    if (this.reimburseStatus === 'REIMBURSED') {
      this.service.showToast('Reimbursement settled! Budget expense cleared.', 'success');
    } else {
      this.service.showToast('Marked as pending reimbursement', 'info');
    }
  }

  public removeReimbursement(): void {
    const tx = this.reimbursingTx();
    if (!tx) return;

    this.service.updateTransaction(tx.id, {
      isReimbursable: false,
      reimbursementStatus: undefined,
      reimbursedTo: undefined,
      reimbursementNote: undefined
    });

    this.closeReimbursementModal();
    this.service.showToast('Reimbursement flag removed', 'info');
  }

  public onInlineNoteChange(tx: Transaction, note?: string): void {
    const trimmed = (note || '').trim() || undefined;
    const currentStoredTx = this.service.transactions().find((t) => t.id === tx.id);
    if (currentStoredTx && currentStoredTx.note === trimmed) {
      return;
    }
    tx.note = trimmed;
    this.service.updateTransaction(tx.id, { note: trimmed });
  }

  public trackTx(_index: number, tx: Transaction): string {
    return tx.id;
  }

  public openEditTxModal(tx: Transaction) {
    this.editingTx.set(tx);
    this.editDate = tx.date;
    this.editAmount = tx.amount;
    this.editDescription = tx.description || '';
    this.editPaidBy = tx.paidBy || this.service.personOne().name;
    this.editCategoryItem = tx.categoryItem || '';
    this.editCategoryGroup = tx.categoryGroup || '';
    this.editNote = tx.note || '';
    this.editIncomeMonth = tx.incomeMonth || (tx.date ? tx.date.slice(0, 7) : '');

    if (tx.splitType === 'SELF') {
      this.editSplitOption = 'PAYER_ONLY';
      this.editSplitMode = 'PERCENTAGE';
      this.editCustomPercentage = 100;
    } else if (tx.splitType === 'OTHER') {
      this.editSplitOption = 'OTHER_ONLY';
      this.editSplitMode = 'PERCENTAGE';
      this.editCustomPercentage = 0;
    } else if (tx.splitType === 'SPLIT') {
      if (tx.splitMode === 'EXACT' && tx.customSplitAmounts) {
        this.editSplitOption = 'CUSTOM';
        this.editSplitMode = 'EXACT';
        const p1 = this.service.personOne().name;
        const p2 = this.service.personTwo().name;
        this.editCustomP1Amount = tx.customSplitAmounts[p1] || 0;
        this.editCustomP2Amount = tx.customSplitAmounts[p2] || 0;
      } else {
        const pct = tx.splitPercentage !== undefined ? tx.splitPercentage : 50;
        if (pct === 50) {
          this.editSplitOption = 'SPLIT_5050';
        } else {
          this.editSplitOption = 'CUSTOM';
        }
        this.editSplitMode = 'PERCENTAGE';
        this.editCustomPercentage = pct;
        this.editCustomP1Amount = parseFloat(((tx.amount * pct) / 100).toFixed(2));
        this.editCustomP2Amount = parseFloat((tx.amount - this.editCustomP1Amount).toFixed(2));
      }
    } else {
      this.editSplitOption = 'SPLIT_5050';
      this.editSplitMode = 'PERCENTAGE';
      this.editCustomPercentage = 50;
    }
  }

  public setEditSplitOption(opt: 'PAYER_ONLY' | 'OTHER_ONLY' | 'SPLIT_5050' | 'CUSTOM') {
    this.editSplitOption = opt;
    if (opt === 'CUSTOM') {
      if (this.editSplitMode === 'PERCENTAGE') {
        this.editCustomP1Amount = parseFloat(((this.editAmount * this.editCustomPercentage) / 100).toFixed(2));
        this.editCustomP2Amount = parseFloat((this.editAmount - this.editCustomP1Amount).toFixed(2));
      } else {
        const half = parseFloat((this.editAmount / 2).toFixed(2));
        this.editCustomP1Amount = half;
        this.editCustomP2Amount = parseFloat((this.editAmount - half).toFixed(2));
      }
    }
  }

  public setEditCustomPercentage(pct: number) {
    this.editCustomPercentage = pct;
    this.editCustomP1Amount = parseFloat(((this.editAmount * pct) / 100).toFixed(2));
    this.editCustomP2Amount = parseFloat((this.editAmount - this.editCustomP1Amount).toFixed(2));
  }

  public onEditP1AmountChange(val: number) {
    this.editCustomP1Amount = val;
    this.editCustomP2Amount = Math.max(0, parseFloat((this.editAmount - val).toFixed(2)));
  }

  public onEditP2AmountChange(val: number) {
    this.editCustomP2Amount = val;
    this.editCustomP1Amount = Math.max(0, parseFloat((this.editAmount - val).toFixed(2)));
  }

  public saveEditTx() {
    const tx = this.editingTx();
    if (!tx) return;

    let splitType: SplitType = 'SPLIT';
    let splitMode: SplitMode = 'PERCENTAGE';
    let splitPercentage: number | undefined = 50;
    let customSplitAmounts: Record<string, number> | undefined = undefined;

    if (tx.isCashTransfer) {
      splitType = 'OTHER';
    } else if (this.editSplitOption === 'PAYER_ONLY') {
      splitType = 'SELF';
      splitPercentage = 100;
    } else if (this.editSplitOption === 'OTHER_ONLY') {
      splitType = 'OTHER';
      splitPercentage = 0;
    } else if (this.editSplitOption === 'SPLIT_5050') {
      splitType = 'SPLIT';
      splitMode = 'PERCENTAGE';
      splitPercentage = 50;
    } else if (this.editSplitOption === 'CUSTOM') {
      splitType = 'SPLIT';
      splitMode = this.editSplitMode;
      if (this.editSplitMode === 'EXACT') {
        const p1 = this.service.personOne().name;
        const p2 = this.service.personTwo().name;
        customSplitAmounts = { [p1]: this.editCustomP1Amount, [p2]: this.editCustomP2Amount };
      } else {
        splitPercentage = this.editCustomPercentage;
      }
    }

    // Auto-detect group for category if changed
    let categoryGroup = this.editCategoryGroup;
    if (this.editCategoryItem) {
      const existingGrp = this.service.categoryGroups().find((g) => g.name === categoryGroup);
      if (!existingGrp || !existingGrp.items.some((it) => it.name === this.editCategoryItem)) {
        const found = this.service.categoryGroups().find((g) => g.items.some((it) => it.name === this.editCategoryItem));
        if (found) categoryGroup = found.name;
      }
    }

    const receiptMonth = (this.editDate || '').slice(0, 7);
    const updatedIncomeMonth = tx.type === 'INCOME'
      ? (this.editIncomeMonth && this.editIncomeMonth !== receiptMonth ? this.editIncomeMonth : undefined)
      : undefined;

    this.service.updateTransaction(tx.id, {
      date: this.editDate,
      amount: this.editAmount,
      description: this.editDescription,
      paidBy: this.editPaidBy,
      categoryItem: this.editCategoryItem,
      categoryGroup,
      splitType,
      splitMode,
      splitPercentage,
      customSplitAmounts,
      note: this.editNote,
      incomeMonth: updatedIncomeMonth
    });

    this.editingTx.set(null);
    this.service.showToast('Transaction updated', 'success');
  }

  public isIncomeShifted(tx: Transaction): boolean {
    const curM = (tx.date || '').slice(0, 7);
    return Boolean(tx.type === 'INCOME' && tx.incomeMonth && tx.incomeMonth !== curM);
  }

  public getIncomeMonthBadgeLabel(tx: Transaction): string {
    const curM = (tx.date || '').slice(0, 7);
    if (!tx.incomeMonth || tx.incomeMonth === curM) return '';
    const targetMonthName = this.service.formatMonthName(tx.incomeMonth);
    return `📅 Funds ${targetMonthName}`;
  }

  public getIncomeMonthBadgeTooltip(tx: Transaction): string {
    const curM = (tx.date || '').slice(0, 7);
    if (!tx.incomeMonth || tx.incomeMonth === curM) return '';
    const targetMonth = this.service.formatMonth(tx.incomeMonth);
    return `Assigned to fund ${targetMonth}'s budget. Click to keep in ${this.service.formatMonth(curM)}.`;
  }

  public getIncomeMonthButtonLabel(tx: Transaction): string {
    const curM = (tx.date || '').slice(0, 7);
    const isShifted = Boolean(tx.incomeMonth && tx.incomeMonth !== curM);
    if (!isShifted) {
      return '📅 Next Month';
    }
    return `↩ Keep in ${this.service.formatMonthName(curM)}`;
  }

  public getIncomeMonthButtonTooltip(tx: Transaction): string {
    const curM = (tx.date || '').slice(0, 7);
    const isShifted = Boolean(tx.incomeMonth && tx.incomeMonth !== curM);
    const prevMonth = this.service.formatMonth(curM);
    const nextMonth = this.service.formatMonth(this.service.getNextMonth(curM));
    if (!isShifted) {
      return `Shift this income to fund ${nextMonth}'s budget`;
    }
    return `Currently assigned to ${this.service.formatMonth(tx.incomeMonth || '')}. Click to move back to ${prevMonth}`;
  }

  public toggleTxIncomeMonth(tx: Transaction): void {
    const curM = (tx.date || '').slice(0, 7);
    const nextM = this.service.getNextMonth(curM);
    const newMonth = (!tx.incomeMonth || tx.incomeMonth === curM) ? nextM : undefined;
    this.service.updateTransaction(tx.id, { incomeMonth: newMonth });
    this.service.showToast(
      newMonth
        ? `Shifted to ${this.service.formatMonth(newMonth)} budget`
        : `Moved back to ${this.service.formatMonth(curM)} budget`,
      'info'
    );
  }

  public updateSplitType(tx: Transaction, type: SplitType) {
    this.service.updateTransaction(tx.id, {
      splitType: type,
      splitPercentage: type === 'SPLIT' ? (tx.splitPercentage || 50) : undefined
    });
  }

  public openCustomSplitModal(tx: Transaction) {
    this.activeCustomSplitTx.set(tx);
    this.customSplitPercentage = tx.splitPercentage || 50;
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;

    if (tx.customSplitAmounts) {
      this.customSplitP1Amount = tx.customSplitAmounts[p1] || 0;
      this.customSplitP2Amount = tx.customSplitAmounts[p2] || 0;
    } else {
      const p1Share = parseFloat(((tx.amount * this.customSplitPercentage) / 100).toFixed(2));
      this.customSplitP1Amount = p1Share;
      this.customSplitP2Amount = parseFloat((tx.amount - p1Share).toFixed(2));
    }
  }

  public applyCustomPercentage(pct: number) {
    this.customSplitPercentage = pct;
    const tx = this.activeCustomSplitTx();
    if (!tx) return;
    const p1Share = parseFloat(((tx.amount * pct) / 100).toFixed(2));
    this.customSplitP1Amount = p1Share;
    this.customSplitP2Amount = parseFloat((tx.amount - p1Share).toFixed(2));
  }

  public onP1AmountChange(val: number) {
    this.customSplitP1Amount = val;
    const tx = this.activeCustomSplitTx();
    if (tx) {
      this.customSplitP2Amount = parseFloat(Math.max(0, tx.amount - val).toFixed(2));
    }
  }

  public saveCustomSplit() {
    const tx = this.activeCustomSplitTx();
    if (!tx) return;
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;

    this.service.updateTransaction(tx.id, {
      splitType: 'SPLIT',
      splitMode: 'EXACT',
      splitPercentage: this.customSplitPercentage,
      customSplitAmounts: {
        [p1]: this.customSplitP1Amount,
        [p2]: this.customSplitP2Amount
      }
    });

    this.activeCustomSplitTx.set(null);
    this.service.showToast('Custom split saved', 'success');
  }

  public async deleteTx(tx: Transaction) {
    const ok = await this.service.showConfirm('Delete Transaction', `Delete "${tx.description}" (${this.service.formatCurrency(tx.amount)})?`);
    if (ok) {
      this.service.deleteTransaction(tx.id);
    }
  }
}
