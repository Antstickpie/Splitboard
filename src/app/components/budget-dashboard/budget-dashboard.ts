import { Component, inject, computed, signal, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { CategoryGroup, CategoryItem, Transaction, SplitType } from '../../models';

interface CategoryGroupSummary {
  id: string;
  name: string;
  icon: string;
  plannedTotal: number;
  actualTotal: number;
  remainingTotal: number;
  items: {
    id: string;
    name: string;
    planned: number;
    actual: number;
    remaining: number;
    percentage: number;
    defaultOwner?: string;
    isFund?: boolean;
    startingBalance?: number;
    totalAvailable?: number;
  }[];
}

@Component({
  selector: 'app-budget-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './budget-dashboard.html',
  styleUrl: './budget-dashboard.css'
})
export class BudgetDashboardComponent {
  public service = inject(TransactionService);
  public Math = Math;

  public selectedMonth = signal<string>(
    this.service.selectedMonth() === 'ALL' ? this.service.getCurrentMonthString() : this.service.selectedMonth()
  );
  public isMonthPickerOpen = signal<boolean>(false);
  public pickerYear = signal<number>(
    parseInt((this.service.selectedMonth() === 'ALL' ? this.service.getCurrentMonthString() : this.service.selectedMonth()).split('-')[0], 10)
  );
  public monthsList = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // EveryDollar Sidebar State
  public sidebarTab = signal<'summary' | 'transactions'>('summary');
  public transactionFilter = signal<'all' | 'categorized' | 'uncategorized'>('all');
  public sidebarSearch = signal<string>('');
  public viewMode = signal<'remaining' | 'spent'>('remaining');

  // Quick Add Item inline
  public activeAddingGroupId = signal<string | null>(null);
  public newCategoryItemName = signal<string>('');

  public expandedItemKey = signal<string | null>(null);

  public toggleItemExpand(groupId: string, itemName: string): void {
    const key = `${groupId}::${itemName}`;
    if (this.expandedItemKey() === key) {
      this.expandedItemKey.set(null);
    } else {
      this.expandedItemKey.set(key);
    }
  }

  public getItemTransactions(groupId: string, itemName: string): Transaction[] {
    const month = this.selectedMonth();
    const monthTxs = this.service.transactions().filter(
      (tx) => tx.date && tx.date.startsWith(month)
    );

    if (groupId === 'grp-uncategorized' || itemName.toLowerCase() === 'uncategorized') {
      return monthTxs.filter((tx) => {
        if (tx.type === 'INCOME') return false;
        const cat = (tx.categoryItem || '').trim().toLowerCase();
        return !cat || cat === 'uncategorized';
      });
    }

    const isIncomeTarget = groupId === 'grp-income' || itemName.toLowerCase().includes('income') || itemName.toLowerCase() === 'salary';

    return monthTxs.filter((tx) => {
      const cat = (tx.categoryItem || '').trim();
      if (cat.toLowerCase() === itemName.toLowerCase()) return true;
      if (isIncomeTarget && (tx.type === 'INCOME' || (tx.categoryGroup || '').toLowerCase().includes('income'))) {
        return true;
      }
      return false;
    });
  }

  public onInlineCategoryChange(tx: Transaction, itemCategoryName: string): void {
    if (!itemCategoryName) {
      this.service.updateTransaction(tx.id, {
        categoryGroup: undefined,
        categoryItem: undefined
      });
      this.service.showToast('Transaction uncategorized', 'info');
      return;
    }

    let parentGroupName: string | undefined;
    for (const grp of this.service.categoryGroups()) {
      if (grp.items.some((i) => i.name === itemCategoryName)) {
        parentGroupName = grp.name;
        break;
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
    this.service.showToast(`Updated to "${itemCategoryName}"`, 'success');
  }

  public toggleTxOwner(tx: Transaction): void {
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;
    const newOwner = tx.paidBy === p1 ? p2 : p1;
    this.service.updateTransaction(tx.id, { paidBy: newOwner });
    this.service.showToast(`Owner changed to ${newOwner}`, 'info');
  }

  public cycleTxSplit(tx: Transaction): void {
    const splits: SplitType[] = ['SELF', 'SPLIT', 'OTHER'];
    const currentIdx = splits.indexOf(tx.splitType || 'SPLIT');
    const nextSplit = splits[(currentIdx + 1) % splits.length];
    this.service.updateTransaction(tx.id, { splitType: nextSplit });
    this.service.showToast(`Split set to ${nextSplit}`, 'info');
  }

  public isPastMonth = computed(() => {
    return this.selectedMonth() < this.service.getCurrentMonthString();
  });

  public isFutureMonth = computed(() => {
    return this.selectedMonth() > this.service.getCurrentMonthString();
  });

  public isBalanced = computed(() => {
    return Math.abs(this.budgetTotals().plannedRemaining) < 0.01;
  });

  public toggleViewMode(): void {
    this.viewMode.update((v) => (v === 'remaining' ? 'spent' : 'remaining'));
  }

  public prevMonth(): void {
    const [y, m] = this.selectedMonth().split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    this.selectedMonth.set(mStr);
    this.service.selectedMonth.set(mStr);
  }

  public nextMonth(): void {
    const [y, m] = this.selectedMonth().split('-').map(Number);
    const d = new Date(y, m, 1);
    const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    this.selectedMonth.set(mStr);
    this.service.selectedMonth.set(mStr);
  }

  private elementRef = inject(ElementRef);

  @HostListener('document:click', ['$event'])
  public onDocumentClick(event: MouseEvent): void {
    if (this.isMonthPickerOpen()) {
      const container = this.elementRef.nativeElement.querySelector('.everydollar-month-container');
      if (container && !container.contains(event.target as Node)) {
        this.isMonthPickerOpen.set(false);
      }
    }
  }

  public goToToday(): void {
    const current = this.service.getCurrentMonthString();
    this.selectedMonth.set(current);
    this.service.selectedMonth.set(current);
    this.pickerYear.set(new Date().getFullYear());
    this.isMonthPickerOpen.set(false);
  }

  public toggleMonthPicker(): void {
    this.isMonthPickerOpen.update((v) => !v);
    if (this.isMonthPickerOpen()) {
      const [y] = this.selectedMonth().split('-').map(Number);
      this.pickerYear.set(y);
    }
  }

  public prevYear(): void {
    this.pickerYear.update((y) => y - 1);
  }

  public nextYear(): void {
    this.pickerYear.update((y) => y + 1);
  }

  public selectMonth(monthIndex: number): void {
    const mStr = `${this.pickerYear()}-${String(monthIndex + 1).padStart(2, '0')}`;
    this.selectedMonth.set(mStr);
    this.service.selectedMonth.set(mStr);
    this.isMonthPickerOpen.set(false);
  }

  public isMonthSelected(monthIndex: number): boolean {
    const mStr = `${this.pickerYear()}-${String(monthIndex + 1).padStart(2, '0')}`;
    return this.selectedMonth() === mStr;
  }

  public hasMonthData(monthIndex: number): boolean {
    const mStr = `${this.pickerYear()}-${String(monthIndex + 1).padStart(2, '0')}`;
    return this.service.transactions().some((tx) => tx.date && tx.date.startsWith(mStr));
  }

  // Active Category Details Drawer
  public activeCategoryItem = signal<CategoryItem | null>(null);

  public openCategoryDrawer(item: CategoryItem): void {
    this.activeCategoryItem.set(item);
  }

  public closeCategoryDrawer(): void {
    this.activeCategoryItem.set(null);
  }

  // Sidebar Transactions
  public sidebarTransactions = computed(() => {
    const month = this.selectedMonth();
    const q = this.sidebarSearch().toLowerCase().trim();
    const filter = this.transactionFilter();

    let list = this.service.transactions().filter((t) => t.date && t.date.startsWith(month));

    if (filter === 'uncategorized') {
      list = list.filter((t) => !t.categoryItem || t.categoryItem === 'Uncategorized');
    } else if (filter === 'categorized') {
      list = list.filter((t) => t.categoryItem && t.categoryItem !== 'Uncategorized');
    }

    if (q) {
      list = list.filter((t) =>
        (t.description || '').toLowerCase().includes(q) ||
        (t.bank || '').toLowerCase().includes(q) ||
        (t.categoryItem || '').toLowerCase().includes(q) ||
        (t.paidBy || '').toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  });

  public startAddingItem(groupId: string): void {
    this.activeAddingGroupId.set(groupId);
    this.newCategoryItemName.set('');
  }

  public cancelAddingItem(): void {
    this.activeAddingGroupId.set(null);
    this.newCategoryItemName.set('');
  }

  public saveNewItem(groupId: string): void {
    const name = this.newCategoryItemName().trim();
    if (!name) return;
    this.service.addCategoryItem(groupId, name);
    this.activeAddingGroupId.set(null);
    this.newCategoryItemName.set('');
  }

  // Pure Actuals Budget Computation
  public groupSummaries = computed<CategoryGroupSummary[]>(() => {
    const month = this.selectedMonth();
    const txsInMonth = this.service.transactions().filter(
      (tx) => tx.date && tx.date.startsWith(month)
    );

    // Compute actuals per category (excluding cash transfers and reimbursed expenses)
    const actualsMap: Record<string, number> = {};
    let uncategorizedTotal = 0;
    const knownCategories = new Set<string>();

    this.service.categoryGroups().forEach((g) => {
      g.items.forEach((it) => knownCategories.add(it.name));
    });

    const otherCategoriesMap: Record<string, number> = {};

    txsInMonth.forEach((tx) => {
      if (tx.isReimbursable && tx.reimbursementStatus === 'REIMBURSED') return;
      if (tx.type === 'INCOME') return;

      const amt = Number(tx.amount) || 0;
      if (amt <= 0) return;

      const cat = (tx.categoryItem || '').trim();
      if (!cat || cat.toLowerCase() === 'uncategorized') {
        uncategorizedTotal += amt;
      } else if (knownCategories.has(cat)) {
        actualsMap[cat] = (actualsMap[cat] || 0) + amt;
      } else {
        otherCategoriesMap[cat] = (otherCategoriesMap[cat] || 0) + amt;
      }
    });

    // Collect income
    const incomeMap: Record<string, number> = {};
    let incomeTotal = 0;
    txsInMonth.forEach((tx) => {
      if (tx.type === 'INCOME') {
        const amt = Number(tx.amount) || 0;
        if (amt > 0) {
          incomeTotal += amt;
          const label = tx.categoryItem || tx.description || 'Income';
          incomeMap[label] = (incomeMap[label] || 0) + amt;
        }
      }
    });

    const summaries: CategoryGroupSummary[] = this.service.categoryGroups().map((grp) => {
      let groupActual = 0;

      const items = grp.items.map((item) => {
        const actual = actualsMap[item.name] || 0;
        groupActual += actual;

        return {
          id: item.id,
          name: item.name,
          planned: 0,
          actual,
          remaining: 0,
          percentage: 0,
          defaultOwner: item.defaultOwner
        };
      });

      return {
        id: grp.id,
        name: grp.name,
        icon: grp.icon || '📁',
        plannedTotal: 0,
        actualTotal: groupActual,
        remainingTotal: 0,
        items
      };
    });

    // If there are other custom categories not in predefined groups, add an Other Categories group
    const otherEntries = Object.entries(otherCategoriesMap);
    if (otherEntries.length > 0) {
      let otherTotal = 0;
      const otherItems = otherEntries.map(([name, actual], idx) => {
        otherTotal += actual;
        return {
          id: 'other-cat-' + idx,
          name,
          planned: 0,
          actual,
          remaining: 0,
          percentage: 0
        };
      });
      summaries.push({
        id: 'grp-other',
        name: 'Other Categories',
        icon: '🏷️',
        plannedTotal: 0,
        actualTotal: otherTotal,
        remainingTotal: 0,
        items: otherItems
      });
    }

    // If there are uncategorized transactions, add Uncategorized Group
    if (uncategorizedTotal > 0) {
      summaries.push({
        id: 'grp-uncategorized',
        name: 'Uncategorized',
        icon: '❓',
        plannedTotal: 0,
        actualTotal: uncategorizedTotal,
        remainingTotal: 0,
        items: [
          {
            id: 'item-uncategorized',
            name: 'Uncategorized',
            planned: 0,
            actual: uncategorizedTotal,
            remaining: 0,
            percentage: 0
          }
        ]
      });
    }

    // If there are income transactions, prepend Income & Inflows group
    if (incomeTotal > 0) {
      const incomeItems = Object.entries(incomeMap).map(([name, actual], idx) => ({
        id: 'inc-item-' + idx,
        name,
        planned: 0,
        actual,
        remaining: 0,
        percentage: 0
      }));
      summaries.unshift({
        id: 'grp-income',
        name: 'Income & Inflows',
        icon: '💵',
        plannedTotal: 0,
        actualTotal: incomeTotal,
        remainingTotal: 0,
        items: incomeItems
      });
    }

    return summaries;
  });

  public activeGroupSummaries = computed(() => {
    return this.groupSummaries().filter((grp) => grp.actualTotal > 0);
  });

  public budgetTotals = computed(() => {
    const month = this.selectedMonth();
    let totalIncomeActual = 0;
    let totalExpenseActual = 0;

    this.service.transactions().filter((tx) => tx.date && tx.date.startsWith(month)).forEach((tx) => {
      const amt = Number(tx.amount) || 0;
      if (amt <= 0) return;
      if (tx.type === 'INCOME') {
        totalIncomeActual += amt;
      } else if (tx.type === 'EXPENSE') {
        if (tx.isReimbursable && tx.reimbursementStatus === 'REIMBURSED') return;
        totalExpenseActual += amt;
      }
    });

    const netRemaining = totalIncomeActual - totalExpenseActual;

    return {
      totalIncomePlanned: 0,
      totalIncomeActual,
      totalExpensePlanned: 0,
      totalExpenseActual,
      netRemaining,
      plannedRemaining: 0
    };
  });

  public spendByPerson = computed(() => {
    const month = this.selectedMonth();
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;
    let p1Spend = 0;
    let p2Spend = 0;

    this.service.transactions().filter((tx) => tx.date && tx.date.startsWith(month) && !tx.isCashTransfer && tx.type === 'EXPENSE').forEach((tx) => {
      if (tx.isReimbursable && tx.reimbursementStatus === 'REIMBURSED') return;
      if (tx.paidBy === p1) p1Spend += Number(tx.amount) || 0;
      else if (tx.paidBy === p2) p2Spend += Number(tx.amount) || 0;
    });

    const total = p1Spend + p2Spend;
    return {
      p1Name: p1,
      p1Spend,
      p1Pct: total > 0 ? Math.round((p1Spend / total) * 100) : 50,
      p2Name: p2,
      p2Spend,
      p2Pct: total > 0 ? Math.round((p2Spend / total) * 100) : 50,
      total
    };
  });

  // Person-Level Savings & Cumulative Fund Balance (Pure Actuals)
  public personSavingsBreakdown = computed(() => {
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;
    const currentMonth = this.selectedMonth();
    const allTxs = this.service.transactions();

    const isSavingsCategory = (tx: Transaction) => {
      const grp = tx.categoryGroup?.toLowerCase() || '';
      const item = tx.categoryItem?.toLowerCase() || '';
      const desc = tx.description?.toLowerCase() || '';
      return grp.includes('saving') || item.includes('saving') || desc.includes('saving from everydollar');
    };

    // 1. Current Month Actuals
    const monthTxs = allTxs.filter((tx) => tx.date && tx.date.startsWith(currentMonth));
    let p1IncomeMonth = 0;
    let p2IncomeMonth = 0;
    let p1SpentShareMonth = 0;
    let p2SpentShareMonth = 0;

    monthTxs.forEach((tx) => {
      const amt = Number(tx.amount) || 0;
      if (amt <= 0) return;

      if (tx.type === 'INCOME' || isSavingsCategory(tx)) {
        if (tx.paidBy === p1) p1IncomeMonth += amt;
        else if (tx.paidBy === p2) p2IncomeMonth += amt;
        else {
          p1IncomeMonth += amt / 2;
          p2IncomeMonth += amt / 2;
        }
      } else if (tx.type === 'EXPENSE' && !tx.isCashTransfer) {
        if (tx.splitType === 'SELF') {
          if (tx.paidBy === p1) p1SpentShareMonth += amt;
          else p2SpentShareMonth += amt;
        } else if (tx.splitType === 'OTHER') {
          if (tx.paidBy === p1) p2SpentShareMonth += amt;
          else p1SpentShareMonth += amt;
        } else {
          // SPLIT
          if (tx.splitMode === 'EXACT' && tx.customSplitAmounts) {
            p1SpentShareMonth += Number(tx.customSplitAmounts[p1]) || 0;
            p2SpentShareMonth += Number(tx.customSplitAmounts[p2]) || 0;
          } else {
            const pct = tx.splitPercentage != null ? tx.splitPercentage : 50;
            if (tx.paidBy === p1) {
              const p1s = parseFloat(((amt * pct) / 100).toFixed(2));
              p1SpentShareMonth += p1s;
              p2SpentShareMonth += parseFloat((amt - p1s).toFixed(2));
            } else {
              const p2s = parseFloat(((amt * pct) / 100).toFixed(2));
              p2SpentShareMonth += p2s;
              p1SpentShareMonth += parseFloat((amt - p2s).toFixed(2));
            }
          }
        }
      }
    });

    const settlement = this.service.monthSettlement();
    let p1ThisMonthSettlementAdj = 0;
    let p2ThisMonthSettlementAdj = 0;
    if (settlement.thisMonthNetOwed > 0) {
      if (settlement.thisMonthCreditor === p1) {
        p1ThisMonthSettlementAdj = settlement.thisMonthNetOwed;
        p2ThisMonthSettlementAdj = -settlement.thisMonthNetOwed;
      } else if (settlement.thisMonthCreditor === p2) {
        p1ThisMonthSettlementAdj = -settlement.thisMonthNetOwed;
        p2ThisMonthSettlementAdj = settlement.thisMonthNetOwed;
      }
    }

    let p1CarryoverSettlementAdj = 0;
    let p2CarryoverSettlementAdj = 0;
    if (settlement.carryoverAmount > 0) {
      if (settlement.carryoverCreditor === p1) {
        p1CarryoverSettlementAdj = settlement.carryoverAmount;
        p2CarryoverSettlementAdj = -settlement.carryoverAmount;
      } else if (settlement.carryoverCreditor === p2) {
        p1CarryoverSettlementAdj = -settlement.carryoverAmount;
        p2CarryoverSettlementAdj = settlement.carryoverAmount;
      }
    }

    let p1TotalSettlementAdj = 0;
    let p2TotalSettlementAdj = 0;
    if (!settlement.isSettled) {
      if (settlement.creditorName === p1) {
        p1TotalSettlementAdj = settlement.netOwedAmount;
        p2TotalSettlementAdj = -settlement.netOwedAmount;
      } else if (settlement.creditorName === p2) {
        p1TotalSettlementAdj = -settlement.netOwedAmount;
        p2TotalSettlementAdj = settlement.netOwedAmount;
      }
    }

    const p1MonthSaved = p1IncomeMonth - p1SpentShareMonth + p1ThisMonthSettlementAdj;
    const p2MonthSaved = p2IncomeMonth - p2SpentShareMonth + p2ThisMonthSettlementAdj;

    // 2. Cumulative Prior Savings (from all months prior to currentMonth)
    let p1PriorSavings = 0;
    let p2PriorSavings = 0;

    const priorTxs = allTxs.filter((tx) => tx.date && tx.date.slice(0, 7) < currentMonth);
    priorTxs.forEach((tx) => {
      const amt = Number(tx.amount) || 0;
      if (amt <= 0) return;

      if (tx.type === 'INCOME' || isSavingsCategory(tx)) {
        if (tx.paidBy === p1) p1PriorSavings += amt;
        else if (tx.paidBy === p2) p2PriorSavings += amt;
        else {
          p1PriorSavings += amt / 2;
          p2PriorSavings += amt / 2;
        }
      } else if (tx.isCashTransfer) {
        // Direct cash transfer
        if (tx.paidBy === p1 && tx.transferTo === p2) {
          p1PriorSavings -= amt;
          p2PriorSavings += amt;
        } else if (tx.paidBy === p2 && tx.transferTo === p1) {
          p2PriorSavings -= amt;
          p1PriorSavings += amt;
        }
      } else if (tx.type === 'EXPENSE') {
        if (tx.splitType === 'SELF') {
          if (tx.paidBy === p1) p1PriorSavings -= amt;
          else p2PriorSavings -= amt;
        } else if (tx.splitType === 'OTHER') {
          if (tx.paidBy === p1) p2PriorSavings -= amt;
          else p1PriorSavings -= amt;
        } else {
          // SPLIT
          const pct = tx.splitPercentage != null ? tx.splitPercentage : 50;
          if (tx.paidBy === p1) {
            const p1s = parseFloat(((amt * pct) / 100).toFixed(2));
            p1PriorSavings -= p1s;
            p2PriorSavings -= parseFloat((amt - p1s).toFixed(2));
          } else {
            const p2s = parseFloat(((amt * pct) / 100).toFixed(2));
            p2PriorSavings -= p2s;
            p1PriorSavings -= parseFloat((amt - p2s).toFixed(2));
          }
        }
      }
    });

    const p1TotalCumulative = p1PriorSavings + p1MonthSaved;
    const p2TotalCumulative = p2PriorSavings + p2MonthSaved;

    return {
      p1: {
        name: p1,
        income: p1IncomeMonth,
        spentShare: p1SpentShareMonth,
        monthSaved: p1MonthSaved,
        priorSavings: p1PriorSavings,
        totalCumulative: p1TotalCumulative,
        thisMonthSettlementAdj: p1ThisMonthSettlementAdj,
        carryoverSettlementAdj: p1CarryoverSettlementAdj,
        totalSettlementAdj: p1TotalSettlementAdj,
        settlementAdj: p1ThisMonthSettlementAdj
      },
      p2: {
        name: p2,
        income: p2IncomeMonth,
        spentShare: p2SpentShareMonth,
        monthSaved: p2MonthSaved,
        priorSavings: p2PriorSavings,
        totalCumulative: p2TotalCumulative,
        thisMonthSettlementAdj: p2ThisMonthSettlementAdj,
        carryoverSettlementAdj: p2CarryoverSettlementAdj,
        totalSettlementAdj: p2TotalSettlementAdj,
        settlementAdj: p2ThisMonthSettlementAdj
      },
      totalSavingsMonth: p1MonthSaved + p2MonthSaved,
      totalSavingsCumulative: p1TotalCumulative + p2TotalCumulative
    };
  });

  // Category Expense Distribution Analytics
  public categoryBreakdown = computed(() => {
    const summaries = this.groupSummaries().filter(
      (g) => g.id !== 'grp-income' && !g.name.toLowerCase().includes('income')
    );
    const totalSpent = summaries.reduce((sum, g) => sum + g.actualTotal, 0);

    const colors = ['#00e5ff', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#6366f1', '#14b8a6'];

    return summaries.map((g, idx) => {
      const pct = totalSpent > 0 ? Math.round((g.actualTotal / totalSpent) * 100) : 0;
      return {
        name: g.name,
        icon: g.icon,
        actual: g.actualTotal,
        planned: g.plannedTotal,
        pct,
        color: colors[idx % colors.length]
      };
    }).sort((a, b) => b.actual - a.actual);
  });

  // 6-Month Historical Spending Trend
  public recentMonthlyTrends = computed(() => {
    const current = this.selectedMonth();
    const [currY, currM] = current.split('-').map(Number);
    const trends = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(currY, currM - 1 - i, 1);
      const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      
      let income = 0;
      let expense = 0;

      this.service.transactions().filter((t) => t.date.startsWith(mStr)).forEach((t) => {
        const isInc = (t.categoryGroup || '').toLowerCase().includes('income') || (t.categoryItem || '').toLowerCase().includes('salary');
        const amt = Number(t.amount) || 0;
        if (isInc) income += amt;
        else expense += amt;
      });

      trends.push({
        monthStr: mStr,
        label: this.service.formatMonth(mStr),
        income,
        expense
      });
    }

    return trends;
  });

  public updateItemPlanned(itemId: string, val: string | number): void {
    if (typeof val === 'string') {
      let cleaned = val.trim();
      if (cleaned.includes('.') && cleaned.includes(',')) {
        if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
          cleaned = cleaned.replace(/\./g, '').replace(',', '.');
        } else {
          cleaned = cleaned.replace(/,/g, '');
        }
      } else if (cleaned.includes(',')) {
        cleaned = cleaned.replace(',', '.');
      }
      const num = parseFloat(cleaned) || 0;
      this.service.updateBudgetPlanned(this.selectedMonth(), itemId, num);
    } else {
      this.service.updateBudgetPlanned(this.selectedMonth(), itemId, Number(val) || 0);
    }
  }
}
