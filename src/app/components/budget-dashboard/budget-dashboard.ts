import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { CategoryGroup, CategoryItem, Transaction } from '../../models';

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

  public selectedMonth = signal<string>(this.service.getCurrentMonthString());
  public isMonthPickerOpen = signal<boolean>(false);
  public pickerYear = signal<number>(new Date().getFullYear());
  public monthsList = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // EveryDollar Sidebar State
  public sidebarTab = signal<'summary' | 'transactions'>('summary');
  public transactionFilter = signal<'new' | 'tracked' | 'deleted'>('tracked');
  public sidebarSearch = signal<string>('');
  public viewMode = signal<'remaining' | 'spent'>('remaining');

  // Quick Add Item inline
  public activeAddingGroupId = signal<string | null>(null);
  public newCategoryItemName = signal<string>('');

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

  public toggleMonthPicker(): void {
    const [y] = this.selectedMonth().split('-').map(Number);
    if (!isNaN(y)) this.pickerYear.set(y);
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
    this.selectedMonth.set(mStr);
    this.service.selectedMonth.set(mStr);
    this.isMonthPickerOpen.set(false);
  }

  public goToToday(): void {
    const today = this.service.getCurrentMonthString();
    this.selectedMonth.set(today);
    this.service.selectedMonth.set(today);
    this.pickerYear.set(new Date().getFullYear());
    this.isMonthPickerOpen.set(false);
  }

  public isMonthSelected(monthIdx: number): boolean {
    const mStr = `${this.pickerYear()}-${String(monthIdx + 1).padStart(2, '0')}`;
    return this.selectedMonth() === mStr;
  }

  public hasMonthData(monthIdx: number): boolean {
    const mStr = `${this.pickerYear()}-${String(monthIdx + 1).padStart(2, '0')}`;
    return this.service.transactions().some((t) => t.date && t.date.startsWith(mStr));
  }

  // Sidebar Transactions
  public sidebarTransactions = computed(() => {
    const month = this.selectedMonth();
    const q = this.sidebarSearch().toLowerCase().trim();
    const filter = this.transactionFilter();

    let list = this.service.transactions().filter((t) => t.date && t.date.startsWith(month));

    if (filter === 'new') {
      list = list.filter((t) => !t.categoryItem || t.categoryItem === 'Uncategorized');
    } else if (filter === 'tracked') {
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

  // Planned vs Actual Budget Computation
  public groupSummaries = computed<CategoryGroupSummary[]>(() => {
    const month = this.selectedMonth();
    const plannedBudget = this.service.getBudgetForMonth(month);
    const txsInMonth = this.service.transactions().filter(
      (tx) => tx.date.startsWith(month)
    );

    // Compute actuals per category
    const actualsMap: Record<string, number> = {};
    txsInMonth.forEach((tx) => {
      if (tx.categoryItem) {
        actualsMap[tx.categoryItem] = (actualsMap[tx.categoryItem] || 0) + (Number(tx.amount) || 0);
      }
    });

    return this.service.categoryGroups().map((grp) => {
      let groupPlanned = 0;
      let groupActual = 0;

      const items = grp.items.map((item) => {
        const planned = plannedBudget[item.id] !== undefined ? plannedBudget[item.id] : (item.plannedDefault || 0);
        const actual = actualsMap[item.name] || 0;
        const remaining = planned - actual;
        const percentage = planned > 0 ? Math.min(100, Math.round((actual / planned) * 100)) : (actual > 0 ? 100 : 0);

        groupPlanned += planned;
        groupActual += actual;

        return {
          id: item.id,
          name: item.name,
          planned,
          actual,
          remaining,
          percentage,
          defaultOwner: item.defaultOwner
        };
      });

      return {
        id: grp.id,
        name: grp.name,
        icon: grp.icon || '📁',
        plannedTotal: groupPlanned,
        actualTotal: groupActual,
        remainingTotal: groupPlanned - groupActual,
        items
      };
    });
  });

  public budgetTotals = computed(() => {
    const summaries = this.groupSummaries();
    let totalIncomePlanned = 0;
    let totalIncomeActual = 0;
    let totalExpensePlanned = 0;
    let totalExpenseActual = 0;

    summaries.forEach((grp) => {
      if (grp.id === 'grp-income' || grp.name.toLowerCase().includes('income')) {
        totalIncomePlanned += grp.plannedTotal;
        totalIncomeActual += grp.actualTotal;
      } else {
        totalExpensePlanned += grp.plannedTotal;
        totalExpenseActual += grp.actualTotal;
      }
    });

    const netRemaining = totalIncomeActual - totalExpenseActual;
    const plannedRemaining = totalIncomePlanned - totalExpensePlanned;

    return {
      totalIncomePlanned,
      totalIncomeActual,
      totalExpensePlanned,
      totalExpenseActual,
      netRemaining,
      plannedRemaining
    };
  });

  public spendByPerson = computed(() => {
    const month = this.selectedMonth();
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;
    let p1Spend = 0;
    let p2Spend = 0;

    this.service.transactions().filter((tx) => tx.date.startsWith(month)).forEach((tx) => {
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
