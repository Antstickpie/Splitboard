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
import { AnalyticsNlpService, AnalyticsResult, MonthBucket } from '../../services/analytics-nlp.service';
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
  public auditOwnerFilter = signal<string>('ALL');
  public auditSplitFilter = signal<string>('ALL');
  public auditCategoryFilter = signal<string>('ALL');

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

  // Maximum monthly total in current breakdown (for SVG/CSS bar chart height)
  public maxMonthlyTotal = computed<number>(() => {
    const res = this.result();
    if (!res || res.monthlyBreakdown.length === 0) return 1;
    let max = Math.max(...res.monthlyBreakdown.map((b) => b.total));
    if (res.comparisonMonthlyBreakdown && res.comparisonMonthlyBreakdown.length > 0) {
      const compMax = Math.max(...res.comparisonMonthlyBreakdown.map((b) => b.total));
      max = Math.max(max, compMax);
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
      this.auditOwnerFilter() !== 'ALL' ||
      this.auditSplitFilter() !== 'ALL' ||
      this.auditCategoryFilter() !== 'ALL'
    );
  });

  // Filtered and sorted transactions for the audit drawer
  public filteredAndSortedTransactions = computed<Transaction[]>(() => {
    const res = this.result();
    if (!res) return [];

    let list = [...res.matchedTransactions];

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
    const max = this.maxMonthlyTotal();
    const pct = (total / max) * 100;
    return Math.max(6, Math.min(100, Math.round(pct)));
  }
}
