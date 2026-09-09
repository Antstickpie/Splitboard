# In-Browser Natural Language Analytics Architecture & Blueprint

**Status:** Proposed / Draft  
**Target Execution:** 100% Client-Side (Browser-Only, Zero Server Dependencies, Zero API Keys, Offline-First)  
**Primary Data Source:** In-Memory Reactive Signals (`transactions()`, `categoryGroups()`, `persons()`, `monthlyBudgets()`) backed by Splitboard's local JSON database.

---

## 1. Executive Summary & Vision

Splitboard manages all user finances, transactions, category groups, split settlements, and monthly budgets directly in the browser. Rather than sending sensitive financial data over the wire to third-party LLM providers, Splitboard is uniquely architected to run **100% local, in-browser Natural Language Analytics**.

Users should be able to ask natural questions like:
- *"How much did we spend on groceries last summer?"*
- *"Compare dining out trends between 2023 and 2024"*
- *"What were our top 5 largest shared expenses this year?"*
- *"How much has [Person 1] paid for utilities compared to [Person 2]?"*
- *"Average monthly spend on subscriptions"*

And receive:
1. **Accurate mathematical totals** (deterministic, 0% hallucination).
2. **Interactive visual answers** (metric callouts, comparison pills, mini charts).
3. **Audit drill-down drawers** with the exact matching transactions.

---

## 2. The Core Principle: "Never Ask an LLM to Do Financial Math"

Passing thousands of raw transaction lines into a large language model prompt fails for two major reasons:
1. **Context Window & Latency Overhead**: Loading 3,000–10,000 transactions into a prompt consumes tens of thousands of tokens, runs slowly, and is cost-prohibitive or impossible on small in-browser models.
2. **Arithmetic Hallucination**: Generative neural networks are notorious for mathematical errors when summing lists of numbers. In a financial application, an error of €0.01 destroys user trust.

### The Correct Architecture: NL-to-Structured-Query Compilation

```
┌────────────────────────────────────────────────────────┐
│  User Natural Language Query                          │
│  "How much did we spend on groceries last summer?"     │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│  In-Browser Semantic Compiler & Date Engine            │
│  • Resolves "last summer" -> 2023-06-01 to 2023-08-31  │
│  • Fuzzy-matches "groceries" -> Category: "Groceries"  │
│  • Detects intent -> SUM                               │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│  Structured In-Memory Query AST                        │
│  { dateRange: { start, end }, category: 'Groceries',   │
│    op: 'SUM', split: 'ALL' }                           │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│  Deterministic Aggregation Engine                      │
│  Operates in <2ms on `this.service.transactions()`     │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│  Interactive Generative UI                             │
│  • Hero Metric Card (€3,482.10)                        │
│  • Mini SVG Trend / Bar Breakdown                      │
│  • Collapsible Audit Drawer of Matched Transactions    │
│  • Clickable Follow-up Suggestion Chips                │
└────────────────────────────────────────────────────────┘
```

---

## 3. System Components & Technical Design

### Component 1: Temporal & Date Range Parser
Converts human expressions into ISO `[YYYY-MM-DD, YYYY-MM-DD]` intervals:
- **Relative periods**: `"last month"`, `"this month"`, `"last 3 months"`, `"last 6 months"`, `"this year"`, `"last year"`, `"all time"`.
- **Seasons & Quarters**: `"summer 2023"` (`2023-06-01` to `2023-08-31`), `"Q1 2024"`, `"holiday season 2022"`.
- **Specific months**: `"March 2023"`, `"between May and August 2022"`, `"since January"`.

### Component 2: Fuzzy Entity & Category Matcher
Matches user query keywords against live entities loaded in memory:
- **Categories**: Dynamic index of `categoryGroup.name` and `categoryItem.name`.
  - Input `"dining"` or `"restaurant"` -> maps to `"Food / Restaurants"`.
  - Input `"power"` or `"electric"` -> maps to `"Housing / Electricity"`.
- **Persons**: Matches against `service.persons()` names (e.g., `"Person 1"`, `"Person 2"`).
- **Split & Type**: Recognizes keywords like `"shared"`, `"reimbursable"`, `"cash"`, `"income"`.
- **Merchants**: Fuzzy matches high-frequency merchants from existing transaction descriptions (e.g. `"amazon"`, `"uber"`, `"ikea"`).

### Component 3: The Query AST (Abstract Syntax Tree)
```typescript
export type AggregationType = 
  | 'SUM' 
  | 'AVERAGE' 
  | 'COUNT' 
  | 'MONTHLY_BREAKDOWN' 
  | 'TOP_N' 
  | 'COMPARE_PERIODS';

export interface AnalyticsQueryAST {
  rawQuery: string;
  aggregation: AggregationType;
  primaryRange: {
    start: string; // YYYY-MM-DD
    end: string;   // YYYY-MM-DD
    label: string; // e.g. "Summer 2023"
  };
  comparisonRange?: {
    start: string;
    end: string;
    label: string;
  };
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
  topLimit?: number; // e.g. top 5, top 10
}
```

### Component 4: High-Performance In-Memory Execution
Because all transactions reside in `TransactionService.transactions()` as an array in JavaScript memory, executing filter/reduce operations on 5,000–20,000 items takes **under 2 milliseconds**:
```typescript
export interface AnalyticsResult {
  query: AnalyticsQueryAST;
  primaryTotal: number;
  transactionCount: number;
  averagePerMonth?: number;
  matchedTransactions: Transaction[];
  monthlyBreakdown?: { month: string; total: number }[];
  comparisonTotal?: number;
  percentageChange?: number;
}
```

### Component 5: Progressive On-Device AI (Optional / Layered)
For complex, unstructured natural language queries that rule-based engines might find ambiguous (e.g. *"What was that expensive thing we bought on our holiday in Italy two years ago?"*):
1. **Chrome Built-in AI (`window.ai`)**:
   - If available on Chromium with Gemini Nano enabled, it runs 100% on the user's hardware without downloading anything.
   - It is prompted only to produce the `AnalyticsQueryAST` JSON object, never to do arithmetic.
2. **In-Browser WebGPU / Transformers.js (Optional Opt-In)**:
   - A tiny quantised model (such as Qwen 2.5 0.5B or Gemma 2 2B) loaded into a Web Worker via WebGPU.

---

## 4. User Interface Specification

### Search Bar & Query Input
- Prominently integrated into the **Budget Dashboard** or as a dedicated modal (`Cmd+K` / `Ctrl+K` command palette).
- Interactive starter pills (e.g., `[ 🥦 Groceries Last Month ]`, `[ ⚡️ Utilities This Year ]`, `[ 📊 Compare 2023 vs 2024 ]`).
- Real-time suggestions as you type.

### Result Card Structure
```
┌────────────────────────────────────────────────────────────────────────┐
│  ✨ "How much did we spend on groceries last summer?"                  │
│                                                                        │
│  €3,482.10                                       +8.4% vs Summer 2022 │
│  June 1, 2023 – August 31, 2023 • 42 transactions                      │
│                                                                        │
│  [ June: €1,120.40 ] [ July: €1,240.20 ] [ August: €1,121.50 ]        │
│  █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ (mini-bar)│
│                                                                        │
│  ▼ View 42 Matched Transactions                                        │
│  • 2023-08-28 | Whole Foods | €142.50 | Person 1 (Split)               │
│  • 2023-08-21 | Trader Joe's | €89.10 | Person 2 (Split)               │
│  ...                                                                   │
│                                                                        │
│  Suggested Next Queries:                                               │
│  [ Compare to Summer 2024 ]  [ Split by Person ]  [ Top 5 Groceries ]  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Sample Query Corpus & Verification Cases

| Query Phrase | Resolved Intent | Resolved Filters & Range |
| :--- | :--- | :--- |
| *"How much did we spend on groceries last summer?"* | `SUM` | Cat: `Food / Groceries`, Date: `2023-06-01..2023-08-31` |
| *"Compare dining out 2023 vs 2024"* | `COMPARE_PERIODS` | Cat: `Food / Restaurants`, R1: `2023`, R2: `2024` |
| *"What were our top 5 expenses this year?"* | `TOP_N (limit: 5)` | Date: `2024-01-01..today`, Sort: `amount desc` |
| *"How much has Person 2 paid for utilities?"* | `SUM` | Cat: `Utilities`, `paidBy: Person 2` |
| *"Show all Amazon transactions over €100"* | `FILTER` | Merchant: `Amazon`, `minAmount: 100` |
| *"Average monthly electricity cost"* | `AVERAGE` | Cat: `Electricity`, Group by: `month` |

---

## 6. Storage Evolution & Cloud Sync Strategy (Decision: Approach A)

### Phase 1: In-Memory JSON (Current)
- The natural language query engine executes directly against `TransactionService.transactions()`.
- For datasets up to ~10,000 transactions, execution times are under 2 milliseconds with zero external database dependencies.
- Persisted locally in `localStorage` under `tx_processor_data_v1`.

### Phase 2: In-Browser Database Migration (IndexedDB)
- When data history spans 5–10+ years and approaches the browser's ~5MB `localStorage` limit, the storage engine will transparently migrate to native browser **IndexedDB**.
- IndexedDB provides gigabytes of local storage and indexed search capabilities without requiring an external backend.

### Cloud Backup Strategy: Approach A (Portable JSON Dump)
- Regardless of the underlying local storage engine (in-memory JSON or IndexedDB), backups to **Google Drive** will strictly adhere to **Approach A**:
  1. On backup / auto-sync, the database serializes its state into a standardized, portable JSON payload (`splitboard_backup.json`).
  2. The JSON payload is pushed directly to the user's personal Google Drive via the Google Drive REST API.
  3. On restore, the JSON file is pulled and hydrates the local database.
- **Benefits**:
  - 100% portable across Chrome, Safari, Firefox, and mobile browsers.
  - Human-readable and future-proof against database schema migrations.
  - Zero server overhead or proprietary database locking.

---

## 7. Implementation Phases

- [ ] **Phase 1: Query Compiler Service (`src/app/services/analytics-nlp.service.ts`)**
  - Implement regex date range parser for relative and seasonal expressions.
  - Implement category/merchant fuzzy matcher with local Trie/Levenshtein matching.
  - Build the deterministic array calculation engine directly on `transactions()`.
- [ ] **Phase 2: UI Component (`src/app/components/analytics-search/`)**
  - Search input with autocomplete and quick-prompt suggestion chips.
  - Answer card rendering with KPI highlight, mini SVG sparkline/bar, and drilldown table.
- [ ] **Phase 3: Integration with Budget Dashboard & Command Palette**
  - Embed in dashboard and connect keyboard shortcut (`Cmd+K`).
- [ ] **Phase 4: Optional WebGPU / Chrome `window.ai` Hook**
  - Detect on-device model availability for fallback natural language handling.
- [ ] **Phase 5: Storage Layer Upgrade (IndexedDB Adapter)**
  - Seamless migration from `localStorage` to IndexedDB when transaction count exceeds capacity threshold, maintaining Approach A Google Drive sync.
