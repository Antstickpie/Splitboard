import { Injectable, inject } from '@angular/core';
import { TransactionService } from './transaction.service';
import { Transaction } from '../models';

export type AggregationType =
  | 'SUM'
  | 'AVERAGE'
  | 'COUNT'
  | 'MONTHLY_BREAKDOWN'
  | 'TOP_N'
  | 'COMPARE_PERIODS';

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  label: string; // e.g. "Summer 2023", "2024", "Last Month"
}

export interface AnalyticsQueryAST {
  rawQuery: string;
  aggregation: AggregationType;
  primaryRange: DateRange;
  comparisonRange?: DateRange;
  filters: {
    categoryGroup?: string;
    categoryItem?: string;
    merchant?: string;
    person?: string;
    splitType?: 'SELF' | 'OTHER' | 'SPLIT';
    minAmount?: number;
    maxAmount?: number;
    type?: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  };
  topLimit?: number;
}

export interface MonthBucket {
  month: string; // YYYY-MM
  label: string; // e.g. "Jun 2023"
  total: number;
  count: number;
}

export interface AnalyticsResult {
  query: AnalyticsQueryAST;
  primaryTotal: number;
  transactionCount: number;
  averagePerMonth?: number;
  matchedTransactions: Transaction[];
  monthlyBreakdown: MonthBucket[];
  comparisonTotal?: number;
  comparisonCount?: number;
  comparisonMonthlyBreakdown?: MonthBucket[];
  percentageChange?: number;
  diffAmount?: number;
  suggestedFollowUps: string[];
  resolvedDescription: string;
}

@Injectable({
  providedIn: 'root'
})
export class AnalyticsNlpService {
  private service = inject(TransactionService);

  private readonly MONTH_NAMES = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];

  private readonly MONTH_SHORT = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
  ];

  /**
   * Common synonym mappings to help match plain conversational terms
   * to typical category groups or items.
   */
  private readonly CATEGORY_SYNONYMS: Record<string, string[]> = {
    groceries: ['groceries', 'supermarket', 'food shopping', 'grocery', 'produce'],
    dining: ['dining', 'restaurant', 'restaurants', 'eating out', 'takeout', 'food delivery', 'ubereats', 'deliveroo', 'doordash', 'cafe', 'coffee'],
    utilities: ['utilities', 'electricity', 'power', 'electric', 'gas & electric', 'water', 'internet', 'wifi', 'heating'],
    housing: ['rent', 'mortgage', 'housing', 'apartment', 'home'],
    transport: ['transport', 'transit', 'train', 'bus', 'metro', 'subway', 'fuel', 'gas', 'gasoline', 'petrol', 'parking', 'toll', 'uber', 'taxi'],
    travel: ['travel', 'vacation', 'holiday', 'trip', 'trips', 'flights', 'flight', 'hotel', 'airbnb'],
    subscriptions: ['subscription', 'subscriptions', 'netflix', 'spotify', 'prime', 'youtube', 'apple', 'icloud', 'disney'],
    entertainment: ['entertainment', 'movies', 'cinema', 'games', 'gaming', 'concerts', 'theatre', 'hobbies'],
    shopping: ['shopping', 'clothing', 'clothes', 'electronics', 'furniture', 'amazon'],
    health: ['health', 'medical', 'pharmacy', 'medicine', 'doctor', 'dentist', 'fitness', 'gym'],
    pets: ['pet', 'pets', 'dog', 'cat', 'vet', 'veterinary'],
    income: ['salary', 'paycheck', 'income', 'wage', 'earnings', 'bonus']
  };

  /**
   * Parses natural language query into a structured query AST.
   */
  public compile(rawQuery: string): AnalyticsQueryAST {
    const q = rawQuery.trim().toLowerCase();
    const now = new Date();
    const currentYear = now.getFullYear();

    // 1. Check for Comparison Intent ("X vs Y", "compare X and Y", "compare X to Y")
    const comparisonParsed = this.parseComparisonPeriods(q, currentYear);
    if (comparisonParsed) {
      const filters = this.extractFilters(comparisonParsed.remainingQuery);
      return {
        rawQuery,
        aggregation: 'COMPARE_PERIODS',
        primaryRange: comparisonParsed.primary,
        comparisonRange: comparisonParsed.secondary,
        filters,
        topLimit: undefined
      };
    }

    // 2. Detect Aggregation Intent
    let aggregation: AggregationType = 'SUM';
    let topLimit: number | undefined = undefined;

    const topMatch = q.match(/\btop\s+(\d+)\b/i) || q.match(/\b(\d+)\s+(?:largest|biggest|highest|most expensive)\b/i);
    if (topMatch) {
      aggregation = 'TOP_N';
      topLimit = parseInt(topMatch[1], 10);
    } else if (/\b(?:largest|biggest|highest|most expensive)\b/i.test(q)) {
      aggregation = 'TOP_N';
      topLimit = 5;
    } else if (/\b(?:average|avg|per month|monthly average|mean)\b/i.test(q)) {
      aggregation = 'AVERAGE';
    } else if (/\b(?:how many|count of|number of transactions|count)\b/i.test(q)) {
      aggregation = 'COUNT';
    } else if (/\b(?:monthly breakdown|by month|month by month|trends|trend)\b/i.test(q)) {
      aggregation = 'MONTHLY_BREAKDOWN';
    }

    // 3. Extract Date Range
    const { range, cleanedQuery } = this.extractDateRange(q, currentYear);

    // 4. Extract Filters (Categories, Persons, Splits, Amounts, Merchants)
    const filters = this.extractFilters(cleanedQuery);

    return {
      rawQuery,
      aggregation,
      primaryRange: range,
      filters,
      topLimit
    };
  }

  /**
   * Executes the AST deterministically over in-memory transactions.
   */
  public execute(ast: AnalyticsQueryAST): AnalyticsResult {
    const allTxs = this.service.transactions();

    // 1. Primary execution
    const matched = this.filterTransactions(allTxs, ast.filters, ast.primaryRange);

    // Sort order
    if (ast.aggregation === 'TOP_N') {
      matched.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    } else {
      matched.sort((a, b) => b.date.localeCompare(a.date));
    }

    const primaryTotal = matched.reduce((acc, t) => acc + Math.abs(t.amount), 0);
    const transactionCount = matched.length;

    // Monthly breakdown
    const monthlyBreakdown = this.computeMonthlyBreakdown(matched, ast.primaryRange);

    // Compute average per month
    const monthsCount = Math.max(1, monthlyBreakdown.length);
    const averagePerMonth = Math.round((primaryTotal / monthsCount) * 100) / 100;

    // 2. Comparison execution (if applicable)
    let comparisonTotal: number | undefined = undefined;
    let comparisonCount: number | undefined = undefined;
    let comparisonMonthlyBreakdown: MonthBucket[] | undefined = undefined;
    let percentageChange: number | undefined = undefined;
    let diffAmount: number | undefined = undefined;
    let allMatched = matched;

    if (ast.comparisonRange) {
      const compMatched = this.filterTransactions(allTxs, ast.filters, ast.comparisonRange);
      comparisonTotal = compMatched.reduce((acc, t) => acc + Math.abs(t.amount), 0);
      comparisonCount = compMatched.length;
      comparisonMonthlyBreakdown = this.computeMonthlyBreakdown(compMatched, ast.comparisonRange);

      diffAmount = Math.round((primaryTotal - comparisonTotal) * 100) / 100;
      if (comparisonTotal > 0) {
        percentageChange = Math.round(((primaryTotal - comparisonTotal) / comparisonTotal) * 1000) / 10;
      }
      allMatched = [...matched, ...compMatched].sort((a, b) => b.date.localeCompare(a.date));
    }

    const totalCount = ast.comparisonRange ? allMatched.length : transactionCount;

    // Generate smart follow-up suggestions
    const suggestedFollowUps = this.generateFollowUps(ast);

    // Readable interpretation
    const resolvedDescription = this.formatInterpretation(ast, totalCount);

    return {
      query: ast,
      primaryTotal: Math.round(primaryTotal * 100) / 100,
      transactionCount: totalCount,
      averagePerMonth,
      matchedTransactions: ast.topLimit ? allMatched.slice(0, ast.topLimit) : allMatched,
      monthlyBreakdown,
      comparisonTotal,
      comparisonCount,
      comparisonMonthlyBreakdown,
      percentageChange,
      diffAmount,
      suggestedFollowUps,
      resolvedDescription
    };
  }

  /**
   * Filter transactions against query filters and date range.
   */
  private filterTransactions(
    transactions: Transaction[],
    filters: AnalyticsQueryAST['filters'],
    range: DateRange
  ): Transaction[] {
    return transactions.filter((t) => {
      // 1. Date range (normalize to YYYY-MM-DD)
      const tDate = (t.date || '').slice(0, 10);
      if (tDate < range.start || tDate > range.end) return false;

      // 2. Type (Expense vs Income)
      const targetType = filters.type || 'EXPENSE';
      if (t.type !== targetType) return false;

      // 3. Category Item & Group
      if (filters.categoryItem) {
        const itm = (t.categoryItem || '').toLowerCase();
        const raw = (t.rawCategory || '').toLowerCase();
        const desc = (t.description || '').toLowerCase();
        const merch = (t.merchant || '').toLowerCase();
        const target = filters.categoryItem.toLowerCase();
        if (!itm.includes(target) && !raw.includes(target) && !desc.includes(target) && !merch.includes(target)) {
          return false;
        }
      } else if (filters.categoryGroup) {
        const grp = (t.categoryGroup || '').toLowerCase();
        const itm = (t.categoryItem || '').toLowerCase();
        const raw = (t.rawCategory || '').toLowerCase();
        const desc = (t.description || '').toLowerCase();
        const target = filters.categoryGroup.toLowerCase();
        if (!grp.includes(target) && !itm.includes(target) && !raw.includes(target) && !desc.includes(target)) {
          return false;
        }
      }

      // 4. Person
      if (filters.person) {
        if ((t.paidBy || '').toLowerCase() !== filters.person.toLowerCase()) return false;
      }

      // 5. Split Type
      if (filters.splitType) {
        if (t.splitType !== filters.splitType) return false;
      }

      // 6. Merchant / Keyword search in description, note, and rawCategory
      if (filters.merchant) {
        const m = filters.merchant.toLowerCase();
        const desc = (t.description || '').toLowerCase();
        const merch = (t.merchant || '').toLowerCase();
        const note = (t.note || '').toLowerCase();
        const raw = (t.rawCategory || '').toLowerCase();
        const itm = (t.categoryItem || '').toLowerCase();
        if (!desc.includes(m) && !merch.includes(m) && !note.includes(m) && !raw.includes(m) && !itm.includes(m)) {
          return false;
        }
      }

      // 7. Amount Bounds
      const amt = Math.abs(t.amount);
      if (filters.minAmount !== undefined && amt < filters.minAmount) return false;
      if (filters.maxAmount !== undefined && amt > filters.maxAmount) return false;

      return true;
    });
  }

  /**
   * Groups transactions into month buckets.
   * Pre-populates all calendar months within the requested range so empty months are not skipped.
   */
  private computeMonthlyBreakdown(transactions: Transaction[], range: DateRange): MonthBucket[] {
    const map = new Map<string, { total: number; count: number }>();

    // Pre-populate all months in the date range if range is multi-month (up to 36 months)
    const startY = parseInt(range.start.slice(0, 4), 10);
    const startM = parseInt(range.start.slice(5, 7), 10);
    const endY = parseInt(range.end.slice(0, 4), 10);
    const endM = parseInt(range.end.slice(5, 7), 10);

    const totalMonths = (endY - startY) * 12 + (endM - startM) + 1;
    if (totalMonths > 1 && totalMonths <= 36) {
      let curY = startY;
      let curM = startM;
      while (curY < endY || (curY === endY && curM <= endM)) {
        const k = `${curY}-${String(curM).padStart(2, '0')}`;
        map.set(k, { total: 0, count: 0 });
        curM++;
        if (curM > 12) {
          curM = 1;
          curY++;
        }
      }
    }

    for (const t of transactions) {
      const monthKey = (t.date || '').slice(0, 7); // YYYY-MM
      if (!monthKey || monthKey.length !== 7) continue;
      const current = map.get(monthKey) || { total: 0, count: 0 };
      current.total += Math.abs(t.amount);
      current.count += 1;
      map.set(monthKey, current);
    }

    // Sort chronologically
    const sortedKeys = Array.from(map.keys()).sort();
    return sortedKeys.map((k) => {
      const [year, month] = k.split('-');
      const monthIndex = parseInt(month, 10) - 1;
      const label = `${this.MONTH_SHORT[monthIndex]?.toUpperCase() || month} ${year}`;
      const data = map.get(k)!;
      return {
        month: k,
        label,
        total: Math.round(data.total * 100) / 100,
        count: data.count
      };
    });
  }

  /**
   * Parse comparison queries like "2023 vs 2024", "summer 2023 vs summer 2024",
   * or "compare dining out between last year and this year".
   */
  private parseComparisonPeriods(
    q: string,
    currentYear: number
  ): { primary: DateRange; secondary: DateRange; remainingQuery: string } | null {
    // 1. "X vs Y" or "X versus Y"
    const vsMatch = q.match(/^(.*?)\b(?:vs\.?|versus)\b(.*?)$/i);
    if (vsMatch) {
      const partA = vsMatch[1].trim();
      const partB = vsMatch[2].trim();

      const rA = this.parseDateToken(partA, currentYear);
      const rB = this.parseDateToken(partB, currentYear);

      if (rA.range && rB.range) {
        const remaining = `${rA.cleaned} ${rB.cleaned}`.trim();
        // Typically primary is the newer/target period and secondary is baseline
        if (rA.range.start > rB.range.start) {
          return { primary: rA.range, secondary: rB.range, remainingQuery: remaining };
        } else {
          return { primary: rB.range, secondary: rA.range, remainingQuery: remaining };
        }
      }
    }

    // 2. "compare X and Y" / "compare X with Y"
    const compareMatch = q.match(/\bcompare\b(.*?)\b(?:and|with|to)\b(.*?)$/i);
    if (compareMatch) {
      const partA = compareMatch[1].trim();
      const partB = compareMatch[2].trim();

      const rA = this.parseDateToken(partA, currentYear);
      const rB = this.parseDateToken(partB, currentYear);

      if (rA.range && rB.range) {
        const remaining = `${rA.cleaned} ${rB.cleaned}`.trim();
        if (rA.range.start > rB.range.start) {
          return { primary: rA.range, secondary: rB.range, remainingQuery: remaining };
        } else {
          return { primary: rB.range, secondary: rA.range, remainingQuery: remaining };
        }
      }
    }

    return null;
  }

  /**
   * Extracts date tokens and resolves to a DateRange.
   */
  private parseDateToken(str: string, currentYear: number): { range: DateRange | null; cleaned: string } {
    const s = str.trim();

    // 1. Specific Month + Year: "March 2023", "2025 Jan", "2025-01"
    for (let mIdx = 0; mIdx < 12; mIdx++) {
      const longName = this.MONTH_NAMES[mIdx];
      const shortName = this.MONTH_SHORT[mIdx];
      const mStr = String(mIdx + 1).padStart(2, '0');

      const ymPattern = new RegExp(`\\b(20\\d\\d)[-\\s/,]+(?:in\\s+)?(?:${longName}|${shortName})\\b`, 'i');
      const myPattern = new RegExp(`\\b(?:in\\s+)?(?:${longName}|${shortName})[-\\s/,]+(20\\d\\d)\\b`, 'i');
      const numPattern = new RegExp(`\\b(20\\d\\d)[-/]0?${mIdx + 1}\\b`, 'i');

      const match = s.match(ymPattern) || s.match(myPattern) || s.match(numPattern);
      if (match) {
        const yr = parseInt(match[1], 10);
        const lastDay = new Date(yr, mIdx + 1, 0).getDate();
        return {
          range: {
            start: `${yr}-${mStr}-01`,
            end: `${yr}-${mStr}-${String(lastDay).padStart(2, '0')}`,
            label: `${this.capitalize(longName)} ${yr}`
          },
          cleaned: s.replace(match[0], '').trim()
        };
      }
    }

    // 2. Relative months: "this month", "last month"
    if (s.includes('this month')) {
      const d = new Date();
      const mStr = String(d.getMonth() + 1).padStart(2, '0');
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      return {
        range: {
          start: `${d.getFullYear()}-${mStr}-01`,
          end: `${d.getFullYear()}-${mStr}-${String(lastDay).padStart(2, '0')}`,
          label: 'This Month'
        },
        cleaned: s.replace('this month', '').trim()
      };
    }
    if (s.includes('last month')) {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      const yr = d.getFullYear();
      const mStr = String(d.getMonth() + 1).padStart(2, '0');
      const lastDay = new Date(yr, d.getMonth() + 1, 0).getDate();
      return {
        range: {
          start: `${yr}-${mStr}-01`,
          end: `${yr}-${mStr}-${String(lastDay).padStart(2, '0')}`,
          label: 'Last Month'
        },
        cleaned: s.replace('last month', '').trim()
      };
    }

    // 3. Season tokens e.g. "summer 2023", "2023 summer"
    const season = this.matchSeason(s, currentYear);
    if (season) return season;

    // 4. Relative: "this year", "last year"
    if (s.includes('this year')) {
      return {
        range: {
          start: `${currentYear}-01-01`,
          end: `${currentYear}-12-31`,
          label: `${currentYear}`
        },
        cleaned: s.replace('this year', '').trim()
      };
    }
    if (s.includes('last year')) {
      const yr = currentYear - 1;
      return {
        range: {
          start: `${yr}-01-01`,
          end: `${yr}-12-31`,
          label: `${yr}`
        },
        cleaned: s.replace('last year', '').trim()
      };
    }

    // 5. 4-digit year: "2023"
    const yearMatch = s.match(/\b(20\d\d)\b/);
    if (yearMatch) {
      const yr = parseInt(yearMatch[1], 10);
      return {
        range: {
          start: `${yr}-01-01`,
          end: `${yr}-12-31`,
          label: `${yr}`
        },
        cleaned: s.replace(yearMatch[0], '').trim()
      };
    }

    return { range: null, cleaned: str };
  }

  /**
   * Extracts single date range from query string.
   */
  private extractDateRange(query: string, currentYear: number): { range: DateRange; cleanedQuery: string } {
    let q = query;
    const now = new Date();

    // 1. "all time" or "ever"
    if (/\b(?:all time|all-time|ever|entire history)\b/i.test(q)) {
      return {
        range: {
          start: '2000-01-01',
          end: '2099-12-31',
          label: 'All Time'
        },
        cleanedQuery: q.replace(/\b(?:all time|all-time|ever|entire history)\b/gi, '').trim()
      };
    }

    // 2. Relative: "last N months" / "past N months"
    const pastNMonthsMatch = q.match(/\b(?:last|past)\s+(\d+)\s+months\b/i);
    if (pastNMonthsMatch) {
      const n = parseInt(pastNMonthsMatch[1], 10);
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - n);
      return {
        range: {
          start: this.formatDate(startDate),
          end: this.formatDate(endDate),
          label: `Last ${n} Months`
        },
        cleanedQuery: q.replace(pastNMonthsMatch[0], '').trim()
      };
    }

    // 3. "this month"
    if (/\bthis month\b/i.test(q)) {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
      return {
        range: {
          start: `${y}-${m}-01`,
          end: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
          label: 'This Month'
        },
        cleanedQuery: q.replace(/\bthis month\b/gi, '').trim()
      };
    }

    // 4. "last month"
    if (/\blast month\b/i.test(q)) {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
      return {
        range: {
          start: `${y}-${m}-01`,
          end: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
          label: 'Last Month'
        },
        cleanedQuery: q.replace(/\blast month\b/gi, '').trim()
      };
    }

    // 5. "last summer", "summer 2023", etc.
    const season = this.matchSeason(q, currentYear);
    if (season && season.range) {
      return {
        range: season.range,
        cleanedQuery: season.cleaned
      };
    }

    // 6. Quarters: "Q1 2024", "Q2", "Q3 2023"
    const qMatch = q.match(/\bq([1-4])(?:\s+(20\d\d))?\b/i);
    if (qMatch) {
      const qNum = parseInt(qMatch[1], 10);
      const qYear = qMatch[2] ? parseInt(qMatch[2], 10) : currentYear;
      const startMonth = (qNum - 1) * 3 + 1;
      const endMonth = startMonth + 2;
      const lastDay = new Date(qYear, endMonth, 0).getDate();
      return {
        range: {
          start: `${qYear}-${String(startMonth).padStart(2, '0')}-01`,
          end: `${qYear}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
          label: `Q${qNum} ${qYear}`
        },
        cleanedQuery: q.replace(qMatch[0], '').trim()
      };
    }

    // 7. Specific Month + Year: "March 2023", "2025 Jan", "2025 January", "2025-01"
    for (let mIdx = 0; mIdx < 12; mIdx++) {
      const longName = this.MONTH_NAMES[mIdx];
      const shortName = this.MONTH_SHORT[mIdx];
      const mStr = String(mIdx + 1).padStart(2, '0');

      // Check Year Month ("2025 Jan", "2025 January", "2025-Jan", "2025/Jan", "2025, Jan")
      const ymPattern = new RegExp(`\\b(20\\d\\d)[-\\s/,]+(?:in\\s+)?(?:${longName}|${shortName})\\b`, 'i');
      const ymMatch = q.match(ymPattern);
      if (ymMatch) {
        const yr = parseInt(ymMatch[1], 10);
        const lastDay = new Date(yr, mIdx + 1, 0).getDate();
        return {
          range: {
            start: `${yr}-${mStr}-01`,
            end: `${yr}-${mStr}-${String(lastDay).padStart(2, '0')}`,
            label: `${this.capitalize(longName)} ${yr}`
          },
          cleanedQuery: q.replace(ymMatch[0], '').trim()
        };
      }

      // Check Month Year ("Jan 2025", "in March 2023", "March, 2023")
      const myPattern = new RegExp(`\\b(?:in\\s+)?(?:${longName}|${shortName})[-\\s/,]+(20\\d\\d)\\b`, 'i');
      const myMatch = q.match(myPattern);
      if (myMatch) {
        const yr = parseInt(myMatch[1], 10);
        const lastDay = new Date(yr, mIdx + 1, 0).getDate();
        return {
          range: {
            start: `${yr}-${mStr}-01`,
            end: `${yr}-${mStr}-${String(lastDay).padStart(2, '0')}`,
            label: `${this.capitalize(longName)} ${yr}`
          },
          cleanedQuery: q.replace(myMatch[0], '').trim()
        };
      }

      // Check Numeric Year-Month ("2025-01", "2025/01")
      const numPattern = new RegExp(`\\b(20\\d\\d)[-/]0?${mIdx + 1}\\b`, 'i');
      const numMatch = q.match(numPattern);
      if (numMatch) {
        const yr = parseInt(numMatch[1], 10);
        const lastDay = new Date(yr, mIdx + 1, 0).getDate();
        return {
          range: {
            start: `${yr}-${mStr}-01`,
            end: `${yr}-${mStr}-${String(lastDay).padStart(2, '0')}`,
            label: `${this.capitalize(longName)} ${yr}`
          },
          cleanedQuery: q.replace(numMatch[0], '').trim()
        };
      }
    }

    // 8. Month without year (e.g. "in March", "last July")
    for (let mIdx = 0; mIdx < 12; mIdx++) {
      const longName = this.MONTH_NAMES[mIdx];
      const shortName = this.MONTH_SHORT[mIdx];
      const pattern = new RegExp(`\\b(?:in\\s+|last\\s+)?(?:${longName}|${shortName})\\b`, 'i');
      const match = q.match(pattern);
      if (match) {
        // If the month is in the future this year, assume last year
        let yr = currentYear;
        if (mIdx > now.getMonth()) {
          yr = currentYear - 1;
        }
        const mStr = String(mIdx + 1).padStart(2, '0');
        const lastDay = new Date(yr, mIdx + 1, 0).getDate();
        return {
          range: {
            start: `${yr}-${mStr}-01`,
            end: `${yr}-${mStr}-${String(lastDay).padStart(2, '0')}`,
            label: `${this.capitalize(longName)} ${yr}`
          },
          cleanedQuery: q.replace(match[0], '').trim()
        };
      }
    }

    // 9. Specific Year: "in 2023", "during 2024", "2023"
    const yearMatch = q.match(/\b(?:in\s+|during\s+)?(20\d\d)\b/);
    if (yearMatch) {
      const yr = parseInt(yearMatch[1], 10);
      return {
        range: {
          start: `${yr}-01-01`,
          end: `${yr}-12-31`,
          label: `${yr}`
        },
        cleanedQuery: q.replace(yearMatch[0], '').trim()
      };
    }

    // 10. "this year" / "last year"
    if (/\bthis year\b/i.test(q)) {
      return {
        range: {
          start: `${currentYear}-01-01`,
          end: `${currentYear}-12-31`,
          label: `${currentYear}`
        },
        cleanedQuery: q.replace(/\bthis year\b/gi, '').trim()
      };
    }
    if (/\blast year\b/i.test(q)) {
      const yr = currentYear - 1;
      return {
        range: {
          start: `${yr}-01-01`,
          end: `${yr}-12-31`,
          label: `${yr}`
        },
        cleanedQuery: q.replace(/\blast year\b/gi, '').trim()
      };
    }

    // Default: Entire current year or all-time if no dates specified
    return {
      range: {
        start: `${currentYear}-01-01`,
        end: `${currentYear}-12-31`,
        label: `${currentYear}`
      },
      cleanedQuery: q
    };
  }

  /**
   * Helper to match season keywords.
   */
  private matchSeason(str: string, currentYear: number): { range: DateRange; cleaned: string } | null {
    // 1. Year Season: "2025 summer", "2024 winter"
    const yrSeasonRegex = /\b(20\d\d)\s+(summer|fall|autumn|winter|spring)\b/i;
    const yrMatch = str.match(yrSeasonRegex);
    if (yrMatch) {
      const yr = parseInt(yrMatch[1], 10);
      const seasonName = yrMatch[2].toLowerCase();
      return this.buildSeasonRange(seasonName, yr, str, yrMatch[0]);
    }

    // 2. Season Year or relative: "summer 2025", "last summer", "summer"
    const seasonRegex = /\b(last\s+)?(summer|fall|autumn|winter|spring)(?:\s+(20\d\d))?\b/i;
    const match = str.match(seasonRegex);
    if (!match) return null;

    const isLast = !!match[1];
    const seasonName = match[2].toLowerCase();
    let yr = match[3] ? parseInt(match[3], 10) : currentYear;
    if (isLast && !match[3]) {
      yr = currentYear - 1;
    }

    return this.buildSeasonRange(seasonName, yr, str, match[0]);
  }

  private buildSeasonRange(
    seasonName: string,
    yr: number,
    originalStr: string,
    matchedStr: string
  ): { range: DateRange; cleaned: string } {
    let start = '';
    let end = '';
    let label = '';

    if (seasonName === 'summer') {
      start = `${yr}-06-01`;
      end = `${yr}-08-31`;
      label = `Summer ${yr}`;
    } else if (seasonName === 'fall' || seasonName === 'autumn') {
      start = `${yr}-09-01`;
      end = `${yr}-11-30`;
      label = `Fall ${yr}`;
    } else if (seasonName === 'winter') {
      const nextYr = yr + 1;
      const leap = (nextYr % 4 === 0 && nextYr % 100 !== 0) || nextYr % 400 === 0;
      start = `${yr}-12-01`;
      end = `${nextYr}-02-${leap ? '29' : '28'}`;
      label = `Winter ${yr}/${nextYr}`;
    } else if (seasonName === 'spring') {
      start = `${yr}-03-01`;
      end = `${yr}-05-31`;
      label = `Spring ${yr}`;
    }

    return {
      range: { start, end, label },
      cleaned: originalStr.replace(matchedStr, '').trim()
    };
  }

  /**
   * Extracts filter entities (Category, Person, Split, Merchant, Amount bounds).
   */
  private extractFilters(cleanedQuery: string): AnalyticsQueryAST['filters'] {
    let q = cleanedQuery.toLowerCase();
    const filters: AnalyticsQueryAST['filters'] = {};

    // 1. Transaction Type (Income vs Expense)
    if (/\b(?:income|salary|deposit|incomes|earnings)\b/i.test(q)) {
      filters.type = 'INCOME';
      q = q.replace(/\b(?:income|salary|deposit|incomes|earnings)\b/gi, '').trim();
    } else {
      filters.type = 'EXPENSE';
    }

    // 2. Split Type ("shared", "split", "50/50")
    if (/\b(?:shared|split|50\/50)\b/i.test(q)) {
      filters.splitType = 'SPLIT';
      q = q.replace(/\b(?:shared|split|50\/50)\b/gi, '').trim();
    }

    // 3. Person Matching
    const persons = this.service.persons();
    for (const p of persons) {
      const pName = p.name.toLowerCase();
      // Match "paid by X", "for X", "X paid", "X's", or isolated name
      const pPattern = new RegExp(`\\b(?:paid by\\s+|by\\s+|for\\s+)?(${pName})(?:'s)?\\b`, 'i');
      if (pPattern.test(q)) {
        filters.person = p.name;
        q = q.replace(pPattern, '').trim();
        break;
      }
    }

    // 4. Amount Constraints ("over 100", "more than €50", "under 20", "between 50 and 100")
    const betweenMatch = q.match(/\bbetween\s+[€$£]?\s*(\d+)\s+and\s+[€$£]?\s*(\d+)\b/i);
    if (betweenMatch) {
      filters.minAmount = parseInt(betweenMatch[1], 10);
      filters.maxAmount = parseInt(betweenMatch[2], 10);
      q = q.replace(betweenMatch[0], '').trim();
    } else {
      const overMatch = q.match(/\b(?:over|above|more than|>)\s+[€$£]?\s*(\d+)\b/i);
      if (overMatch) {
        filters.minAmount = parseInt(overMatch[1], 10);
        q = q.replace(overMatch[0], '').trim();
      }
      const underMatch = q.match(/\b(?:under|below|less than|<)\s+[€$£]?\s*(\d+)\b/i);
      if (underMatch) {
        filters.maxAmount = parseInt(underMatch[1], 10);
        q = q.replace(underMatch[0], '').trim();
      }
    }

    // 5. Category Item & Group matching
    const groups = this.service.categoryGroups();
    let categoryMatched = false;

    // Check exact or substring matches against live category items
    for (const g of groups) {
      for (const item of g.items) {
        const itmName = item.name.toLowerCase();
        if (itmName.length >= 3 && new RegExp(`\\b${itmName}\\b`, 'i').test(q)) {
          filters.categoryItem = item.name;
          q = q.replace(new RegExp(`\\b${itmName}\\b`, 'gi'), '').trim();
          categoryMatched = true;
          break;
        }
      }
      if (categoryMatched) break;
    }

    // Check category groups
    if (!categoryMatched) {
      for (const g of groups) {
        const grpName = g.name.toLowerCase();
        if (grpName.length >= 3 && new RegExp(`\\b${grpName}\\b`, 'i').test(q)) {
          filters.categoryGroup = g.name;
          q = q.replace(new RegExp(`\\b${grpName}\\b`, 'gi'), '').trim();
          categoryMatched = true;
          break;
        }
      }
    }

    // Check common conversational synonyms (e.g. "groceries", "dining out", "power")
    if (!categoryMatched) {
      for (const [key, synonyms] of Object.entries(this.CATEGORY_SYNONYMS)) {
        for (const syn of synonyms) {
          if (new RegExp(`\\b${syn}\\b`, 'i').test(q)) {
            // Find best matching category in user's groups
            const found = this.findCategoryBySynonym(syn, groups);
            if (found) {
              if (found.item) {
                filters.categoryItem = found.item;
              } else if (found.group) {
                filters.categoryGroup = found.group;
              }
              categoryMatched = true;
            } else {
              // Set search merchant/keyword to the synonym
              filters.merchant = syn;
            }
            q = q.replace(new RegExp(`\\b${syn}\\b`, 'gi'), '').trim();
            break;
          }
        }
        if (categoryMatched) break;
      }
    }

    // 6. Remaining words: if not noise words, treat as merchant keyword search
    const noiseWords = new RegExp(
      '\\b(?:how|much|did|we|i|spend|spent|on|in|total|cost|costs|what|were|our|the|all|show|me|find|all|for|of|a|an|transactions|transaction|expenses|expense)\\b',
      'gi'
    );
    const residual = q.replace(noiseWords, '').trim().replace(/\s+/g, ' ');
    if (residual && residual.length >= 2 && !filters.categoryItem && !filters.categoryGroup && !filters.merchant) {
      filters.merchant = residual;
    }

    return filters;
  }

  /**
   * Finds matching category item or group from synonym.
   */
  private findCategoryBySynonym(
    syn: string,
    groups: any[]
  ): { item?: string; group?: string } | null {
    const s = syn.toLowerCase();

    // Look for exact item match
    for (const g of groups) {
      const matchItem = g.items.find((i: any) =>
        i.name.toLowerCase().includes(s) || s.includes(i.name.toLowerCase())
      );
      if (matchItem) {
        return { item: matchItem.name, group: g.name };
      }
    }

    // Look for group match
    for (const g of groups) {
      if (g.name.toLowerCase().includes(s) || s.includes(g.name.toLowerCase())) {
        return { group: g.name };
      }
    }

    return null;
  }

  /**
   * Formats a human-readable interpretation of the resolved query.
   */
  private formatInterpretation(ast: AnalyticsQueryAST, count: number): string {
    const parts: string[] = [];

    // Aggregation
    if (ast.aggregation === 'TOP_N') {
      parts.push(`Top ${ast.topLimit || 5} largest`);
    } else if (ast.aggregation === 'AVERAGE') {
      parts.push('Average monthly spend');
    } else if (ast.aggregation === 'COUNT') {
      parts.push('Transaction count');
    } else if (ast.aggregation === 'COMPARE_PERIODS') {
      parts.push('Period comparison');
    } else {
      parts.push(ast.filters.type === 'INCOME' ? 'Total income' : 'Total spend');
    }

    // Category / Filter
    if (ast.filters.categoryItem) {
      parts.push(`on ${ast.filters.categoryItem}`);
    } else if (ast.filters.categoryGroup) {
      parts.push(`in ${ast.filters.categoryGroup}`);
    } else if (ast.filters.merchant) {
      parts.push(`for "${ast.filters.merchant}"`);
    }

    if (ast.filters.person) {
      parts.push(`paid by ${ast.filters.person}`);
    }

    if (ast.filters.splitType === 'SPLIT') {
      parts.push('(Shared 50/50)');
    }

    if (ast.filters.minAmount !== undefined) {
      parts.push(`> ${this.service.formatCurrency(ast.filters.minAmount)}`);
    }
    if (ast.filters.maxAmount !== undefined) {
      parts.push(`< ${this.service.formatCurrency(ast.filters.maxAmount)}`);
    }

    // Date
    if (ast.comparisonRange) {
      parts.push(`(${ast.primaryRange.label} vs ${ast.comparisonRange.label})`);
    } else {
      parts.push(`(${ast.primaryRange.label})`);
    }

    return `${parts.join(' ')} • ${count} transaction${count === 1 ? '' : 's'}`;
  }

  /**
   * Generates dynamic follow-up query suggestions based on query structure.
   */
  private generateFollowUps(ast: AnalyticsQueryAST): string[] {
    const suggestions: string[] = [];
    const entity = ast.filters.categoryItem || ast.filters.categoryGroup || ast.filters.merchant || '';

    // If query is for a single period, suggest comparing to previous year
    if (!ast.comparisonRange) {
      const yrMatch = ast.primaryRange.label.match(/\b(20\d\d)\b/);
      if (yrMatch) {
        const yr = parseInt(yrMatch[1], 10);
        const prev = yr - 1;
        suggestions.push(
          entity
            ? `Compare ${entity} ${prev} vs ${yr}`
            : `Compare ${prev} vs ${yr}`
        );
      } else {
        suggestions.push(
          entity
            ? `Compare ${entity} this year vs last year`
            : `Compare this year vs last year`
        );
      }
    }

    // Suggest Top N
    if (ast.aggregation !== 'TOP_N') {
      suggestions.push(
        entity
          ? `Top 5 ${entity} expenses in ${ast.primaryRange.label}`
          : `Top 5 expenses in ${ast.primaryRange.label}`
      );
    }

    // Suggest Monthly Average
    if (ast.aggregation !== 'AVERAGE') {
      suggestions.push(
        entity
          ? `Average monthly ${entity} in ${ast.primaryRange.label}`
          : `Average monthly spend in ${ast.primaryRange.label}`
      );
    }

    // Suggest Split / Person
    if (!ast.filters.person && this.service.persons().length > 1) {
      const p1 = this.service.persons()[0]?.name;
      if (p1) {
        suggestions.push(
          entity
            ? `How much did ${p1} pay for ${entity} in ${ast.primaryRange.label}?`
            : `How much did ${p1} spend in ${ast.primaryRange.label}?`
        );
      }
    }

    return suggestions.slice(0, 3);
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
