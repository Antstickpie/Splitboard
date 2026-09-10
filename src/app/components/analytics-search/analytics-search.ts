import {
  Component,
  inject,
  signal,
  computed,
  ViewChild,
  ElementRef,
  HostListener,
  OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { AnalyticsNlpService, AnalyticsResult, DateRange, MonthBucket } from '../../services/analytics-nlp.service';
import { Transaction } from '../../models';

export type AuditSortField = 'date' | 'description' | 'category' | 'paidBy' | 'splitType' | 'amount';

@Component({
  selector: 'app-analytics-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './analytics-search.html',
  styleUrls: ['./analytics-search.css']
})
export class AnalyticsSearchComponent implements OnInit {
  public service = inject(TransactionService);
  public nlp = inject(AnalyticsNlpService);

  @ViewChild('queryInput') queryInputRef?: ElementRef<HTMLInputElement>;

  public searchQuery = signal<string>('');
  public result = signal<AnalyticsResult | null>(null);
  public isAuditOpen = signal<boolean>(false);

  // Table Sorting & Filtering
  public auditSortField = signal<AuditSortField>('date');
  public auditSortAsc = signal<boolean>(false);
  public auditSearch = signal<string>('');
  public auditPeriodFilter = signal<string>('ALL');
  public auditMonthFilter = signal<string>('ALL');
  public auditOwnerFilter = signal<string>('ALL');
  public auditSplitFilter = signal<string>('ALL');
  public auditCategoryFilter = signal<string>('ALL');

  // Comparison View Mode: multiple separate graphs vs paired comparison
  public comparisonViewMode = signal<'multiple' | 'paired'>('multiple');

  public setComparisonViewMode(mode: 'multiple' | 'paired'): void {
    this.comparisonViewMode.set(mode);
  }

  /**
   * Filter table below when clicking a graph card (period label).
   */
  public selectGraphPeriod(periodLabel: string): void {
    if (this.auditPeriodFilter() === periodLabel && this.auditMonthFilter() === 'ALL') {
      this.auditPeriodFilter.set('ALL');
    } else {
      this.auditPeriodFilter.set(periodLabel);
      this.auditMonthFilter.set('ALL');
      this.isAuditOpen.set(true);
    }
  }

  /**
   * Filter table below to a specific month when clicking a month bar.
   */
  public selectMonth(monthKey: string, periodLabel?: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    if (this.auditMonthFilter() === monthKey) {
      this.auditMonthFilter.set('ALL');
    } else {
      this.auditMonthFilter.set(monthKey);
      if (periodLabel) {
        this.auditPeriodFilter.set(periodLabel);
      }
      this.isAuditOpen.set(true);
    }
  }

  public isMonthGroupActive(m: { bars: Array<{ monthKey: string }> }): boolean {
    const activeM = this.auditMonthFilter();
    if (activeM === 'ALL') return false;
    return m.bars.some((b) => b.monthKey === activeM);
  }

  public formatMonthGroupTooltip(m: { monthLabel: string; bars: Array<{ periodLabel: string; total: number }> }): string {
    const parts = m.bars.map((b) => `${b.periodLabel}: ${this.service.formatCurrency(b.total)}`);
    return `${m.monthLabel} (${parts.join(' vs ')}) · Click a bar to filter`;
  }

  public selectMonthGroup(m: { bars: Array<{ monthKey: string; periodLabel: string }> }, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    const activeM = this.auditMonthFilter();
    if (m.bars.some((b) => b.monthKey === activeM)) {
      this.auditMonthFilter.set('ALL');
    } else {
      const primaryBar = m.bars[0];
      if (primaryBar) {
        this.selectMonth(primaryBar.monthKey, primaryBar.periodLabel, event);
      }
    }
  }

  public comparisonSubtitle = computed<string>(() => {
    const periods = this.allTrendPeriods();
    if (periods.length > 1) {
      return periods.map((p) => p.label).join(' vs ');
    }
    const res = this.result();
    if (!res) return '';
    return res.query.primaryRange.label;
  });

  // Dynamic starter queries built from live user categories and persons
  public starterPills = computed<string[]>(() => {
    const pills: string[] = [];
    const groups = this.service.categoryGroups();
    const persons = this.service.persons();
    const currentYear = new Date().getFullYear();
    const prevYear = currentYear - 1;

    // Pick top category if available
    const firstGroup = groups.length > 0 ? groups[0] : null;
    const firstItem = firstGroup && firstGroup.items.length > 0 ? firstGroup.items[0].name : 'Groceries';

    pills.push(`🥦 ${firstItem} this year`);
    pills.push(`📊 Compare ${prevYear} vs ${currentYear}`);
    pills.push(`🔝 Top 5 shared expenses`);
    pills.push(`⚡️ Average monthly spend`);

    if (persons.length > 0) {
      pills.push(`👤 Paid by ${persons[0].name}`);
    }

    return pills;
  });

  // Multi-period Trend Views
  public allTrendPeriods = computed<Array<{
    label: string;
    range: DateRange;
    total: number;
    count: number;
    monthlyBreakdown: MonthBucket[];
    isPrimary: boolean;
    colorClass: string;
    dotClass: string;
    borderClass: string;
  }>>(() => {
    const res = this.result();
    if (!res) return [];

    const periods: Array<{
      label: string;
      range: DateRange;
      total: number;
      count: number;
      monthlyBreakdown: MonthBucket[];
      isPrimary: boolean;
      colorClass: string;
      dotClass: string;
      borderClass: string;
    }> = [
      {
        label: res.query.primaryRange.label,
        range: res.query.primaryRange,
        total: res.primaryTotal,
        count: res.monthlyBreakdown.reduce((sum, b) => sum + b.count, 0),
        monthlyBreakdown: res.monthlyBreakdown,
        isPrimary: true,
        colorClass: 'bar-primary',
        dotClass: 'dot-primary',
        borderClass: 'active-card-primary'
      }
    ];

    const colors = ['bar-comparison', 'bar-comparison-2', 'bar-comparison-3', 'bar-comparison-4'];
    const dots = ['dot-comparison', 'dot-comparison-2', 'dot-comparison-3', 'dot-comparison-4'];
    const borders = ['active-card-comparison', 'active-card-comparison-2', 'active-card-comparison-3', 'active-card-comparison-4'];

    if (res.comparisonPeriods && res.comparisonPeriods.length > 0) {
      res.comparisonPeriods.forEach((cp, idx) => {
        const cIdx = idx % colors.length;
        periods.push({
          label: cp.range.label,
          range: cp.range,
          total: cp.total,
          count: cp.count,
          monthlyBreakdown: cp.monthlyBreakdown,
          isPrimary: false,
          colorClass: colors[cIdx],
          dotClass: dots[cIdx],
          borderClass: borders[cIdx]
        });
      });
    } else if (res.comparisonMonthlyBreakdown && res.query.comparisonRange) {
      periods.push({
        label: res.query.comparisonRange.label,
        range: res.query.comparisonRange,
        total: res.comparisonTotal || 0,
        count: res.comparisonCount || 0,
        monthlyBreakdown: res.comparisonMonthlyBreakdown,
        isPrimary: false,
        colorClass: 'bar-comparison',
        dotClass: 'dot-comparison',
        borderClass: 'active-card-comparison'
      });
    }

    return periods;
  });

  // Maximum monthly total across all comparison periods (for unified height scaling)
  public maxMonthlyTotal = computed<number>(() => {
    const periods = this.allTrendPeriods();
    if (periods.length === 0) return 1;
    let max = 0;
    for (const p of periods) {
      for (const b of p.monthlyBreakdown) {
        if (b.total > max) max = b.total;
      }
    }
    return max > 0 ? max : 1;
  });

  // Unique categories within current matched transactions
  public uniqueCategories = computed<string[]>(() => {
    const res = this.result();
    if (!res) return [];
    const set = new Set<string>();
    for (const t of res.matchedTransactions) {
      const cat = t.categoryItem || t.rawCategory || 'Uncategorized';
      set.add(cat);
    }
    return Array.from(set).sort();
  });

  // Unique owners within current matched transactions
  public uniqueOwners = computed<string[]>(() => {
    const res = this.result();
    if (!res) return [];
    const set = new Set<string>();
    for (const t of res.matchedTransactions) {
      if (t.paidBy) set.add(t.paidBy);
    }
    return Array.from(set).sort();
  });

  public hasActiveFilters = computed<boolean>(() => {
    return (
      this.auditSearch().trim() !== '' ||
      this.auditPeriodFilter() !== 'ALL' ||
      this.auditMonthFilter() !== 'ALL' ||
      this.auditOwnerFilter() !== 'ALL' ||
      this.auditSplitFilter() !== 'ALL' ||
      this.auditCategoryFilter() !== 'ALL'
    );
  });

  // Paired breakdown for unified multi-period comparison charts
  public pairedMonthGroups = computed<Array<{
    monthLabel: string;
    bars: Array<{
      periodLabel: string;
      monthLabel: string;
      monthKey: string;
      total: number;
      count: number;
      colorClass: string;
      range: DateRange;
    }>;
  }>>(() => {
    const periods = this.allTrendPeriods();
    if (periods.length <= 1) return [];

    const monthLabels = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const isStandardYear = periods.every((p) => p.monthlyBreakdown.length === 12);

    if (isStandardYear) {
      return monthLabels.map((mLbl, mIdx) => {
        const bars = periods.map((p) => {
          const mb = p.monthlyBreakdown[mIdx];
          return {
            periodLabel: p.label,
            monthLabel: mLbl,
            monthKey: mb?.month || '',
            total: mb?.total || 0,
            count: mb?.count || 0,
            colorClass: p.colorClass,
            range: p.range
          };
        });
        return {
          monthLabel: mLbl,
          bars
        };
      });
    }

    const maxLen = Math.max(...periods.map((p) => p.monthlyBreakdown.length));
    const result: Array<{
      monthLabel: string;
      bars: Array<{
        periodLabel: string;
        monthLabel: string;
        monthKey: string;
        total: number;
        count: number;
        colorClass: string;
        range: DateRange;
      }>;
    }> = [];

    for (let i = 0; i < maxLen; i++) {
      const sample = periods.find((p) => p.monthlyBreakdown[i]);
      const mLbl = sample ? sample.monthlyBreakdown[i].label.split(' ')[0] : `M${i + 1}`;
      const bars = periods.map((p) => {
        const mb = p.monthlyBreakdown[i];
        return {
          periodLabel: p.label,
          monthLabel: mLbl,
          monthKey: mb?.month || '',
          total: mb?.total || 0,
          count: mb?.count || 0,
          colorClass: p.colorClass,
          range: p.range
        };
      });
      result.push({
        monthLabel: mLbl,
        bars
      });
    }

    return result;
  });

  // Filtered and sorted transactions for the audit drawer
  public filteredAndSortedTransactions = computed<Transaction[]>(() => {
    const res = this.result();
    if (!res) return [];

    let list = [...res.matchedTransactions];

    // 0. Month Filter
    const mFilter = this.auditMonthFilter();
    if (mFilter !== 'ALL') {
      list = list.filter((t) => (t.date || '').startsWith(mFilter));
    } else {
      // Period Filter (for comparison queries)
      const period = this.auditPeriodFilter();
      if (period !== 'ALL') {
        const targetPeriod = this.allTrendPeriods().find((p) => p.label === period);
        if (targetPeriod) {
          list = list.filter((t) => {
            const d = (t.date || '').slice(0, 10);
            return d >= targetPeriod.range.start && d <= targetPeriod.range.end;
          });
        }
      }
    }

    // 1. Text Search Filter
    const q = this.auditSearch().toLowerCase().trim();
    if (q) {
      list = list.filter(
        (t) =>
          (t.description || '').toLowerCase().includes(q) ||
          (t.merchant || '').toLowerCase().includes(q) ||
          (t.categoryItem || '').toLowerCase().includes(q) ||
          (t.categoryGroup || '').toLowerCase().includes(q) ||
          (t.rawCategory || '').toLowerCase().includes(q) ||
          (t.note || '').toLowerCase().includes(q) ||
          (t.bank || '').toLowerCase().includes(q) ||
          String(t.amount).includes(q)
      );
    }

    // 2. Owner Filter
    const owner = this.auditOwnerFilter();
    if (owner !== 'ALL') {
      list = list.filter((t) => t.paidBy === owner);
    }

    // 3. Split Filter
    const split = this.auditSplitFilter();
    if (split !== 'ALL') {
      list = list.filter((t) => t.splitType === split);
    }

    // 4. Category Filter
    const cat = this.auditCategoryFilter();
    if (cat !== 'ALL') {
      list = list.filter((t) => (t.categoryItem || t.rawCategory || 'Uncategorized') === cat);
    }

    // 5. Sorting
    const field = this.auditSortField();
    const asc = this.auditSortAsc();

    return list.sort((a, b) => {
      let cmp = 0;
      if (field === 'date') {
        cmp = (a.date || '').localeCompare(b.date || '');
      } else if (field === 'description') {
        const descA = a.merchant || a.description || '';
        const descB = b.merchant || b.description || '';
        cmp = descA.localeCompare(descB);
      } else if (field === 'category') {
        const catA = a.categoryItem || a.rawCategory || 'Uncategorized';
        const catB = b.categoryItem || b.rawCategory || 'Uncategorized';
        cmp = catA.localeCompare(catB);
      } else if (field === 'paidBy') {
        cmp = (a.paidBy || '').localeCompare(b.paidBy || '');
      } else if (field === 'splitType') {
        cmp = (a.splitType || '').localeCompare(b.splitType || '');
      } else if (field === 'amount') {
        cmp = Math.abs(a.amount) - Math.abs(b.amount);
      }
      return asc ? cmp : -cmp;
    });
  });

  // Total sum of currently filtered transactions
  public filteredTransactionsTotal = computed<number>(() => {
    return this.filteredAndSortedTransactions().reduce((acc, t) => acc + Math.abs(t.amount), 0);
  });

  ngOnInit(): void {}

  public toggleSort(field: AuditSortField): void {
    if (this.auditSortField() === field) {
      this.auditSortAsc.update((v) => !v);
    } else {
      this.auditSortField.set(field);
      // Date and Amount default to descending (newest / biggest first); others to ascending (A-Z)
      this.auditSortAsc.set(field !== 'date' && field !== 'amount');
    }
  }

  public clearAuditFilters(): void {
    this.auditSearch.set('');
    this.auditPeriodFilter.set('ALL');
    this.auditMonthFilter.set('ALL');
    this.auditOwnerFilter.set('ALL');
    this.auditSplitFilter.set('ALL');
    this.auditCategoryFilter.set('ALL');
  }

  public onSearch(q?: string): void {
    const text = q !== undefined ? q : this.searchQuery();
    if (!text || !text.trim()) {
      this.result.set(null);
      return;
    }

    this.searchQuery.set(text);
    const ast = this.nlp.compile(text);
    const res = this.nlp.execute(ast);
    this.result.set(res);
    this.clearAuditFilters();
  }

  public runStarterQuery(q: string): void {
    const cleaned = q.replace(/^[\p{Emoji}\s]+/u, '').trim();
    this.searchQuery.set(cleaned);
    this.onSearch(cleaned);
  }

  public clearSearch(): void {
    this.searchQuery.set('');
    this.result.set(null);
    this.isAuditOpen.set(false);
    this.clearAuditFilters();
    this.queryInputRef?.nativeElement?.focus();
  }

  public toggleAudit(): void {
    this.isAuditOpen.update((v) => !v);
  }

  public focusSearchInput(): void {
    this.queryInputRef?.nativeElement?.focus();
  }

  @HostListener('window:keydown', ['$event'])
  public handleGlobalKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.focusSearchInput();
    }
  }

  public getBarHeight(total: number): number {
    if (!total || total <= 0) return 3;
    const max = this.maxMonthlyTotal();
    const pct = (total / max) * 100;
    return Math.max(6, Math.min(100, Math.round(pct)));
  }
}
