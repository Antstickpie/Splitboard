import { Component, inject, signal, computed, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { Transaction, SplitType, SplitMode } from '../../models';
import { ImportComponent } from '../import/import';

@Component({
  selector: 'app-ledger',
  standalone: true,
  imports: [CommonModule, FormsModule, ImportComponent],
  templateUrl: './ledger.html',
  styleUrl: './ledger.css'
})
export class LedgerComponent {
  public service = inject(TransactionService);
  private elementRef = inject(ElementRef);
  public isImportOpen = signal<boolean>(false);

  public toggleImport(): void {
    this.isImportOpen.set(!this.isImportOpen());
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
      const container = this.elementRef.nativeElement.querySelector('.everydollar-month-container');
      if (container && !container.contains(event.target as Node)) {
        this.isMonthPickerOpen.set(false);
      }
    }
  }

  // Settlement breakdown drawer toggle
  public isSettlementExpanded = signal(false);

  // Quick Cash / Transfer modal
  public isCashModalOpen = signal(false);
  public cashDate = new Date().toISOString().slice(0, 10);
  public cashAmount = 0;
  public cashDescription = '';
  public cashPaidBy = '';
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

  // Split customization modal
  public activeCustomSplitTx = signal<Transaction | null>(null);
  public customSplitP1Amount = 0;
  public customSplitP2Amount = 0;
  public customSplitPercentage = 50;

  // EveryDollar Month Picker Popover State
  public isMonthPickerOpen = signal<boolean>(false);
  public pickerYear = signal<number>(new Date().getFullYear());
  public monthsList = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  constructor() {
    this.cashPaidBy = this.service.personOne().name;
    this.cashTransferTo = this.service.personTwo().name;
    this.cashCurrency = this.service.currency();
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

  public openCashModal() {
    this.cashDate = new Date().toISOString().slice(0, 10);
    this.cashAmount = 0;
    this.cashCurrency = this.service.currency();
    this.cashDescription = '';
    this.cashPaidBy = this.service.personOne().name;
    this.cashTransferTo = this.service.personTwo().name;
    this.cashIsTransfer = false;
    this.cashCategoryGroup = 'Food';
    this.cashCategoryItem = 'Dining Out and Food Chill';
    this.cashSplitOption = 'SPLIT_5050';
    this.cashSplitMode = 'PERCENTAGE';
    this.cashCustomPercentage = 50;
    this.cashCustomP1Amount = 0;
    this.cashCustomP2Amount = 0;
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
      const found = this.service.categoryGroups().find((g) => g.items.some((it) => it.name === this.cashCategoryItem));
      if (found) categoryGroup = found.name;
    }

    const tx: Transaction = {
      id: 'cash-' + Date.now(),
      date: this.cashDate,
      bank: 'Cash',
      account: 'Cash Wallet',
      description: this.cashDescription.trim() || (this.cashIsTransfer ? `Transfer to ${this.cashTransferTo}` : 'Cash Expense'),
      amount: finalAmount,
      type: 'EXPENSE',
      paidBy: this.cashPaidBy,
      isCash: true,
      isCashTransfer: this.cashIsTransfer,
      transferTo: this.cashIsTransfer ? this.cashTransferTo : undefined,
      categoryGroup: categoryGroup || undefined,
      categoryItem: this.cashCategoryItem || undefined,
      splitType,
      splitMode,
      splitPercentage,
      customSplitAmounts,
      currency: this.cashCurrency,
      originalAmount,
      originalCurrency,
      exchangeRate: rate,
      createdAt: new Date().toISOString()
    };

    this.service.addTransaction(tx);
    this.isCashModalOpen.set(false);
    this.service.showToast('Entry logged successfully', 'success');
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
    this.service.selectedMonth.set(mStr);
    this.isMonthPickerOpen.set(false);
  }

  public showAllMonths(): void {
    this.service.selectedMonth.set('ALL');
    this.isMonthPickerOpen.set(false);
  }

  public goToCurrentMonth(): void {
    const today = this.service.getCurrentMonthString();
    this.service.selectedMonth.set(today);
    this.pickerYear.set(new Date().getFullYear());
    this.isMonthPickerOpen.set(false);
  }

  public isMonthSelected(monthIdx: number): boolean {
    const mStr = `${this.pickerYear()}-${String(monthIdx + 1).padStart(2, '0')}`;
    return this.service.selectedMonth() === mStr;
  }

  public hasMonthData(monthIdx: number): boolean {
    const mStr = `${this.pickerYear()}-${String(monthIdx + 1).padStart(2, '0')}`;
    return this.service.transactions().some((t) => t.date && t.date.startsWith(mStr));
  }

  public prevMonth(): void {
    const curr = this.service.selectedMonth() === 'ALL' ? this.service.getCurrentMonthString() : this.service.selectedMonth();
    const [y, m] = curr.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    const newY = d.getFullYear();
    const newM = String(d.getMonth() + 1).padStart(2, '0');
    this.service.selectedMonth.set(`${newY}-${newM}`);
  }

  public nextMonth(): void {
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

  public onInlineCategoryChange(tx: Transaction, itemCategoryName: string): void {
    if (!itemCategoryName) {
      this.service.updateTransaction(tx.id, {
        categoryGroup: undefined,
        categoryItem: undefined
      });
      return;
    }

    let parentGroupName: string | undefined;
    for (const grp of this.service.categoryGroups()) {
      if (grp.items.some((i) => i.name === itemCategoryName)) {
        parentGroupName = grp.name;
        break;
      }
    }

    const isReimbCategory = itemCategoryName.toLowerCase().includes('reimburse');
    this.service.updateTransaction(tx.id, {
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

  public openEditTxModal(tx: Transaction) {
    this.editingTx.set(tx);
    this.editDate = tx.date;
    this.editAmount = tx.amount;
    this.editDescription = tx.description || '';
    this.editPaidBy = tx.paidBy || this.service.personOne().name;
    this.editCategoryItem = tx.categoryItem || '';
    this.editCategoryGroup = tx.categoryGroup || '';
    this.editNote = tx.note || '';

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
      const found = this.service.categoryGroups().find((g) => g.items.some((it) => it.name === this.editCategoryItem));
      if (found) categoryGroup = found.name;
    }

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
      note: this.editNote
    });

    this.editingTx.set(null);
    this.service.showToast('Transaction updated', 'success');
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
