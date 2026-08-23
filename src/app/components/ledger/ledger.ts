import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { Transaction, SplitType, SplitMode } from '../../models';

@Component({
  selector: 'app-ledger',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ledger.html',
  styleUrl: './ledger.css'
})
export class LedgerComponent {
  public service = inject(TransactionService);

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
  public cashSplitType: SplitType = 'SPLIT';
  public cashSplitPercentage = 50;

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
    this.cashSplitType = 'SPLIT';
    this.cashSplitPercentage = 50;
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

    const tx: Transaction = {
      id: 'tx-cash-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now(),
      date: this.cashDate,
      amount: finalAmount,
      type: this.cashIsTransfer ? 'TRANSFER' : 'EXPENSE',
      description: this.cashDescription || (this.cashIsTransfer ? `Cash Transfer to ${this.cashTransferTo}` : 'Cash Expense'),
      bank: 'Cash',
      account: 'Cash Wallet',
      paidBy: this.cashPaidBy,
      isCash: true,
      isCashTransfer: this.cashIsTransfer,
      transferTo: this.cashIsTransfer ? this.cashTransferTo : undefined,
      categoryGroup: this.cashIsTransfer ? undefined : this.cashCategoryGroup,
      categoryItem: this.cashIsTransfer ? undefined : this.cashCategoryItem,
      splitType: this.cashIsTransfer ? 'OTHER' : this.cashSplitType,
      splitPercentage: this.cashSplitPercentage,
      currency: this.cashCurrency,
      originalAmount,
      originalCurrency,
      exchangeRate: rate,
      createdAt: new Date().toISOString()
    };

    this.service.addTransaction(tx);
    this.isCashModalOpen.set(false);
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
