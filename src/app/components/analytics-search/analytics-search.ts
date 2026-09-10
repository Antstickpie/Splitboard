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
  public auditSort = signal<'date_desc' | 'amount_desc'>('date_desc');

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

  public sortedMatchedTransactions = computed<Transaction[]>(() => {
    const res = this.result();
    if (!res) return [];
    const list = [...res.matchedTransactions];
    if (this.auditSort() === 'amount_desc') {
      return list.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    }
    return list.sort((a, b) => b.date.localeCompare(a.date));
  });

  ngOnInit(): void {
    // If there is an existing starter search, don't execute automatically
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
  }

  public runStarterQuery(q: string): void {
    // Strip leading emoji if present e.g. "🥦 Groceries this year" -> "Groceries this year"
    const cleaned = q.replace(/^[\p{Emoji}\s]+/u, '').trim();
    this.searchQuery.set(cleaned);
    this.onSearch(cleaned);
  }

  public clearSearch(): void {
    this.searchQuery.set('');
    this.result.set(null);
    this.isAuditOpen.set(false);
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
