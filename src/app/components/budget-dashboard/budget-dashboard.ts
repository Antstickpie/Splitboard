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

  public selectedMonth = signal<string>(this.service.getCurrentMonthString());

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

  public updateItemPlanned(itemId: string, val: any) {
    const num = parseFloat(val) || 0;
    this.service.updateBudgetPlanned(this.selectedMonth(), itemId, num);
  }
}
