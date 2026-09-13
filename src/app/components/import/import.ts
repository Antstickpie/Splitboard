import { Component, inject, signal, computed, Input, Output, EventEmitter, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService, ImportedBatch, RuleTxDiffItem } from '../../services/transaction.service';
import { StatementParserService, ParsedStatementResult } from '../../services/statement-parser.service';
import { Transaction, SplitType, ImportDraft, CategoryRule, StatementBatchSnapshot } from '../../models';
import { CategorySelectComponent } from '../category-select/category-select';

export interface TransactionGroup {
  id: string;
  title: string;
  count: number;
  totalAmount: number;
  items: Transaction[];
}

export interface DescriptionGroup {
  description: string;
  count: number;
  totalAmount: number;
  items: Transaction[];
  categoryGroup?: string;
  categoryItem?: string;
  isMixedCategory?: boolean;
  mixedCategorySummary?: string;
  splitType?: SplitType;
  owner?: string;
  note?: string;
}

export interface ImportCategoryMapping {
  rawCategory: string;
  count: number;
  totalAmount: number;
  selectedItem: string;
  selectedGroup: string;
  selectedPerson: string;
  selectedSplitType: SplitType | '';
  isIncome?: boolean;
}

export interface ImportDescriptionMapping {
  description: string;
  count: number;
  totalAmount: number;
  selectedItem: string;
  selectedGroup: string;
  selectedPerson: string;
  selectedSplitType: SplitType | '';
  rawCategories: string[];
  isIncome?: boolean;
  isFullyAssigned?: boolean;
  unassignedCount?: number;
}

@Component({
  selector: 'app-import',
  standalone: true,
  imports: [CommonModule, FormsModule, CategorySelectComponent],
  templateUrl: './import.html',
  styleUrl: './import.css'
})
export class ImportComponent {
  public service = inject(TransactionService);
  private parser = inject(StatementParserService);

  @Output() public importCompleted = new EventEmitter<void>();

  // Add Category Modal State
  public showAddCategoryModal = signal<boolean>(false);
  public newCatMode = signal<'existing' | 'new_heading'>('existing');
  public newCatSelectedGroupId = signal<string>('');
  public newCatHeadingName = signal<string>('');
  public newCatHeadingIcon = signal<string>('📁');
  public newCatSubName = signal<string>('');
  public newCatTargetTx: Transaction | null = null;
  public newCatTargetGroup: DescriptionGroup | null = null;
  public newCatTargetContext: 'row' | 'group' | 'rule' | 'toolbar' | 'batch_cat' | 'card_cat' | 'batch_desc' | 'card_desc' = 'toolbar';
  public newCatTargetKey: string | null = null;

  public selectedGroupExistingSubCategories = computed<string[]>(() => {
    const groupId = this.newCatSelectedGroupId();
    if (!groupId) return [];
    const grp = this.service.categoryGroups().find((g) => g.id === groupId);
    return grp?.items?.map((i) => i.name) || [];
  });

  public isSubNameAlreadyExisting = computed<boolean>(() => {
    const sub = this.newCatSubName().trim().toLowerCase();
    if (!sub) return false;
    return this.selectedGroupExistingSubCategories().some((s) => s.trim().toLowerCase() === sub);
  });

  public selectExistingSubCategory(name: string): void {
    const groupId = this.newCatSelectedGroupId();
    const createdGroup = this.service.categoryGroups().find((g) => g.id === groupId);
    const groupName = createdGroup?.name || 'Uncategorized';

    if (this.newCatTargetContext === 'row' && this.newCatTargetTx) {
      this.onRowCategoryChange(this.newCatTargetTx, name, groupName);
    } else if (this.newCatTargetContext === 'group' && this.newCatTargetGroup) {
      this.onGroupCategoryChange(this.newCatTargetGroup, name, groupName);
    } else if (this.newCatTargetContext === 'rule') {
      this.ruleCategory = name;
    } else if (this.newCatTargetContext === 'batch_cat') {
      this.assignMatchingCategoriesToType({ item: name, group: groupName });
    } else if (this.newCatTargetContext === 'card_cat' && this.newCatTargetKey) {
      this.onCategoryMappingChange(this.newCatTargetKey, { item: name, group: groupName });
    } else if (this.newCatTargetContext === 'batch_desc') {
      this.assignMatchingDescriptionsToType({ item: name, group: groupName });
    } else if (this.newCatTargetContext === 'card_desc' && this.newCatTargetKey) {
      this.onDescriptionMappingCategoryChange(this.newCatTargetKey, { item: name, group: groupName });
    }
    this.closeAddCategoryModal();
  }

  public openAddCategoryModal(
    targetTxOrInitialName?: Transaction | string,
    context: 'row' | 'group' | 'rule' | 'toolbar' | 'batch_cat' | 'card_cat' | 'batch_desc' | 'card_desc' = 'toolbar',
    targetGroupOrKey?: DescriptionGroup | string
  ): void {
    if (typeof targetTxOrInitialName === 'object' && targetTxOrInitialName !== null) {
      this.newCatTargetTx = targetTxOrInitialName;
    } else {
      this.newCatTargetTx = null;
    }
    if (typeof targetGroupOrKey === 'object' && targetGroupOrKey !== null) {
      this.newCatTargetGroup = targetGroupOrKey;
      this.newCatTargetKey = null;
    } else if (typeof targetGroupOrKey === 'string') {
      this.newCatTargetGroup = null;
      this.newCatTargetKey = targetGroupOrKey;
    } else {
      this.newCatTargetGroup = null;
      this.newCatTargetKey = null;
    }
    this.newCatTargetContext = context;

    const initialSubName = typeof targetTxOrInitialName === 'string' ? targetTxOrInitialName.trim() : '';
    const groups = this.service.categoryGroups();
    this.newCatMode.set(groups.length > 0 ? 'existing' : 'new_heading');
    const currentGroup = this.newCatTargetTx?.categoryGroup || this.newCatTargetGroup?.categoryGroup;
    const matchedGroup = currentGroup ? groups.find((g) => g.name === currentGroup) : null;
    const initialGroupId = matchedGroup ? matchedGroup.id : (groups.length > 0 ? groups[0].id : '');
    this.newCatSelectedGroupId.set(initialGroupId);
    this.newCatHeadingName.set('');
    this.newCatHeadingIcon.set('📁');
    this.newCatSubName.set(initialSubName);
    this.showAddCategoryModal.set(true);
  }

  public closeAddCategoryModal(): void {
    this.showAddCategoryModal.set(false);
    this.newCatTargetTx = null;
    this.newCatTargetGroup = null;
    this.newCatTargetKey = null;
  }

  public saveNewCategory(): void {
    const subName = this.newCatSubName().trim();
    if (!subName) return;

    let groupId = this.newCatSelectedGroupId();

    if (this.newCatMode() === 'new_heading') {
      const headingName = this.newCatHeadingName().trim();
      if (!headingName) return;
      groupId = this.service.addCategoryGroup(headingName, this.newCatHeadingIcon() || '📁');
    }

    if (!groupId) return;

    const existingGroup = this.service.categoryGroups().find((g) => g.id === groupId);
    const alreadyExists = existingGroup?.items?.some((i) => i.name.trim().toLowerCase() === subName.toLowerCase());
    if (!alreadyExists) {
      this.service.addCategoryItem(groupId, subName);
    }

    const createdGroup = this.service.categoryGroups().find((g) => g.id === groupId);
    const groupName = createdGroup?.name || 'Uncategorized';

    if (this.newCatTargetContext === 'row' && this.newCatTargetTx) {
      this.onRowCategoryChange(this.newCatTargetTx, subName, groupName);
    } else if (this.newCatTargetContext === 'group' && this.newCatTargetGroup) {
      this.onGroupCategoryChange(this.newCatTargetGroup, subName, groupName);
    } else if (this.newCatTargetContext === 'rule') {
      this.ruleCategory = subName;
    } else if (this.newCatTargetContext === 'batch_cat') {
      this.assignMatchingCategoriesToType({ item: subName, group: groupName });
    } else if (this.newCatTargetContext === 'card_cat' && this.newCatTargetKey) {
      this.onCategoryMappingChange(this.newCatTargetKey, { item: subName, group: groupName });
    } else if (this.newCatTargetContext === 'batch_desc') {
      this.assignMatchingDescriptionsToType({ item: subName, group: groupName });
    } else if (this.newCatTargetContext === 'card_desc' && this.newCatTargetKey) {
      this.onDescriptionMappingCategoryChange(this.newCatTargetKey, { item: subName, group: groupName });
    }

    this.closeAddCategoryModal();
  }

  @HostListener('window:keydown.escape')
  public onEscapeKey(): void {
    if (this.isOwnerExcludeDropdownOpen()) {
      this.isOwnerExcludeDropdownOpen.set(false);
      return;
    }
    if (this.showAddCategoryModal()) {
      this.closeAddCategoryModal();
      return;
    }
    if (this.showBankSelectModal()) {
      this.closeBankSelectModal();
      return;
    }
    if (this.showRuleModal()) {
      this.closeRuleModal();
      return;
    }
    if (this.viewingBatch()) {
      this.closeBatchModal();
      return;
    }
  }

  @HostListener('document:click')
  public onImportDocumentClick(): void {
    if (this.isOwnerExcludeDropdownOpen()) {
      this.isOwnerExcludeDropdownOpen.set(false);
    }
  }

  public selectedBank = signal<string>('');
  public detectedBankSuggestion = signal<string>('');
  public selectedOwner = signal<string>('');
  public uploadedFileName = signal<string>('');
  public isParsing = signal<boolean>(false);
  public rawClipboardText = '';

  public previewResult = signal<ParsedStatementResult | null>(null);
  public previewTab = signal<'valid' | 'review' | 'incomes' | 'duplicates' | 'excluded' | 'deleted'>('valid');

  public toggleTxDone(tx: Transaction): void {
    tx.isDone = !tx.isDone;
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
  }

  public toggleTxReview(tx: Transaction): void {
    tx.isUnderReview = !tx.isUnderReview;
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
  }

  public sortColumn = signal<'date' | 'description' | 'amount' | 'bank' | 'paidBy' | 'categoryItem' | 'original'>('original');
  public sortAsc = signal<boolean>(true);

  // Side-by-Side Live PDF Viewer State
  public isPdfLoaded = signal<boolean>(false);
  public isPdfViewerOpen = signal<boolean>(true);
  public pdfZoom = signal<number>(1.0);
  public pdfPageCount = signal<number>(0);
  public pdfPagesList = signal<number[]>([]);
  public isRenderingPdf = signal<boolean>(false);
  private pdfDocInstance: any = null;
  private pdfArrayBuffer: ArrayBuffer | null = null;

  public sortTxList(list: Transaction[]): Transaction[] {
    if (!list || list.length === 0) return [];
    const col = this.sortColumn();
    if (col === 'original') {
      const txs = [...list];
      if (this.isPdfLoaded() && txs.length > 1) {
        const firstDate = txs[0].date || '';
        const lastDate = txs[txs.length - 1].date || '';
        if (firstDate && lastDate && firstDate > lastDate) {
          return txs.reverse();
        }
      }
      return txs;
    }
    const asc = this.sortAsc();
    return [...list].sort((a, b) => {
      let valA: any = a[col] ?? '';
      let valB: any = b[col] ?? '';
      if (col === 'amount') {
        return asc ? (valA - valB) : (valB - valA);
      }
      return asc
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });
  }

  public assignedTransactionsCount = computed<number>(() => {
    const res = this.previewResult();
    if (!res || !res.transactions) return 0;
    return res.transactions.filter((t) => t.categoryItem && t.categoryItem !== 'Uncategorized').length;
  });

  public sortedTransactions = computed(() => {
    const res = this.previewResult();
    if (!res || !res.transactions) return [];
    let list = res.transactions;
    if (this.descExcludeAssigned()) {
      list = list.filter((t) => !t.categoryItem || t.categoryItem === 'Uncategorized');
    }
    const q = this.descriptionMatchKeyword().trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          (t.description || '').toLowerCase().includes(q) ||
          (t.merchant || '').toLowerCase().includes(q) ||
          (t.rawCategory || '').toLowerCase().includes(q)
      );
    }
    if (this.excludedOwners().length > 0) {
      list = list.filter((t) => !this.isTxOwnerExcluded(t));
    }
    if (this.selectedCategoryFilter()) {
      const cat = this.selectedCategoryFilter();
      list = list.filter((t) => (t.rawCategory || t.categoryItem || 'Uncategorized').trim() === cat);
    } else if (this.selectedDescriptionFilter()) {
      const desc = this.selectedDescriptionFilter();
      list = list.filter((t) => (t.description || t.merchant || 'Unspecified').trim() === desc);
    }
    return this.sortTxList(list);
  });

  public reviewTransactions = computed(() => {
    const res = this.previewResult();
    if (!res || !res.transactions) return [];
    return this.sortTxList(res.transactions.filter((t) => t.isUnderReview));
  });

  public sortedIncomes = computed(() => {
    const res = this.previewResult();
    return this.sortTxList(res?.incomes || []);
  });

  public sortedDuplicates = computed(() => {
    const res = this.previewResult();
    return this.sortTxList(res?.duplicates || []);
  });

  public sortedExcluded = computed(() => {
    const res = this.previewResult();
    return this.sortTxList(res?.excluded || []);
  });

  public sortedDeleted = computed(() => {
    const res = this.previewResult();
    return this.sortTxList(res?.deleted || []);
  });

  public toggleSort(column: 'date' | 'description' | 'amount' | 'bank' | 'paidBy' | 'categoryItem') {
    if (this.sortColumn() === column) {
      this.sortAsc.set(!this.sortAsc());
    } else {
      this.sortColumn.set(column);
      if (column === 'date') {
        this.sortAsc.set(this.isPdfLoaded());
      } else {
        this.sortAsc.set(column === 'description' || column === 'bank');
      }
    }
  }

  // Quick Rule Creator Modal
  public showRuleModal = signal<boolean>(false);
  public ruleTargetTx = signal<Transaction | null>(null);
  public ruleType = signal<'categorize' | 'exclude'>('categorize');
  public ruleKeyword = '';
  public ruleBank = 'All';
  public ruleCategory = '';
  public ruleCategoryGroup = '';
  public ruleSplitType: SplitType = 'SELF';
  public rulePaidBy = '';
  public ruleIncomeNextMonth = false;
  public ruleDefaultNote = '';
  public editingExistingRuleId: string | null = null;

  public findMatchingCategoryRuleForTx(tx: Transaction): { type: 'category'; rule: CategoryRule } | null {
    const desc = (tx.description || '').trim().toLowerCase();
    if (!desc) return null;
    const txBank = (tx.bank || '').toLowerCase();

    const matchingCatRules = this.service.rules().filter((r) => {
      const rKw = (r.keyword || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
      if (!rKw || rKw.length < 2) return false;
      const ruleBank = (r.bank || 'All').toLowerCase();
      const matchesBank = ruleBank === 'all' || !txBank || txBank.includes(ruleBank) || ruleBank.includes(txBank);
      const matchesKeyword = desc.includes(rKw);
      return matchesBank && matchesKeyword;
    });

    if (matchingCatRules.length > 0) {
      matchingCatRules.sort((a, b) => {
        const aBankSpecific = a.bank && a.bank.toLowerCase() !== 'all' ? 1 : 0;
        const bBankSpecific = b.bank && b.bank.toLowerCase() !== 'all' ? 1 : 0;
        if (aBankSpecific !== bBankSpecific) return bBankSpecific - aBankSpecific;
        return (b.keyword || '').length - (a.keyword || '').length;
      });
      return { type: 'category', rule: matchingCatRules[0] };
    }
    return null;
  }

  public findMatchingRuleForTx(tx: Transaction): { type: 'category' | 'exclude'; rule: any } | null {
    const catMatch = this.findMatchingCategoryRuleForTx(tx);
    if (catMatch) return catMatch;

    const desc = (tx.description || '').trim().toLowerCase();
    if (!desc) return null;
    const txBank = (tx.bank || '').toLowerCase();

    // 2. Check Exclude Rules
    const matchingExcludeRules = this.service.excludeRules().filter((r) => {
      const rKw = (r.keyword || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
      if (!rKw || rKw.length < 2) return false;
      const ruleBank = (r.bank || 'All').toLowerCase();
      const matchesBank = ruleBank === 'all' || !txBank || txBank.includes(ruleBank) || ruleBank.includes(txBank);
      const matchesKeyword = desc.includes(rKw);
      return matchesBank && matchesKeyword;
    });

    if (matchingExcludeRules.length > 0) {
      matchingExcludeRules.sort((a, b) => {
        const aBankSpecific = a.bank && a.bank.toLowerCase() !== 'all' ? 1 : 0;
        const bBankSpecific = b.bank && b.bank.toLowerCase() !== 'all' ? 1 : 0;
        if (aBankSpecific !== bBankSpecific) return bBankSpecific - aBankSpecific;
        return (b.keyword || '').length - (a.keyword || '').length;
      });
      return { type: 'exclude', rule: matchingExcludeRules[0] };
    }

    return null;
  }

  public hasMatchingRule(tx: Transaction | undefined | null): boolean {
    if (!tx) return false;
    const isFromExcluded = (this.previewResult()?.excluded || []).some((t) => t.id === tx.id);
    return isFromExcluded ? !!this.findMatchingRuleForTx(tx) : !!this.findMatchingCategoryRuleForTx(tx);
  }

  public openRuleModal(tx: Transaction): void {
    this.ruleTargetTx.set(tx);
    const isFromExcluded = (this.previewResult()?.excluded || []).some((t) => t.id === tx.id);
    const existing = isFromExcluded
      ? this.findMatchingRuleForTx(tx)
      : this.findMatchingCategoryRuleForTx(tx);

    if (existing) {
      this.loadExistingRuleIntoModal({
        type: existing.type,
        rule: existing.rule,
        message: ''
      }, false);
      if (existing.type === 'category') {
        this.ruleDefaultNote = existing.rule.defaultNote || tx.note || '';
      } else {
        this.ruleDefaultNote = '';
      }
    } else {
      this.editingExistingRuleId = null;
      this.ruleKeyword = tx.description || '';
      this.ruleBank = tx.bank || 'All';
      this.ruleType.set('categorize');
      this.ruleCategory = tx.categoryItem && tx.categoryItem !== 'Uncategorized' ? tx.categoryItem : '';
      this.ruleCategoryGroup = tx.categoryGroup && tx.categoryGroup !== 'Uncategorized' ? tx.categoryGroup : '';
      this.ruleSplitType = tx.splitType || 'SPLIT';
      this.rulePaidBy = tx.paidBy || this.service.personOne().name;
      this.ruleIncomeNextMonth = Boolean(tx.incomeMonth && tx.incomeMonth !== (tx.date || '').slice(0, 7));
      this.ruleDefaultNote = tx.note || '';
    }

    this.showRuleModal.set(true);
  }

  public switchToCreateNewRule(): void {
    this.editingExistingRuleId = null;
    this.ruleType.set('categorize');
    const tx = this.ruleTargetTx();
    if (tx) {
      this.ruleKeyword = tx.description || '';
      this.ruleBank = tx.bank || 'All';
      this.ruleCategory = tx.categoryItem && tx.categoryItem !== 'Uncategorized' ? tx.categoryItem : '';
      this.ruleCategoryGroup = tx.categoryGroup && tx.categoryGroup !== 'Uncategorized' ? tx.categoryGroup : '';
      this.ruleSplitType = tx.splitType || 'SPLIT';
      this.rulePaidBy = tx.paidBy || this.service.personOne().name;
      this.ruleIncomeNextMonth = Boolean(tx.incomeMonth && tx.incomeMonth !== (tx.date || '').slice(0, 7));
      this.ruleDefaultNote = tx.note || '';
    }
    this.service.showToast('Switched to creating a new rule', 'info');
  }

  public deleteRuleFromModal(): void {
    if (!this.editingExistingRuleId) return;
    const ruleId = this.editingExistingRuleId;
    if (this.ruleType() === 'exclude') {
      this.service.deleteExcludeRule(ruleId);
      this.service.showToast('Exclude rule deleted', 'success');
    } else {
      this.service.deleteRule(ruleId);
      this.service.showToast('Category rule deleted', 'success');
    }
    this.closeRuleModal();
  }

  public closeRuleModal(): void {
    this.showRuleModal.set(false);
    this.ruleTargetTx.set(null);
    this.editingExistingRuleId = null;
  }

  public getExistingRuleInfoForModal(): { type: 'category' | 'exclude'; rule: any; message: string } | null {
    const raw = (this.ruleKeyword || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
    if (!raw || raw.length < 2) return null;

    const matchedCat = this.service.rules().find((r) => {
      const rKw = (r.keyword || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
      return rKw && (rKw === raw || raw.includes(rKw));
    });
    if (this.ruleType() === 'categorize' && matchedCat) {
      const b = (!matchedCat.bank || matchedCat.bank === 'All') ? 'All Banks' : matchedCat.bank;
      return {
        type: 'category',
        rule: matchedCat,
        message: `Category rule: "${matchedCat.keyword}" → ${matchedCat.categoryItem} (${matchedCat.splitType || 'SPLIT'}) for [${b}]`
      };
    }

    const matchedExclude = this.service.excludeRules().find((r) => {
      const rKw = (r.keyword || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
      return rKw && (rKw === raw || raw.includes(rKw));
    });
    if (this.ruleType() === 'exclude' && matchedExclude) {
      const b = (!matchedExclude.bank || matchedExclude.bank === 'All') ? 'All Banks' : matchedExclude.bank;
      return {
        type: 'exclude',
        rule: matchedExclude,
        message: `Exclude rule: "${matchedExclude.keyword}" for [${b}]`
      };
    }

    if (matchedCat) {
      const b = (!matchedCat.bank || matchedCat.bank === 'All') ? 'All Banks' : matchedCat.bank;
      return {
        type: 'category',
        rule: matchedCat,
        message: `Category rule: "${matchedCat.keyword}" → ${matchedCat.categoryItem} (${matchedCat.splitType || 'SPLIT'}) for [${b}]`
      };
    }

    if (matchedExclude) {
      const b = (!matchedExclude.bank || matchedExclude.bank === 'All') ? 'All Banks' : matchedExclude.bank;
      return {
        type: 'exclude',
        rule: matchedExclude,
        message: `Exclude rule: "${matchedExclude.keyword}" for [${b}]`
      };
    }

    return null;
  }

  public loadExistingRuleIntoModal(
    info: { type: 'category' | 'exclude'; rule: any; message: string },
    showToast = true
  ): void {
    this.editingExistingRuleId = info.rule.id;
    this.ruleType.set(info.type === 'category' ? 'categorize' : 'exclude');
    this.ruleKeyword = info.rule.keyword;
    this.ruleBank = info.rule.bank || 'All';
    if (info.type === 'category') {
      this.ruleCategory = info.rule.categoryItem || '';
      this.ruleCategoryGroup = info.rule.categoryGroup || '';
      this.ruleSplitType = info.rule.splitType || 'SPLIT';
      this.rulePaidBy = info.rule.paidBy || '';
      this.ruleIncomeNextMonth = Boolean(info.rule.incomeNextMonth);
      this.ruleDefaultNote = info.rule.defaultNote || '';
    } else {
      this.ruleDefaultNote = '';
    }
    if (showToast) {
      this.service.showToast('Loaded existing rule for editing!', 'info');
    }
  }

  public saveRuleFromModal(): void {
    const keyword = this.ruleKeyword.trim();
    if (!keyword) return;

    if (this.ruleType() === 'exclude') {
      if (this.editingExistingRuleId) {
        const isExistingCat = this.service.rules().some((r) => r.id === this.editingExistingRuleId);
        if (isExistingCat) {
          this.service.deleteRule(this.editingExistingRuleId);
          this.service.addExcludeRule(this.ruleBank, keyword);
        } else {
          this.service.updateExcludeRule({
            id: this.editingExistingRuleId,
            bank: this.ruleBank,
            keyword
          });
        }
      } else {
        this.service.addExcludeRule(this.ruleBank, keyword);
      }
      // Re-evaluate preview: move matching transactions to excluded
      const res = this.previewResult();
      if (res) {
        const lowerKw = keyword.toLowerCase();
        const ruleBank = this.ruleBank.toLowerCase();
        const matches = (t: Transaction) => {
          const tBank = (t.bank || '').toLowerCase();
          const matchesB = ruleBank === 'all' || !tBank || tBank.includes(ruleBank) || ruleBank.includes(tBank);
          return matchesB && (t.description || '').toLowerCase().includes(lowerKw);
        };

        const newlyExcluded = res.transactions.filter(matches);
        if (newlyExcluded.length > 0) {
          const remainingValid = res.transactions.filter((t) => !matches(t));
          this.previewResult.set({
            ...res,
            transactions: remainingValid,
            excluded: [...res.excluded, ...newlyExcluded],
            excludedCount: res.excludedCount + newlyExcluded.length
          });
          this.service.showToast(`Exclude rule applied: moved ${newlyExcluded.length} rows to Excluded tab`, 'info');
        }
      }
    } else {
      let catGroup = this.ruleCategoryGroup;
      if (!catGroup && this.ruleCategory) {
        for (const grp of this.service.categoryGroups()) {
          if (grp.items.some((i) => i.name === this.ruleCategory)) {
            catGroup = grp.name;
            break;
          }
        }
      }

      const defaultNote = this.ruleDefaultNote.trim() || undefined;
      const editingId = this.editingExistingRuleId;
      const oldRule = editingId
        ? this.service.rules().find((r) => r.id === editingId) || null
        : null;

      const ruleData: Omit<CategoryRule, 'id'> = {
        keyword,
        categoryItem: this.ruleCategory || '',
        categoryGroup: catGroup,
        splitType: this.ruleSplitType,
        paidBy: this.rulePaidBy || undefined,
        bank: this.ruleBank,
        incomeNextMonth: this.ruleIncomeNextMonth || undefined,
        defaultNote
      };

      const newRule: CategoryRule = {
        id: editingId || ('temp-' + Date.now()),
        ...ruleData
      };

      // Gather candidate transactions from both preview and ledger
      const res = this.previewResult();
      const previewTxs = res ? res.transactions : [];
      const ledgerTxs = this.service.transactions();
      const allCandidateTxs = [...previewTxs, ...ledgerTxs];

      const diffs = this.service.calculateRuleDiffs(oldRule, newRule, allCandidateTxs);

      const doSaveRuleOnly = () => {
        if (editingId) {
          const isExistingExclude = this.service.excludeRules().some((r) => r.id === editingId);
          if (isExistingExclude) {
            this.service.deleteExcludeRule(editingId);
            this.service.addRule(ruleData);
          } else {
            this.service.updateRule({
              id: editingId,
              ...ruleData
            });
          }
        } else {
          this.service.addRule(ruleData);
        }
      };

      const doApplyAndSave = (diffsToApply: RuleTxDiffItem[]) => {
        // 1. Update ledger transactions
        this.service.applyRuleToTransactions(oldRule, newRule, diffsToApply);

        // 2. Update preview transactions
        const currentRes = this.previewResult();
        if (currentRes) {
          const diffMap = new Map<string, RuleTxDiffItem>();
          for (const d of diffsToApply) {
            diffMap.set(d.tx.id, d);
          }
          const oldNote = (oldRule?.defaultNote || '').trim();
          const newNoteStr = (newRule.defaultNote || '').trim();

          let updatedInPreview = 0;
          const updatedValid = currentRes.transactions.map((t) => {
            if (diffMap.has(t.id)) {
              updatedInPreview++;
              const updatedTx: Transaction = {
                ...t,
                categoryItem: newRule.categoryItem || t.categoryItem,
                categoryGroup: catGroup || t.categoryGroup,
                splitType: newRule.splitType || t.splitType,
                paidBy: newRule.paidBy || t.paidBy
              };

              const currentNote = (t.note || '').trim();
              const hasNoComment = !currentNote;
              const matchesOldRuleComment = Boolean(oldNote && currentNote.toLowerCase() === oldNote.toLowerCase());
              if (hasNoComment || matchesOldRuleComment) {
                updatedTx.note = newNoteStr || undefined;
              }

              if (newRule.incomeNextMonth && this.isIncomeTx(t)) {
                const curM = (t.date || '').slice(0, 7);
                updatedTx.incomeMonth = this.service.getNextMonth(curM);
              }
              return updatedTx;
            }
            return t;
          });

          // Check if any categorized transactions were in excluded list and restore them
          const restoredFromExcluded: Transaction[] = [];
          const remainingExcluded = currentRes.excluded.filter((t) => {
            if (diffMap.has(t.id)) {
              const updatedTx: Transaction = {
                ...t,
                categoryItem: newRule.categoryItem || t.categoryItem,
                categoryGroup: catGroup || t.categoryGroup,
                splitType: newRule.splitType || t.splitType,
                paidBy: newRule.paidBy || t.paidBy,
                includedFrom: 'excluded'
              };
              restoredFromExcluded.push(updatedTx);
              return false;
            }
            return true;
          });

          this.previewResult.set({
            ...currentRes,
            transactions: [...updatedValid, ...restoredFromExcluded],
            excluded: remainingExcluded,
            excludedCount: Math.max(0, currentRes.excludedCount - restoredFromExcluded.length)
          });
          if (updatedInPreview > 0 || restoredFromExcluded.length > 0) {
            this.service.showToast(`Updated ${updatedInPreview + restoredFromExcluded.length} matching rows in preview!`, 'success');
          }
        }

        doSaveRuleOnly();
      };

      if (diffs.length > 0) {
        this.closeRuleModal();
        this.service.openRuleConfirmModal({
          rule: newRule,
          oldRule,
          diffs,
          onConfirm: (selectedDiffs) => {
            const toApply = selectedDiffs ?? diffs;
            doApplyAndSave(toApply);
            this.service.showToast(`Applied rule changes to ${toApply.length} transactions`, 'success');
          },
          onSaveRuleOnly: () => {
            doSaveRuleOnly();
            this.service.showToast('Rule saved without updating existing transactions', 'info');
          }
        });
        return;
      } else {
        doSaveRuleOnly();
        this.closeRuleModal();
        this.service.showToast(editingId ? 'Rule updated' : 'Rule created', 'success');
        return;
      }
    }

    this.closeRuleModal();
  }

  // Inline Preview Table Editing
  public toggleTxOwner(tx: Transaction): void {
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;
    tx.paidBy = tx.paidBy === p1 ? p2 : p1;
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
  }

  public onRowCategoryChange(tx: Transaction, newCategory: string, newGroup?: string): void {
    if (newCategory === '__ADD_NEW__') {
      this.openAddCategoryModal(tx, 'row');
      return;
    }
    tx.categoryItem = newCategory;
    if (newGroup) {
      tx.categoryGroup = newGroup;
    } else {
      const existingGrp = this.service.categoryGroups().find((g) => g.name === tx.categoryGroup);
      if (!existingGrp || !existingGrp.items.some((i) => i.name === newCategory)) {
        for (const grp of this.service.categoryGroups()) {
          if (grp.items.some((i) => i.name === newCategory)) {
            tx.categoryGroup = grp.name;
            break;
          }
        }
      }
    }
    tx.rawCategory = newCategory;
    if (newCategory.toLowerCase().includes('reimburse')) {
      tx.isReimbursable = true;
      tx.reimbursementStatus = 'PENDING';
      tx.splitType = 'SELF';
    }
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
  }

  public moveIndividualTransactionCategory(tx: Transaction, newCategory: string, newGroup?: string): void {
    if (newCategory === '__ADD_NEW__') {
      this.openAddCategoryModal(tx, 'row');
      return;
    }

    const prevCategory = (tx.rawCategory || tx.categoryItem || 'Uncategorized').trim();
    const targetItem = newCategory || 'Uncategorized';

    let parentGroupName: string | undefined = newGroup;
    if (!parentGroupName && targetItem !== 'Uncategorized') {
      for (const grp of this.service.categoryGroups()) {
        if (grp.items.some((i) => i.name === targetItem)) {
          parentGroupName = grp.name;
          break;
        }
      }
    }
    if (!parentGroupName) {
      parentGroupName = 'Uncategorized';
    }

    const isIncome = parentGroupName.toLowerCase().includes('income');

    tx.categoryItem = targetItem;
    tx.categoryGroup = parentGroupName;
    tx.rawCategory = targetItem;

    if (isIncome) {
      tx.type = 'INCOME';
    } else if (tx.type === 'INCOME') {
      tx.type = 'EXPENSE';
    }

    if (targetItem.toLowerCase().includes('reimburse')) {
      tx.isReimbursable = true;
      tx.reimbursementStatus = 'PENDING';
      tx.splitType = 'SELF';
    }

    const res = this.previewResult();
    if (res) {
      this.previewResult.set({ ...res });
    }

    this.service.showToast(
      `Moved "${tx.description || 'Transaction'}" from "${prevCategory}" to "${targetItem}"`,
      'success'
    );
  }

  public unselectedSplitCount = computed(() => {
    const res = this.previewResult();
    if (!res) return 0;
    return res.transactions.filter((t) => !t.splitType).length;
  });

  public getInlineSplitValue(tx: Transaction): 'SPLIT_5050' | '100_P1' | '100_P2' | null {
    if (!tx.splitType) return null;
    const p1 = this.service.personOne().name;
    if (tx.splitType === 'SPLIT') return 'SPLIT_5050';
    if (tx.paidBy === p1) {
      return tx.splitType === 'SELF' ? '100_P1' : '100_P2';
    } else {
      return tx.splitType === 'SELF' ? '100_P2' : '100_P1';
    }
  }

  public getTxBeneficiary(tx: Transaction): string {
    if (!tx.splitType) return '';
    if (tx.splitType === 'SPLIT') return 'SPLIT';
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;
    if (tx.paidBy === p1) {
      return tx.splitType === 'SELF' ? p1 : p2;
    } else {
      return tx.splitType === 'SELF' ? p2 : p1;
    }
  }

  public isMatchingGroupSplit(choice: 'SPLIT' | string): boolean {
    const q = this.descriptionMatchKeyword().trim().toLowerCase();
    if (!q) return false;
    const res = this.previewResult();
    if (!res || !res.transactions || res.transactions.length === 0) return false;
    const matched = res.transactions.filter(
      (t) =>
        !this.isTxOwnerExcluded(t) &&
        ((t.description || '').toLowerCase().includes(q) ||
          (t.merchant || '').toLowerCase().includes(q) ||
          (t.rawCategory || '').toLowerCase().includes(q))
    );
    if (matched.length === 0) return false;
    if (choice === 'SPLIT') {
      return matched.every((t) => t.splitType === 'SPLIT');
    }
    return matched.every((t) => this.getTxBeneficiary(t) === choice);
  }

  public onInlineSplitButtonClick(tx: Transaction, choice: 'SPLIT_5050' | '100_P1' | '100_P2'): void {
    const p1 = this.service.personOne().name;
    if (choice === 'SPLIT_5050') {
      tx.splitType = 'SPLIT';
    } else if (choice === '100_P1') {
      tx.splitType = tx.paidBy === p1 ? 'SELF' : 'OTHER';
    } else {
      tx.splitType = tx.paidBy === p1 ? 'OTHER' : 'SELF';
    }
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
  }

  public invertPreviewSigns(): void {
    const res = this.previewResult();
    if (!res) return;

    const swappedTransactions = res.incomes.map((t) => ({ ...t, type: 'EXPENSE' as const }));
    const swappedIncomes = res.transactions.map((t) => ({ ...t, type: 'INCOME' as const }));

    this.previewResult.set({
      ...res,
      transactions: swappedTransactions,
      incomes: swappedIncomes,
      incomesCount: swappedIncomes.length
    });

    this.service.showToast(
      `Inverted signs: ${swappedTransactions.length} expenses, ${swappedIncomes.length} incomes/payments`,
      'info'
    );
  }

  constructor() {
    this.selectedBank.set('');
    this.detectedBankSuggestion.set('');
    this.selectedOwner.set('');
  }

  public onBankChange(bankName: string): void {
    this.selectedBank.set(bankName);
    const res = this.previewResult();
    if (!res) return;

    // Combine transactions and excluded to dynamically re-evaluate against new bank's rules
    const allExpenses = [...res.transactions, ...res.excluded];
    const newTransactions: Transaction[] = [];
    const newExcluded: Transaction[] = [];
    const activeRules = this.service.rules();

    for (const t of allExpenses) {
      t.bank = bankName;
      if (this.service.isTransactionExcluded(t.description, bankName)) {
        newExcluded.push(t);
      } else {
        // Apply matching category & split rules for this bank
        const desc = (t.description || '').toLowerCase();
        const lowerBank = (bankName || '').toLowerCase();
        const matched = activeRules.find((r) => {
          const ruleBank = (r.bank || 'All').toLowerCase();
          const matchesBank = ruleBank === 'all' || !lowerBank || lowerBank.includes(ruleBank) || ruleBank.includes(lowerBank);
          const rawKw = (r.keyword || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
          return Boolean(matchesBank && rawKw && desc.includes(rawKw));
        });

        if (matched) {
          t.categoryItem = matched.categoryItem;
          t.categoryGroup = matched.categoryGroup || 'Uncategorized';
          t.splitType = matched.splitType || t.splitType;
          t.splitPercentage = matched.splitPercentage !== undefined ? matched.splitPercentage : t.splitPercentage;
          if (matched.paidBy) t.paidBy = matched.paidBy;
          if (matched.incomeNextMonth && this.isIncomeTx(t)) {
            const curM = (t.date || '').slice(0, 7);
            t.incomeMonth = this.service.getNextMonth(curM);
          }
        } else {
          t.categoryItem = 'Uncategorized';
          t.categoryGroup = 'Uncategorized';
        }

        newTransactions.push(t);
      }
    }

    res.transactions = newTransactions;
    res.excluded = newExcluded;
    res.excludedCount = newExcluded.length;
    res.incomes.forEach((t) => (t.bank = bankName));
    res.duplicates.forEach((t) => (t.bank = bankName));
    res.deleted?.forEach((t) => (t.bank = bankName));
    res.bankName = bankName;
    res.bankMismatch = undefined;
    this.previewResult.set({ ...res });
  }

  public isCustomBank(name: string): boolean {
    if (!name || name === 'Generic Bank' || name === 'Auto-Detect') return false;
    return !this.service.bankConfigs().some((b) => b.name.toLowerCase() === name.toLowerCase());
  }

  // Quick Add Bank Directly from Import Page
  public isAddingBankInline = false;
  public newInlineBankName = '';

  public saveInlineBank(): void {
    if (!this.newInlineBankName.trim()) return;
    const name = this.newInlineBankName.trim();
    this.service.addBankConfig({
      name
    });
    this.onBankChange(name);
    this.newInlineBankName = '';
    this.isAddingBankInline = false;
  }

  // Immediate Bank Selection Dialog on Upload
  public showBankSelectModal = signal<boolean>(false);
  public pendingFile: File | null = null;
  public pendingText: string | null = null;

  @Input() set initialFile(file: File | null | undefined) {
    if (file) {
      this.processSelectedFile(file);
    }
  }

  @Input() set autoResumeDraft(val: boolean) {
    if (val && this.service.importDraft()) {
      this.resumeDraft();
    }
  }

  @Input() set batchToEdit(fileName: string | null | undefined) {
    if (fileName) {
      this.undoAndReopenBatch(fileName);
    }
  }

  public editingBatchFileName = signal<string | null>(null);

  public async saveDraft(): Promise<void> {
    const res = this.previewResult();
    if (!res) return;

    const hasPdf = !!this.pdfArrayBuffer;
    if (hasPdf && this.pdfArrayBuffer) {
      try {
        await this.service.saveDraftPdfBlob(this.pdfArrayBuffer);
      } catch (err) {
        console.warn('Failed to save draft PDF to IndexedDB:', err);
      }
    }

    const draft: ImportDraft = {
      id: Date.now().toString(),
      savedAt: new Date().toISOString(),
      fileName: this.uploadedFileName() || 'Statement',
      bankName: this.selectedBank() || res.bankName || 'Generic Bank',
      owner: this.selectedOwner() || '',
      previewResult: res,
      hasPdf: hasPdf
    };

    this.service.saveImportDraft(draft);
    this.service.showToast(`✓ Progress saved! (${res.transactions.length} rows staged)`, 'success');
  }

  public availableDraft = computed<ImportDraft | null>(() => {
    return !this.previewResult() ? this.service.importDraft() : null;
  });

  public async resumeDraft(draft?: ImportDraft | null): Promise<void> {
    const d = draft || this.service.importDraft();
    if (!d) return;

    this.uploadedFileName.set(d.fileName);
    this.selectedBank.set(d.bankName);
    this.selectedOwner.set(d.owner || '');
    this.previewResult.set({ ...d.previewResult });
    this.showBankSelectModal.set(false);
    this.previewTab.set('valid');
    this.sortColumn.set('original');

    if (d.hasPdf || d.fileName?.toLowerCase().endsWith('.pdf')) {
      try {
        const buffer = await this.service.loadDraftPdfBlob();
        if (buffer) {
          this.pdfArrayBuffer = buffer;
          await this.renderPdfDoc(buffer);
        }
      } catch (err) {
        console.warn('Could not restore PDF for draft:', err);
      }
    }

    this.isGroupByDescription.set(!this.isPdfLoaded());
    this.scrollToPreviewOrImport();
    this.service.showToast(`Resumed draft for "${d.fileName}" (${d.previewResult.transactions.length} rows)`, 'success');
  }

  public async discardDraft(): Promise<void> {
    this.service.clearImportDraft();
    await this.service.clearDraftPdfBlob();
    this.previewResult.set(null);
    this.uploadedFileName.set('');
    this.selectedBank.set('');
    this.selectedOwner.set('');
    this.showBankSelectModal.set(false);
    this.isPdfLoaded.set(false);
    this.pdfDocInstance = null;
    this.pdfArrayBuffer = null;
    this.pdfPagesList.set([]);
    this.isGroupByDescription.set(false);
    this.service.showToast('Import draft discarded', 'info');
    this.importCompleted.emit();
  }

  public formatDraftTime(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }

  public async onCancelPreview(): Promise<void> {
    this.clearPreview();
    this.service.showToast('Closed preview. Any previously saved draft is kept.', 'info');
  }

  public scrollToPreviewOrImport(): void {
    setTimeout(() => {
      const el = (document.querySelector('.preview-card') ||
        document.getElementById('inline-import-section') ||
        document.querySelector('.import-container')) as HTMLElement | null;
      if (el) {
        const topGap = 32;
        const targetY = Math.max(0, el.getBoundingClientRect().top + window.pageYOffset - topGap);
        window.scrollTo({ top: targetY, behavior: 'smooth' });
      }
    }, 100);
  }

  public processSelectedFile(file: File): void {
    this.pendingFile = file;
    this.pendingText = null;
    this.uploadedFileName.set(file.name);
    this.selectedOwner.set('');
    this.showBankSelectModal.set(true);
    this.scrollToPreviewOrImport();
  }

  public onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    this.processSelectedFile(input.files[0]);
    input.value = '';
  }

  public parseClipboardText() {
    if (!this.rawClipboardText.trim()) return;
    this.pendingText = this.rawClipboardText;
    this.pendingFile = null;
    this.uploadedFileName.set('Clipboard Paste');
    this.selectedOwner.set('');
    this.showBankSelectModal.set(true);
    this.scrollToPreviewOrImport();
  }

  public closeBankSelectModal(): void {
    this.showBankSelectModal.set(false);
    this.pendingFile = null;
    this.pendingText = null;
    if (!this.previewResult()) {
      this.importCompleted.emit();
    }
  }

  public async selectBankAndParse(bankName: string): Promise<void> {
    if (!this.selectedOwner()) {
      this.service.showToast('Please select an account owner first', 'info');
      return;
    }
    this.showBankSelectModal.set(false);
    this.selectedBank.set(bankName);
    this.isParsing.set(true);
    this.previewTab.set('valid');
    this.sortColumn.set('original');

    if (this.pendingFile) {
      const file = this.pendingFile;
      const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
      if (isPdf) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          this.pdfArrayBuffer = arrayBuffer;
          await this.renderPdfDoc(arrayBuffer);
        } catch (err) {
          console.warn('PDF pre-render notice:', err);
        }
      } else {
        this.isPdfLoaded.set(false);
        this.pdfDocInstance = null;
        this.pdfArrayBuffer = null;
        this.pdfPagesList.set([]);
      }

      try {
        const res = await this.parser.parseFile(file, bankName, this.selectedOwner());
        res.bankName = bankName;
        res.transactions.forEach((t) => (t.bank = bankName));
        res.incomes.forEach((t) => (t.bank = bankName));
        res.duplicates.forEach((t) => (t.bank = bankName));
        res.excluded.forEach((t) => (t.bank = bankName));
        res.deleted.forEach((t) => (t.bank = bankName));
        this.previewResult.set(res);
        this.isGroupByDescription.set(!this.isPdfLoaded());
        this.scrollToPreviewOrImport();
        if (res.transactions.length === 0 && res.duplicates.length > 0) {
          this.previewTab.set('duplicates');
          this.service.showToast(
            `All ${res.duplicates.length} transactions were already imported in your ledger (Duplicates tab).`,
            'info'
          );
        } else {
          this.service.showToast(
            `Parsed ${res.transactions.length} expenses for ${bankName}!`,
            'success'
          );
        }
      } catch (e: any) {
        this.service.showToast('Error parsing file: ' + e.message, 'error');
      } finally {
        this.isParsing.set(false);
        this.pendingFile = null;
      }
    } else if (this.pendingText) {
      try {
        const res = this.parser.parseText(
          this.pendingText,
          bankName,
          this.selectedOwner(),
          'Clipboard Paste'
        );
        res.bankName = bankName;
        res.transactions.forEach((t) => (t.bank = bankName));
        res.incomes.forEach((t) => (t.bank = bankName));
        res.duplicates.forEach((t) => (t.bank = bankName));
        res.excluded.forEach((t) => (t.bank = bankName));
        res.deleted.forEach((t) => (t.bank = bankName));
        this.previewResult.set(res);
        this.isGroupByDescription.set(true);
        this.scrollToPreviewOrImport();
        if (res.transactions.length === 0 && res.duplicates.length > 0) {
          this.previewTab.set('duplicates');
          this.service.showToast(
            `All ${res.duplicates.length} transactions were already imported in your ledger (Duplicates tab).`,
            'info'
          );
        } else {
          this.service.showToast(
            `Parsed ${res.transactions.length} expenses for ${bankName}!`,
            'success'
          );
        }
      } catch (e: any) {
        this.service.showToast('Error parsing text: ' + e.message, 'error');
      } finally {
        this.isParsing.set(false);
        this.pendingText = null;
      }
    }
  }

  public async renderPdfDoc(arrayBuffer: ArrayBuffer): Promise<void> {
    try {
      this.isRenderingPdf.set(true);
      let pdfLib = (window as any).pdfjsLib;
      if (!pdfLib) {
        try {
          pdfLib = await (new Function('return import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs")'))();
          if (pdfLib?.GlobalWorkerOptions && !pdfLib.GlobalWorkerOptions.workerSrc) {
            pdfLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
          }
        } catch {
          // ignore
        }
      }
      if (!pdfLib) return;

      const pdf = await pdfLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
      this.pdfDocInstance = pdf;
      this.pdfPageCount.set(pdf.numPages);
      const pages = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
      this.pdfPagesList.set(pages);
      this.currentPdfPage.set(1);
      this.isPdfLoaded.set(true);
      this.isPdfViewerOpen.set(true);

      setTimeout(() => {
        this.fitPdfWidth();
      }, 100);
    } catch (e) {
      console.warn('PDF document load error:', e);
    } finally {
      this.isRenderingPdf.set(false);
    }
  }

  public currentPdfPage = signal<number>(1);

  public async renderAllPages(): Promise<void> {
    if (!this.pdfDocInstance) return;
    const zoom = this.pdfZoom();
    const dpr = window.devicePixelRatio || 1;

    let firstCanvas = document.getElementById('pdf-canvas-1');
    if (!firstCanvas) {
      await new Promise((r) => setTimeout(r, 120));
    }

    for (let pageNum = 1; pageNum <= this.pdfDocInstance.numPages; pageNum++) {
      const canvas = document.getElementById('pdf-canvas-' + pageNum) as HTMLCanvasElement;
      if (!canvas) continue;

      try {
        const page = await this.pdfDocInstance.getPage(pageNum);
        const viewport = page.getViewport({ scale: zoom });

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = Math.floor(viewport.width) + 'px';
        canvas.style.height = Math.floor(viewport.height) + 'px';

        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport
        };
        await page.render(renderContext).promise;
      } catch (err) {
        console.warn(`Error rendering page ${pageNum}:`, err);
      }
    }
  }

  public async fitPdfWidth(): Promise<void> {
    if (!this.pdfDocInstance) return;
    try {
      const page = await this.pdfDocInstance.getPage(1);
      const baseViewport = page.getViewport({ scale: 1.0 });
      const scroller = document.querySelector('.pdf-single-page-scrollable') as HTMLElement;
      if (scroller && baseViewport.width > 0) {
        const availableWidth = scroller.clientWidth - 40;
        if (availableWidth > 50) {
          const fitRatio = availableWidth / baseViewport.width;
          const cleanZoom = Math.min(2.0, Math.max(0.3, fitRatio));
          this.pdfZoom.set(Number(cleanZoom.toFixed(2)));
        } else {
          this.pdfZoom.set(0.70);
        }
      } else {
        this.pdfZoom.set(0.70);
      }
    } catch {
      this.pdfZoom.set(0.70);
    }
    this.renderAllPages();
  }

  public onPdfScroll(event: Event): void {
    const scroller = event.target as HTMLElement;
    if (!scroller || this.pdfPageCount() <= 1) return;

    const scrollTop = scroller.scrollTop;
    const cards = Array.from(scroller.querySelectorAll('.pdf-page-card')) as HTMLElement[];
    let activePage = 1;
    let minDistance = Infinity;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const offsetTop = card.offsetTop - scroller.offsetTop;
      const distance = Math.abs(scrollTop - offsetTop);
      if (distance < minDistance) {
        minDistance = distance;
        activePage = i + 1;
      }
    }

    if (this.currentPdfPage() !== activePage) {
      this.currentPdfPage.set(activePage);
    }
  }

  public scrollToPage(pageNum: number): void {
    const targetPage = Math.max(1, Math.min(this.pdfPageCount(), pageNum));
    this.currentPdfPage.set(targetPage);
    const card = document.getElementById('pdf-page-card-' + targetPage);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  public prevPdfPage(): void {
    this.scrollToPage(this.currentPdfPage() - 1);
  }

  public nextPdfPage(): void {
    this.scrollToPage(this.currentPdfPage() + 1);
  }

  public zoomPdf(delta: number): void {
    const newZoom = Math.min(2.5, Math.max(0.3, this.pdfZoom() + delta));
    this.pdfZoom.set(Number(newZoom.toFixed(2)));
    this.renderAllPages();
  }

  public resetPdfZoom(): void {
    this.fitPdfWidth();
  }

  public togglePdfViewer(): void {
    this.isPdfViewerOpen.set(!this.isPdfViewerOpen());
    if (this.isPdfViewerOpen()) {
      setTimeout(() => this.fitPdfWidth(), 100);
    }
  }

  public hasIncludedItems(group: DescriptionGroup): boolean {
    return (group.items || []).some((t) => Boolean(t.includedFrom));
  }

  public getIncludedFromLabel(from?: string): string {
    if (from === 'duplicates') return 'Duplicates';
    if (from === 'incomes') return 'Incomes';
    if (from === 'excluded') return 'Excluded';
    if (from === 'deleted') return 'Recently Deleted';
    return 'Source';
  }

  public isIncomeShifted(tx: Transaction): boolean {
    const curM = (tx.date || '').slice(0, 7);
    return Boolean(tx.incomeMonth && tx.incomeMonth !== curM);
  }

  public getIncomeMonthBadgeLabel(tx: Transaction): string {
    const curM = (tx.date || '').slice(0, 7);
    if (!tx.incomeMonth || tx.incomeMonth === curM) return '';
    const targetMonthName = this.service.formatMonthName(tx.incomeMonth);
    return `📅 For ${targetMonthName}`;
  }

  public getIncomeMonthBadgeTooltip(tx: Transaction): string {
    const curM = (tx.date || '').slice(0, 7);
    if (!tx.incomeMonth || tx.incomeMonth === curM) return '';
    const prevMonth = this.service.formatMonth(curM);
    const targetMonth = this.service.formatMonth(tx.incomeMonth);
    return `Assigned to fund ${targetMonth}'s budget. Click to move back to ${prevMonth}.`;
  }

  public getIncomeMonthButtonLabel(tx: Transaction): string {
    const curM = (tx.date || '').slice(0, 7);
    if (this.isIncomeShifted(tx)) {
      const prevMonthName = this.service.formatMonthName(curM);
      return `↩ Back to ${prevMonthName}`;
    }
    return '📅 Next Month';
  }

  public getIncomeMonthButtonTooltip(tx: Transaction): string {
    const curM = (tx.date || '').slice(0, 7);
    if (this.isIncomeShifted(tx)) {
      const prevMonth = this.service.formatMonth(curM);
      return `Currently assigned to ${this.service.formatMonth(tx.incomeMonth || '')}. Click to move back to ${prevMonth}`;
    }
    const nextMonth = this.service.formatMonth(this.service.getNextMonth(curM));
    return `Shift this income to fund ${nextMonth}'s budget`;
  }

  public toggleIncomeMonth(tx: Transaction): void {
    const curM = (tx.date || '').slice(0, 7);
    const nextM = this.service.getNextMonth(curM);
    tx.incomeMonth = (!tx.incomeMonth || tx.incomeMonth === curM) ? nextM : undefined;
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
    this.service.showToast(
      tx.incomeMonth
        ? `Shifted to ${this.service.formatMonth(tx.incomeMonth)} budget`
        : `Moved back to ${this.service.formatMonth(curM)} budget`,
      'info'
    );
  }

  public isGroupIncomeNextMonth(group: DescriptionGroup): boolean {
    if (!group.items.length) return false;
    return group.items.every((t) => {
      const curM = (t.date || '').slice(0, 7);
      return Boolean(t.incomeMonth && t.incomeMonth !== curM);
    });
  }

  public toggleGroupIncomeMonth(group: DescriptionGroup): void {
    const isAllNext = this.isGroupIncomeNextMonth(group);
    group.items.forEach((t) => {
      const curM = (t.date || '').slice(0, 7);
      const nextM = this.service.getNextMonth(curM);
      t.incomeMonth = isAllNext ? undefined : nextM;
    });
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
    this.service.showToast(
      isAllNext ? 'Reset group to receipt month' : 'Marked all group items for next month',
      'info'
    );
  }

  public isTransactionsAllNextMonth(txs: Transaction[]): boolean {
    if (!txs || !txs.length) return false;
    return txs.every((t) => {
      const curM = (t.date || '').slice(0, 7);
      return Boolean(t.incomeMonth && t.incomeMonth !== curM);
    });
  }

  public toggleTransactionsIncomeMonth(txs: Transaction[]): void {
    if (!txs || !txs.length) return;
    const isAllNext = this.isTransactionsAllNextMonth(txs);
    txs.forEach((t) => {
      const curM = (t.date || '').slice(0, 7);
      const nextM = this.service.getNextMonth(curM);
      t.incomeMonth = isAllNext ? undefined : nextM;
    });
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
    this.service.showToast(
      isAllNext ? 'Reset group to receipt month' : 'Marked all group items for respective next month',
      'info'
    );
  }

  public isCategoryAllIncomes(rawCategory: string): boolean {
    const txs = this.getTransactionsForCategory(rawCategory);
    return txs.length > 0 && txs.every((t) => this.isIncomeTx(t));
  }

  public isCategoryIncomeNextMonth(rawCategory: string): boolean {
    return this.isTransactionsAllNextMonth(this.getTransactionsForCategory(rawCategory));
  }

  public toggleCategoryIncomeMonth(rawCategory: string): void {
    this.toggleTransactionsIncomeMonth(this.getTransactionsForCategory(rawCategory));
  }

  public isDescriptionAllIncomes(desc: string): boolean {
    const txs = this.getTransactionsForDescription(desc);
    return txs.length > 0 && txs.every((t) => this.isIncomeTx(t));
  }

  public isDescriptionIncomeNextMonth(desc: string): boolean {
    return this.isTransactionsAllNextMonth(this.getTransactionsForDescription(desc));
  }

  public toggleDescriptionIncomeMonth(desc: string): void {
    this.toggleTransactionsIncomeMonth(this.getTransactionsForDescription(desc));
  }

  public getTransactionsDateRange(txs: Transaction[]): string {
    if (!txs || txs.length === 0) return '';
    const dates = txs.map((t) => t.date).filter(Boolean).sort();
    if (dates.length === 0) return '';
    if (dates[0] === dates[dates.length - 1]) {
      return this.service.formatDate(dates[0]);
    }
    return `${this.service.formatDate(dates[0])} – ${this.service.formatDate(dates[dates.length - 1])}`;
  }

  public getCategoryDateRange(rawCategory: string): string {
    return this.getTransactionsDateRange(this.getTransactionsForCategory(rawCategory));
  }

  public getDescriptionDateRange(desc: string): string {
    return this.getTransactionsDateRange(this.getTransactionsForDescription(desc));
  }

  public includeIncome(tx: Transaction): void {
    const res = this.previewResult();
    if (!res) return;
    const taggedTx: Transaction = { ...tx, includedFrom: 'incomes' };
    this.previewResult.set({
      ...res,
      incomes: res.incomes.filter((t) => t.id !== tx.id),
      transactions: [taggedTx, ...res.transactions],
      incomesCount: Math.max(0, res.incomesCount - 1)
    });
    this.service.showToast('Included transaction in import list', 'success');
  }

  public includeAllIncomes(): void {
    const res = this.previewResult();
    if (!res || res.incomes.length === 0) return;
    const count = res.incomes.length;
    const tagged = res.incomes.map((t) => ({ ...t, includedFrom: 'incomes' as const }));
    this.previewResult.set({
      ...res,
      transactions: [...res.transactions, ...tagged],
      incomes: [],
      incomesCount: 0
    });
    this.service.showToast(`Included all ${count} income/payment rows into import list`, 'success');
  }

  public includeDuplicate(tx: Transaction): void {
    const res = this.previewResult();
    if (!res) return;
    const taggedTx: Transaction = { ...tx, includedFrom: 'duplicates' };
    this.previewResult.set({
      ...res,
      duplicates: res.duplicates.filter((t) => t.id !== tx.id),
      transactions: [taggedTx, ...res.transactions],
      duplicatesCount: Math.max(0, res.duplicatesCount - 1)
    });
    this.service.showToast('Included transaction in import list', 'success');
  }

  public includeAllDuplicates(): void {
    const res = this.previewResult();
    if (!res || res.duplicates.length === 0) return;
    const count = res.duplicates.length;
    const tagged = res.duplicates.map((t) => ({ ...t, includedFrom: 'duplicates' as const }));
    this.previewResult.set({
      ...res,
      transactions: [...res.transactions, ...tagged],
      duplicates: [],
      duplicatesCount: 0
    });
    this.service.showToast(`Included all ${count} duplicate rows into import list`, 'success');
  }

  public includeExcluded(tx: Transaction): void {
    const res = this.previewResult();
    if (!res) return;
    const taggedTx: Transaction = { ...tx, includedFrom: 'excluded' };
    this.previewResult.set({
      ...res,
      excluded: res.excluded.filter((t) => t.id !== tx.id),
      transactions: [taggedTx, ...res.transactions],
      excludedCount: Math.max(0, res.excludedCount - 1)
    });
    this.service.showToast('Included transaction in import list', 'success');
  }

  public includeDeleted(tx: Transaction): void {
    const res = this.previewResult();
    if (!res) return;
    this.service.restoreDeletedSignature(this.service.getTransactionSignature(tx), tx);
    const taggedTx: Transaction = { ...tx, includedFrom: 'deleted' };
    this.previewResult.set({
      ...res,
      deleted: (res.deleted || []).filter((t) => t.id !== tx.id),
      transactions: [taggedTx, ...res.transactions],
      deletedCount: Math.max(0, (res.deletedCount || 0) - 1)
    });
    this.service.showToast('Restored transaction into import list', 'success');
  }

  public includeAllDeleted(): void {
    const res = this.previewResult();
    if (!res || !res.deleted || res.deleted.length === 0) return;
    const count = res.deleted.length;
    res.deleted.forEach((t) => this.service.restoreDeletedSignature(this.service.getTransactionSignature(t), t));
    const tagged = res.deleted.map((t) => ({ ...t, includedFrom: 'deleted' as const }));
    this.previewResult.set({
      ...res,
      transactions: [...res.transactions, ...tagged],
      deleted: [],
      deletedCount: 0
    });
    this.service.showToast(`Restored all ${count} previously deleted rows into import list`, 'success');
  }

  public excludeIncludedTransaction(tx: Transaction): void {
    const res = this.previewResult();
    if (!res) return;
    const fromTab = tx.includedFrom || 'duplicates';
    const cleanedTx: Transaction = { ...tx };
    delete cleanedTx.includedFrom;

    const remainingTxs = res.transactions.filter((t) => t.id !== tx.id);

    if (fromTab === 'duplicates') {
      this.previewResult.set({
        ...res,
        transactions: remainingTxs,
        duplicates: [cleanedTx, ...res.duplicates],
        duplicatesCount: (res.duplicatesCount || 0) + 1
      });
      this.service.showToast('Returned transaction back to Duplicates', 'info');
    } else if (fromTab === 'incomes') {
      this.previewResult.set({
        ...res,
        transactions: remainingTxs,
        incomes: [cleanedTx, ...res.incomes],
        incomesCount: (res.incomesCount || 0) + 1
      });
      this.service.showToast('Returned transaction back to Incomes', 'info');
    } else if (fromTab === 'excluded') {
      this.previewResult.set({
        ...res,
        transactions: remainingTxs,
        excluded: [cleanedTx, ...res.excluded],
        excludedCount: (res.excludedCount || 0) + 1
      });
      this.service.showToast('Returned transaction back to Excluded', 'info');
    } else if (fromTab === 'deleted') {
      this.service.recordDeletedTransaction(cleanedTx);
      this.previewResult.set({
        ...res,
        transactions: remainingTxs,
        deleted: [cleanedTx, ...(res.deleted || [])],
        deletedCount: (res.deletedCount || 0) + 1
      });
      this.service.showToast('Returned transaction back to Recently Deleted', 'info');
    }
  }

  // EveryDollar-style View Modes & Batch Mapping State
  public importGroupByMode = signal<'table' | 'category' | 'description'>('table');
  public categoryMatchKeyword = signal<string>('');
  public typeMatchKeyword = signal<string>('');
  public typeBatchItem = signal<string>('');
  public typeBatchGroup = signal<string>('');
  public typeExcludeAssigned = signal<boolean>(false);
  public categoryExcludeIncome = signal<boolean>(false);

  public descriptionMatchKeyword = signal<string>('');
  public descriptionBatchItem = signal<string>('');
  public descriptionBatchGroup = signal<string>('');
  public descriptionBatchNote = '';
  public descExcludeAssigned = signal<boolean>(false);

  public excludedOwners = signal<string[]>([]);
  public isOwnerExcludeDropdownOpen = signal<boolean>(false);

  public expandedCategory = signal<string | null>(null);
  public expandedDescription = signal<string | null>(null);
  public selectedCategoryFilter = signal<string | null>(null);
  public selectedDescriptionFilter = signal<string | null>(null);

  public categoryDisplayLimit = signal<number>(60);
  public descriptionDisplayLimit = signal<number>(60);
  public showPreviewTable = signal<boolean>(true);

  public categoryShowAllTxs = signal<Set<string>>(new Set());
  public allCategoryDrawersShowAll = signal<boolean>(false);
  public descriptionShowAllTxs = signal<Set<string>>(new Set());

  // Description Grouping for Valid Transactions
  public isGroupByDescription = signal<boolean>(false);
  public expandedDescriptionGroups = signal<Set<string>>(new Set());

  public setGroupByMode(mode: 'table' | 'category' | 'description'): void {
    this.importGroupByMode.set(mode);
    this.isGroupByDescription.set(mode === 'description');
    this.expandedCategory.set(null);
    this.expandedDescription.set(null);
  }

  public onToggleGroupByDescription(val: boolean): void {
    this.setGroupByMode(val ? 'description' : 'table');
  }

  public categoryMappings = computed<ImportCategoryMapping[]>(() => {
    const res = this.previewResult();
    if (!res || !res.transactions) return [];
    const txs = res.transactions;

    const map = new Map<string, {
      count: number;
      totalAmount: number;
      isIncome: boolean;
      items: Transaction[];
    }>();

    for (const tx of txs) {
      const cat = (tx.rawCategory || tx.categoryItem || 'Uncategorized').trim();
      const existing = map.get(cat) || { count: 0, totalAmount: 0, isIncome: false, items: [] };
      existing.count++;
      existing.totalAmount += Number(tx.amount) || 0;
      if (this.isIncomeTx(tx)) {
        existing.isIncome = true;
      }
      existing.items.push(tx);
      map.set(cat, existing);
    }

    const defaultPerson = this.selectedOwner() || this.service.personOne().name;
    const result: ImportCategoryMapping[] = [];

    map.forEach((val, rawCategory) => {
      const definedItem = val.items.find((t) => t.categoryItem && t.categoryItem !== 'Uncategorized');
      const definedGroup = val.items.find((t) => t.categoryGroup && t.categoryGroup !== 'Uncategorized');
      const firstBeneficiary = val.items[0] ? this.getTxBeneficiary(val.items[0]) : '';
      const allSameBeneficiary = val.items.length > 0 && val.items.every((t) => this.getTxBeneficiary(t) === firstBeneficiary);

      result.push({
        rawCategory,
        count: val.count,
        totalAmount: Math.round(val.totalAmount * 100) / 100,
        selectedItem: definedItem?.categoryItem || 'Uncategorized',
        selectedGroup: definedGroup?.categoryGroup || 'Uncategorized',
        selectedPerson: allSameBeneficiary && firstBeneficiary !== 'SPLIT' ? firstBeneficiary : '',
        selectedSplitType: allSameBeneficiary && firstBeneficiary === 'SPLIT' ? 'SPLIT' : (allSameBeneficiary ? 'SELF' : ''),
        isIncome: val.isIncome
      });
    });

    return result.sort((a, b) => b.count - a.count);
  });

  public descriptionMappings = computed<ImportDescriptionMapping[]>(() => {
    const res = this.previewResult();
    if (!res || !res.transactions) return [];
    const txs = res.transactions;

    const map = new Map<string, {
      count: number;
      totalAmount: number;
      isIncome: boolean;
      items: Transaction[];
    }>();

    for (const tx of txs) {
      const desc = (tx.description || tx.merchant || 'Unspecified').trim();
      const existing = map.get(desc) || { count: 0, totalAmount: 0, isIncome: false, items: [] };
      existing.count++;
      existing.totalAmount += Number(tx.amount) || 0;
      if (this.isIncomeTx(tx)) {
        existing.isIncome = true;
      }
      existing.items.push(tx);
      map.set(desc, existing);
    }

    const defaultPerson = this.selectedOwner() || this.service.personOne().name;
    const result: ImportDescriptionMapping[] = [];

    map.forEach((val, description) => {
      const definedItem = val.items.find((t) => t.categoryItem && t.categoryItem !== 'Uncategorized');
      const definedGroup = val.items.find((t) => t.categoryGroup && t.categoryGroup !== 'Uncategorized');
      const firstBeneficiary = val.items[0] ? this.getTxBeneficiary(val.items[0]) : '';
      const allSameBeneficiary = val.items.length > 0 && val.items.every((t) => this.getTxBeneficiary(t) === firstBeneficiary);
      const rawCategories = Array.from(
        new Set(val.items.map((t) => (t.rawCategory || t.categoryItem || '').trim()).filter(Boolean))
      );

      const unassignedCount = val.items.filter((t) => !t.categoryItem || t.categoryItem === 'Uncategorized').length;
      const isFullyAssigned = unassignedCount === 0;

      result.push({
        description,
        count: val.count,
        totalAmount: Math.round(val.totalAmount * 100) / 100,
        selectedItem: definedItem?.categoryItem || 'Uncategorized',
        selectedGroup: definedGroup?.categoryGroup || 'Uncategorized',
        selectedPerson: allSameBeneficiary && firstBeneficiary !== 'SPLIT' ? firstBeneficiary : '',
        selectedSplitType: allSameBeneficiary && firstBeneficiary === 'SPLIT' ? 'SPLIT' : (allSameBeneficiary ? 'SELF' : ''),
        rawCategories,
        isIncome: val.isIncome,
        isFullyAssigned,
        unassignedCount
      });
    });

    return result.sort((a, b) => b.count - a.count);
  });

  public displayedCategoryMappings = computed<ImportCategoryMapping[]>(() => {
    let list = this.categoryMappings();
    if (this.descExcludeAssigned()) {
      list = list.filter((m) => !m.selectedItem || m.selectedItem === 'Uncategorized');
    }
    const q = (this.descriptionMatchKeyword() || this.categoryMatchKeyword() || this.typeMatchKeyword()).trim().toLowerCase();
    if (!q) return list;

    const matched: ImportCategoryMapping[] = [];
    const unmatched: ImportCategoryMapping[] = [];

    for (const m of list) {
      if (m.rawCategory.toLowerCase().includes(q)) {
        matched.push(m);
      } else {
        unmatched.push(m);
      }
    }
    return [...matched, ...unmatched];
  });

  public displayedDescriptionMappings = computed<ImportDescriptionMapping[]>(() => {
    let list = this.descriptionMappings();
    if (this.descExcludeAssigned()) {
      list = list.filter((d) => !d.isFullyAssigned);
    }
    const q = this.descriptionMatchKeyword().trim().toLowerCase();
    if (!q) return list;

    const matched: ImportDescriptionMapping[] = [];
    const unmatched: ImportDescriptionMapping[] = [];

    for (const d of list) {
      if (d.description.toLowerCase().includes(q)) {
        matched.push(d);
      } else {
        unmatched.push(d);
      }
    }
    return [...matched, ...unmatched];
  });

  public multiDescriptionMappings = computed<ImportDescriptionMapping[]>(() => {
    return this.displayedDescriptionMappings().filter((d) => d.count > 1);
  });

  public singleDescriptionMappings = computed<ImportDescriptionMapping[]>(() => {
    return this.displayedDescriptionMappings().filter((d) => d.count === 1);
  });

  public singleDescriptionTransactions = computed<Transaction[]>(() => {
    const singleDescs = new Set(this.singleDescriptionMappings().map((d) => d.description));
    if (singleDescs.size === 0) return [];
    const res = this.previewResult();
    if (!res || !res.transactions) return [];
    const list = res.transactions.filter((t) => {
      const desc = (t.description || t.merchant || 'Unspecified').trim();
      return singleDescs.has(desc);
    });
    return this.sortTxList(list);
  });

  public isCategoryMatched(rawCategory: string): boolean {
    const q = (this.descriptionMatchKeyword() || this.categoryMatchKeyword() || this.typeMatchKeyword()).trim().toLowerCase();
    if (!q) return false;
    return rawCategory.toLowerCase().includes(q);
  }

  public isDescriptionMatched(desc: string): boolean {
    const q = this.descriptionMatchKeyword().trim().toLowerCase();
    if (!q) return false;
    return desc.toLowerCase().includes(q);
  }

  public isFirstUnmatched(m: ImportCategoryMapping, idx: number): boolean {
    const q = (this.descriptionMatchKeyword() || this.categoryMatchKeyword() || this.typeMatchKeyword()).trim().toLowerCase();
    if (!q) return false;
    if (this.isCategoryMatched(m.rawCategory)) return false;
    const list = this.displayedCategoryMappings();
    return idx > 0 && this.isCategoryMatched(list[idx - 1].rawCategory);
  }

  public isFirstUnmatchedDescription(d: ImportDescriptionMapping, idx: number): boolean {
    const q = this.descriptionMatchKeyword().trim().toLowerCase();
    if (!q) return false;
    if (this.isDescriptionMatched(d.description)) return false;
    const list = this.multiDescriptionMappings();
    return idx > 0 && this.isDescriptionMatched(list[idx - 1].description);
  }

  public getHighlightedCategoryHtml(rawCategory: string): string {
    const q = (this.descriptionMatchKeyword() || this.categoryMatchKeyword() || this.typeMatchKeyword()).trim();
    if (!q || !rawCategory) return rawCategory || 'Uncategorized';
    const regex = new RegExp(`(${this.escapeRegex(q)})`, 'gi');
    return rawCategory.replace(regex, '<span class="ed-highlight-mark">$1</span>');
  }

  public getHighlightedDescriptionHtml(desc: string): string {
    const q = this.descriptionMatchKeyword().trim();
    if (!q || !desc) return desc || 'Unspecified';
    const regex = new RegExp(`(${this.escapeRegex(q)})`, 'gi');
    return desc.replace(regex, '<span class="ed-highlight-mark">$1</span>');
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  public toggleExpandCategory(rawCategory: string): void {
    this.expandedCategory.update((curr) => (curr === rawCategory ? null : rawCategory));
  }

  public toggleExpandDescription(desc: string): void {
    this.expandedDescription.update((curr) => (curr === desc ? null : desc));
  }

  public setCategoryFilter(cat: string | null): void {
    this.selectedCategoryFilter.set(cat);
    this.selectedDescriptionFilter.set(null);
    if (cat) {
      this.showPreviewTable.set(true);
    }
  }

  public setDescriptionFilter(desc: string | null): void {
    this.selectedDescriptionFilter.set(desc);
    this.selectedCategoryFilter.set(null);
    if (desc) {
      this.showPreviewTable.set(true);
    }
  }

  public toggleOwnerExcludeDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.isOwnerExcludeDropdownOpen.update((v) => !v);
  }

  public getExcludedOwnersLabel(): string {
    const list = this.excludedOwners();
    if (list.length === 0) return 'None';
    if (list.length <= 2) return list.join(', ');
    return `${list.length} persons`;
  }

  public isOwnerExcluded(personName: string): boolean {
    return this.excludedOwners().includes(personName);
  }

  public toggleOwnerExclude(personName: string): void {
    this.excludedOwners.update((curr) =>
      curr.includes(personName) ? curr.filter((x) => x !== personName) : [...curr, personName]
    );
  }

  public clearOwnerExclusions(): void {
    this.excludedOwners.set([]);
  }

  public isCategoryOwnerExcluded(m: ImportCategoryMapping): boolean {
    const excluded = this.excludedOwners();
    if (excluded.length === 0) return false;
    return excluded.includes(m.selectedPerson);
  }

  public isDescriptionMappingOwnerExcluded(m: ImportDescriptionMapping): boolean {
    const excluded = this.excludedOwners();
    if (excluded.length === 0) return false;
    return excluded.includes(m.selectedPerson);
  }

  public isTxOwnerExcluded(tx: Transaction): boolean {
    const excluded = this.excludedOwners();
    if (excluded.length === 0) return false;
    return excluded.includes(tx.paidBy);
  }

  public getTransactionsForCategory(rawCategory: string): Transaction[] {
    const res = this.previewResult();
    if (!res) return [];
    return res.transactions.filter(
      (t) => (t.rawCategory || t.categoryItem || 'Uncategorized').trim() === rawCategory
    );
  }

  public getTransactionsForDescription(desc: string): Transaction[] {
    const res = this.previewResult();
    if (!res) return [];
    return res.transactions.filter(
      (t) => (t.description || t.merchant || 'Unspecified').trim() === desc
    );
  }

  public isCategoryShowingAll(rawCategory: string): boolean {
    return this.allCategoryDrawersShowAll() || this.categoryShowAllTxs().has(rawCategory);
  }

  public toggleCategoryShowAll(rawCategory: string): void {
    const current = new Set(this.categoryShowAllTxs());
    if (this.allCategoryDrawersShowAll()) {
      this.allCategoryDrawersShowAll.set(false);
      this.categoryMappings().forEach((m) => {
        if (m.rawCategory !== rawCategory) {
          current.add(m.rawCategory);
        }
      });
      current.delete(rawCategory);
    } else if (current.has(rawCategory)) {
      current.delete(rawCategory);
    } else {
      current.add(rawCategory);
    }
    this.categoryShowAllTxs.set(current);
  }

  public toggleAllCategoryDrawersShowAll(): void {
    const nextState = !this.allCategoryDrawersShowAll();
    this.allCategoryDrawersShowAll.set(nextState);
    if (!nextState) {
      this.categoryShowAllTxs.set(new Set());
    }
  }

  public isDescriptionShowingAll(desc: string): boolean {
    return this.descriptionShowAllTxs().has(desc);
  }

  public toggleDescriptionShowAll(desc: string): void {
    const current = new Set(this.descriptionShowAllTxs());
    if (current.has(desc)) {
      current.delete(desc);
    } else {
      current.add(desc);
    }
    this.descriptionShowAllTxs.set(current);
  }

  public getCategoryDisplayedTransactions(rawCategory: string): Transaction[] {
    const txs = this.getTransactionsForCategory(rawCategory);
    if (this.isCategoryShowingAll(rawCategory)) {
      return txs;
    }
    return txs.slice(0, 50);
  }

  public getDescriptionDisplayedTransactions(desc: string): Transaction[] {
    const txs = this.getTransactionsForDescription(desc);
    if (this.isDescriptionShowingAll(desc)) {
      return txs;
    }
    return txs.slice(0, 50);
  }

  public isCategoryDone(rawCategory: string): boolean {
    const txs = this.getTransactionsForCategory(rawCategory);
    return txs.length > 0 && txs.every((tx) => tx.isDone);
  }

  public toggleCategoryDone(rawCategory: string): void {
    const txs = this.getTransactionsForCategory(rawCategory);
    if (txs.length === 0) return;
    const targetState = !this.isCategoryDone(rawCategory);
    txs.forEach((tx) => {
      tx.isDone = targetState;
    });
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
    this.service.showToast(
      targetState
        ? `✓ Marked all ${txs.length} "${rawCategory}" items as done`
        : `↩ Unmarked done for all ${txs.length} "${rawCategory}" items`,
      'info'
    );
  }

  public isDescriptionDone(description: string): boolean {
    const txs = this.getTransactionsForDescription(description);
    return txs.length > 0 && txs.every((tx) => tx.isDone);
  }

  public toggleDescriptionDone(description: string): void {
    const txs = this.getTransactionsForDescription(description);
    if (txs.length === 0) return;
    const targetState = !this.isDescriptionDone(description);
    txs.forEach((tx) => {
      tx.isDone = targetState;
    });
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
    this.service.showToast(
      targetState
        ? `✓ Marked all ${txs.length} "${description}" items as done`
        : `↩ Unmarked done for all ${txs.length} "${description}" items`,
      'info'
    );
  }

  public getCategoryNote(rawCategory: string): string {
    const txs = this.getTransactionsForCategory(rawCategory);
    if (txs.length === 0) return '';
    const firstNote = txs[0].note || '';
    const allSame = txs.every((t) => (t.note || '') === firstNote);
    return allSame ? firstNote : '';
  }

  public isCategoryNoteMixed(rawCategory: string): boolean {
    const txs = this.getTransactionsForCategory(rawCategory);
    if (txs.length <= 1) return false;
    const firstNote = txs[0].note || '';
    return !txs.every((t) => (t.note || '') === firstNote);
  }

  public onCategoryNoteChange(rawCategory: string, newNote: string): void {
    const txs = this.getTransactionsForCategory(rawCategory);
    txs.forEach((tx) => {
      tx.note = newNote;
    });
  }

  public getDescriptionNote(desc: string): string {
    const txs = this.getTransactionsForDescription(desc);
    if (txs.length === 0) return '';
    const firstNote = txs[0].note || '';
    const allSame = txs.every((t) => (t.note || '') === firstNote);
    return allSame ? firstNote : '';
  }

  public isDescriptionNoteMixed(desc: string): boolean {
    const txs = this.getTransactionsForDescription(desc);
    if (txs.length <= 1) return false;
    const firstNote = txs[0].note || '';
    return !txs.every((t) => (t.note || '') === firstNote);
  }

  public onDescriptionNoteChange(desc: string, newNote: string): void {
    const txs = this.getTransactionsForDescription(desc);
    txs.forEach((tx) => {
      tx.note = newNote;
    });
  }

  public trackCategoryMapping(_index: number, m: ImportCategoryMapping): string {
    return m.rawCategory;
  }

  public trackDescriptionMapping(_index: number, d: ImportDescriptionMapping): string {
    return d.description;
  }

  public setTxSplit(tx: Transaction, split: SplitType): void {
    tx.splitType = split;
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
  }

  public setTxPerson(tx: Transaction, person: string): void {
    tx.splitType = tx.paidBy === person ? 'SELF' : 'OTHER';
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
  }

  public onCategorySplitTypeChange(rawCategory: string, splitType: SplitType): void {
    const res = this.previewResult();
    if (!res) return;
    for (const tx of res.transactions) {
      if ((tx.rawCategory || tx.categoryItem || 'Uncategorized').trim() === rawCategory) {
        tx.splitType = splitType;
      }
    }
    this.previewResult.set({ ...res });
  }

  public onCategoryPersonChange(rawCategory: string, personName: string): void {
    const res = this.previewResult();
    if (!res) return;
    for (const tx of res.transactions) {
      if ((tx.rawCategory || tx.categoryItem || 'Uncategorized').trim() === rawCategory) {
        tx.splitType = tx.paidBy === personName ? 'SELF' : 'OTHER';
      }
    }
    this.previewResult.set({ ...res });
  }

  public onCategoryMappingChange(rawCategory: string, selection: { item: string; group?: string }): void {
    const chosenItem = selection.item || 'Uncategorized';
    let chosenGroup = selection.group || 'Uncategorized';
    if (chosenGroup === 'Uncategorized' && chosenItem !== 'Uncategorized') {
      for (const g of this.service.categoryGroups()) {
        if (g.items.some((i) => i.name === chosenItem)) {
          chosenGroup = g.name;
          break;
        }
      }
    }

    const res = this.previewResult();
    if (!res) return;
    const isIncome = chosenGroup.toLowerCase().includes('income');

    for (const tx of res.transactions) {
      if ((tx.rawCategory || tx.categoryItem || 'Uncategorized').trim() === rawCategory) {
        tx.categoryItem = chosenItem;
        tx.categoryGroup = chosenGroup;
        if (isIncome) {
          tx.type = 'INCOME';
        }
      }
    }
    this.previewResult.set({ ...res });
  }

  public onDescriptionSplitTypeChange(desc: string, splitType: SplitType): void {
    const res = this.previewResult();
    if (!res) return;
    for (const tx of res.transactions) {
      if ((tx.description || tx.merchant || 'Unspecified').trim() === desc) {
        tx.splitType = splitType;
      }
    }
    this.previewResult.set({ ...res });
  }

  public onDescriptionPersonChange(desc: string, personName: string): void {
    const res = this.previewResult();
    if (!res) return;
    for (const tx of res.transactions) {
      if ((tx.description || tx.merchant || 'Unspecified').trim() === desc) {
        tx.splitType = tx.paidBy === personName ? 'SELF' : 'OTHER';
      }
    }
    this.previewResult.set({ ...res });
  }

  public onDescriptionMappingCategoryChange(desc: string, selection: { item: string; group?: string }): void {
    const chosenItem = selection.item || 'Uncategorized';
    let chosenGroup = selection.group || 'Uncategorized';
    if (chosenGroup === 'Uncategorized' && chosenItem !== 'Uncategorized') {
      for (const g of this.service.categoryGroups()) {
        if (g.items.some((i) => i.name === chosenItem)) {
          chosenGroup = g.name;
          break;
        }
      }
    }

    const res = this.previewResult();
    if (!res) return;
    const isIncome = chosenGroup.toLowerCase().includes('income');

    for (const tx of res.transactions) {
      if ((tx.description || tx.merchant || 'Unspecified').trim() === desc) {
        tx.categoryItem = chosenItem;
        tx.categoryGroup = chosenGroup;
        if (isIncome) {
          tx.type = 'INCOME';
        }
      }
    }
    this.previewResult.set({ ...res });
  }

  public getMatchingCategoriesCount(keyword: string): number {
    const q = (keyword || '').trim().toLowerCase();
    if (!q) return 0;
    const excludeIncome = this.categoryExcludeIncome();
    const res = this.previewResult();
    if (!res) return 0;

    let count = 0;
    for (const t of res.transactions) {
      if (excludeIncome && (t.type === 'INCOME' || (t.categoryGroup || '').toLowerCase().includes('income'))) {
        continue;
      }
      if (this.isTxOwnerExcluded(t)) {
        continue;
      }
      const cat = (t.rawCategory || t.categoryItem || 'Uncategorized').toLowerCase();
      if (cat.includes(q)) {
        count++;
      }
    }
    return count;
  }

  public getTypeMatchingCategoriesCount(keyword: string): number {
    const q = (keyword || '').trim().toLowerCase();
    if (!q) return 0;
    const excludeAssigned = this.typeExcludeAssigned();
    const excludeIncome = this.categoryExcludeIncome();
    const res = this.previewResult();
    if (!res) return 0;

    let count = 0;
    for (const t of res.transactions) {
      if (excludeIncome && (t.type === 'INCOME' || (t.categoryGroup || '').toLowerCase().includes('income'))) {
        continue;
      }
      if (excludeAssigned && t.categoryItem && t.categoryItem !== 'Uncategorized') {
        continue;
      }
      const cat = (t.rawCategory || t.categoryItem || 'Uncategorized').toLowerCase();
      if (cat.includes(q)) {
        count++;
      }
    }
    return count;
  }

  public getMatchingTransactionsByDescriptionCount(keyword: string): number {
    const q = (keyword || '').trim().toLowerCase();
    if (!q) return 0;
    const res = this.previewResult();
    if (!res) return 0;

    let count = 0;
    for (const t of res.transactions) {
      if (this.isTxOwnerExcluded(t)) {
        continue;
      }
      if (
        (t.description || '').toLowerCase().includes(q) ||
        (t.merchant || '').toLowerCase().includes(q) ||
        (t.rawCategory || '').toLowerCase().includes(q)
      ) {
        count++;
      }
    }
    return count;
  }

  public getDescriptionMatchingCount(keyword: string): number {
    const q = (keyword || '').trim().toLowerCase();
    if (!q) return 0;
    const excludeAssigned = this.descExcludeAssigned();
    const res = this.previewResult();
    if (!res) return 0;

    let count = 0;
    for (const t of res.transactions) {
      if (this.isTxOwnerExcluded(t)) {
        continue;
      }
      if (excludeAssigned && t.categoryItem && t.categoryItem !== 'Uncategorized') {
        continue;
      }
      if (
        (t.description || '').toLowerCase().includes(q) ||
        (t.merchant || '').toLowerCase().includes(q) ||
        (t.rawCategory || '').toLowerCase().includes(q)
      ) {
        count++;
      }
    }
    return count;
  }

  public assignMatchingCategoriesToPerson(personName: string): void {
    const q = this.categoryMatchKeyword().trim().toLowerCase();
    if (!q) {
      this.service.showToast('Please type a category name in the box to match.', 'info');
      return;
    }

    const res = this.previewResult();
    if (!res) return;

    const excludeIncome = this.categoryExcludeIncome();
    let matchedCount = 0;
    let skippedExcludedOwner = 0;
    let skippedIncome = 0;

    for (const t of res.transactions) {
      const cat = (t.rawCategory || t.categoryItem || 'Uncategorized').toLowerCase();
      if (cat.includes(q)) {
        if (excludeIncome && (t.type === 'INCOME' || (t.categoryGroup || '').toLowerCase().includes('income'))) {
          skippedIncome++;
          continue;
        }
        if (this.isTxOwnerExcluded(t)) {
          skippedExcludedOwner++;
          continue;
        }
        t.splitType = t.paidBy === personName ? 'SELF' : 'OTHER';
        matchedCount++;
      }
    }

    this.previewResult.set({ ...res });

    if (matchedCount === 0) {
      if (skippedExcludedOwner > 0) {
        this.service.showToast(`All matching transactions belong to excluded owners (${skippedExcludedOwner} skipped).`, 'info');
      } else if (skippedIncome > 0) {
        this.service.showToast(`All matching transactions are income (${skippedIncome} skipped).`, 'info');
      } else {
        this.service.showToast(`No transactions found in categories containing "${this.categoryMatchKeyword().trim()}".`, 'info');
      }
      return;
    }

    this.service.showToast(`Assigned split to ${personName} for ${matchedCount} transactions matching "${this.categoryMatchKeyword().trim()}"!`, 'success');
  }

  public assignMatchingCategoriesToSplit(): void {
    const q = this.categoryMatchKeyword().trim().toLowerCase();
    if (!q) {
      this.service.showToast('Please type a category name in the box to match.', 'info');
      return;
    }

    const res = this.previewResult();
    if (!res) return;

    const excludeIncome = this.categoryExcludeIncome();
    let matchedCount = 0;
    let skippedExcludedOwner = 0;
    let skippedIncome = 0;

    for (const t of res.transactions) {
      const cat = (t.rawCategory || t.categoryItem || 'Uncategorized').toLowerCase();
      if (cat.includes(q)) {
        if (excludeIncome && (t.type === 'INCOME' || (t.categoryGroup || '').toLowerCase().includes('income'))) {
          skippedIncome++;
          continue;
        }
        if (this.isTxOwnerExcluded(t)) {
          skippedExcludedOwner++;
          continue;
        }
        t.splitType = 'SPLIT';
        matchedCount++;
      }
    }

    this.previewResult.set({ ...res });

    if (matchedCount === 0) {
      this.service.showToast(`No transactions updated for "${this.categoryMatchKeyword().trim()}".`, 'info');
      return;
    }

    this.service.showToast(`Set ${matchedCount} transactions matching "${this.categoryMatchKeyword().trim()}" to 50/50 Split!`, 'success');
  }

  public assignMatchingCategoriesToType(selection: { item: string; group?: string }): void {
    const chosenItem = selection.item || 'Uncategorized';
    let chosenGroup = selection.group || 'Uncategorized';
    if (chosenGroup === 'Uncategorized' && chosenItem !== 'Uncategorized') {
      for (const g of this.service.categoryGroups()) {
        if (g.items.some((i) => i.name === chosenItem)) {
          chosenGroup = g.name;
          break;
        }
      }
    }

    const q = this.typeMatchKeyword().trim().toLowerCase();
    if (!q) {
      this.service.showToast('Please type text in the match box first.', 'info');
      return;
    }

    const res = this.previewResult();
    if (!res) return;

    const excludeAssigned = this.typeExcludeAssigned();
    const excludeIncome = this.categoryExcludeIncome();
    const isIncome = chosenGroup.toLowerCase().includes('income');

    let matchedCount = 0;
    let skippedCount = 0;

    for (const t of res.transactions) {
      const cat = (t.rawCategory || t.categoryItem || 'Uncategorized').toLowerCase();
      if (cat.includes(q)) {
        if (excludeIncome && (t.type === 'INCOME' || (t.categoryGroup || '').toLowerCase().includes('income'))) {
          continue;
        }
        if (excludeAssigned && t.categoryItem && t.categoryItem !== 'Uncategorized') {
          skippedCount++;
          continue;
        }
        t.categoryItem = chosenItem;
        t.categoryGroup = chosenGroup;
        if (isIncome) {
          t.type = 'INCOME';
        }
        matchedCount++;
      }
    }

    this.previewResult.set({ ...res });
    this.typeBatchItem.set(chosenItem);
    this.typeBatchGroup.set(chosenGroup);

    const skippedMsg = skippedCount > 0 ? ` (${skippedCount} already assigned skipped)` : '';
    this.service.showToast(`Assigned ${matchedCount} transactions matching "${this.typeMatchKeyword().trim()}" to ${chosenItem}!${skippedMsg}`, 'success');
  }

  public assignMatchingDescriptionsToPerson(personName: string): void {
    const q = this.descriptionMatchKeyword().trim().toLowerCase();
    if (!q) {
      this.service.showToast('Please type a keyword in the box to match.', 'info');
      return;
    }

    const res = this.previewResult();
    if (!res) return;

    let matchedCount = 0;
    let skippedCount = 0;

    for (const t of res.transactions) {
      if (
        (t.description || '').toLowerCase().includes(q) ||
        (t.merchant || '').toLowerCase().includes(q) ||
        (t.rawCategory || '').toLowerCase().includes(q)
      ) {
        if (this.isTxOwnerExcluded(t)) {
          skippedCount++;
          continue;
        }
        t.splitType = t.paidBy === personName ? 'SELF' : 'OTHER';
        matchedCount++;
      }
    }

    this.previewResult.set({ ...res });

    if (matchedCount === 0) {
      if (skippedCount > 0) {
        this.service.showToast(`All transactions matching "${this.descriptionMatchKeyword().trim()}" belong to excluded owners (${skippedCount} excluded).`, 'info');
      } else {
        this.service.showToast(`No transactions found matching "${this.descriptionMatchKeyword().trim()}".`, 'info');
      }
      return;
    }

    const skippedMsg = skippedCount > 0 ? ` (${skippedCount} excluded)` : '';
    this.service.showToast(`Assigned split to ${personName} for ${matchedCount} transactions matching "${this.descriptionMatchKeyword().trim()}"!${skippedMsg}`, 'success');
  }

  public assignMatchingDescriptionsToSplit(): void {
    const q = this.descriptionMatchKeyword().trim().toLowerCase();
    if (!q) {
      this.service.showToast('Please type a keyword in the box to match.', 'info');
      return;
    }

    const res = this.previewResult();
    if (!res) return;

    let matchedCount = 0;
    let skippedCount = 0;

    for (const t of res.transactions) {
      if (
        (t.description || '').toLowerCase().includes(q) ||
        (t.merchant || '').toLowerCase().includes(q) ||
        (t.rawCategory || '').toLowerCase().includes(q)
      ) {
        if (this.isTxOwnerExcluded(t)) {
          skippedCount++;
          continue;
        }
        t.splitType = 'SPLIT';
        matchedCount++;
      }
    }

    this.previewResult.set({ ...res });

    if (matchedCount === 0) {
      if (skippedCount > 0) {
        this.service.showToast(`All transactions matching "${this.descriptionMatchKeyword().trim()}" belong to excluded owners (${skippedCount} excluded).`, 'info');
      } else {
        this.service.showToast(`No transactions found matching "${this.descriptionMatchKeyword().trim()}".`, 'info');
      }
      return;
    }

    const skippedMsg = skippedCount > 0 ? ` (${skippedCount} excluded)` : '';
    this.service.showToast(`Set ${matchedCount} transactions matching "${this.descriptionMatchKeyword().trim()}" to 50/50 Split!${skippedMsg}`, 'success');
  }

  public assignMatchingDescriptionsToType(selection: { item: string; group?: string }): void {
    const chosenItem = selection.item || 'Uncategorized';
    let chosenGroup = selection.group || 'Uncategorized';
    if (chosenGroup === 'Uncategorized' && chosenItem !== 'Uncategorized') {
      for (const g of this.service.categoryGroups()) {
        if (g.items.some((i) => i.name === chosenItem)) {
          chosenGroup = g.name;
          break;
        }
      }
    }

    const q = this.descriptionMatchKeyword().trim().toLowerCase();
    if (!q) {
      this.service.showToast('Please type a keyword to match.', 'info');
      return;
    }

    const res = this.previewResult();
    if (!res) return;

    const excludeAssigned = this.descExcludeAssigned();
    const isIncome = chosenGroup.toLowerCase().includes('income');

    let matchedCount = 0;
    let skippedCount = 0;

    for (const t of res.transactions) {
      if (
        (t.description || '').toLowerCase().includes(q) ||
        (t.merchant || '').toLowerCase().includes(q) ||
        (t.rawCategory || '').toLowerCase().includes(q)
      ) {
        if (this.isTxOwnerExcluded(t)) {
          skippedCount++;
          continue;
        }
        if (excludeAssigned && t.categoryItem && t.categoryItem !== 'Uncategorized') {
          skippedCount++;
          continue;
        }
        t.categoryItem = chosenItem;
        t.categoryGroup = chosenGroup;
        if (isIncome) {
          t.type = 'INCOME';
        }
        if (this.descriptionBatchNote.trim()) {
          t.note = this.descriptionBatchNote.trim();
        }
        matchedCount++;
      }
    }

    this.previewResult.set({ ...res });
    this.descriptionBatchItem.set(chosenItem);
    this.descriptionBatchGroup.set(chosenGroup);

    const skippedMsg = skippedCount > 0 ? ` (${skippedCount} skipped)` : '';
    this.service.showToast(`Assigned ${matchedCount} transactions matching "${this.descriptionMatchKeyword().trim()}" to ${chosenItem}!${skippedMsg}`, 'success');
  }

  public assignMatchingDescriptionsToNote(note?: string): void {
    const noteVal = (note !== undefined ? note : this.descriptionBatchNote).trim();
    const q = this.descriptionMatchKeyword().trim().toLowerCase();
    if (!q) {
      this.service.showToast('Please type a keyword to match.', 'info');
      return;
    }

    const res = this.previewResult();
    if (!res) return;

    const excludeAssigned = this.descExcludeAssigned();
    let matchedCount = 0;
    let skippedCount = 0;

    for (const t of res.transactions) {
      if (
        (t.description || '').toLowerCase().includes(q) ||
        (t.merchant || '').toLowerCase().includes(q) ||
        (t.rawCategory || '').toLowerCase().includes(q)
      ) {
        if (this.isTxOwnerExcluded(t)) {
          skippedCount++;
          continue;
        }
        if (excludeAssigned && t.categoryItem && t.categoryItem !== 'Uncategorized') {
          skippedCount++;
          continue;
        }
        t.note = noteVal || undefined;
        matchedCount++;
      }
    }

    this.previewResult.set({ ...res });
    const skippedMsg = skippedCount > 0 ? ` (${skippedCount} already assigned skipped)` : '';
    this.service.showToast(`Set comment on ${matchedCount} transactions matching "${this.descriptionMatchKeyword().trim()}"!${skippedMsg}`, 'success');
  }

  public excludeMatchingTransactions(): void {
    const q = this.descriptionMatchKeyword().trim().toLowerCase();
    if (!q) {
      this.service.showToast('Please enter a keyword to match transactions to exclude.', 'info');
      return;
    }
    const res = this.previewResult();
    if (!res || !res.transactions) return;

    const toExclude: Transaction[] = [];
    const remaining: Transaction[] = [];

    for (const t of res.transactions) {
      if (this.isTxOwnerExcluded(t)) {
        remaining.push(t);
        continue;
      }
      if (
        (t.description || '').toLowerCase().includes(q) ||
        (t.merchant || '').toLowerCase().includes(q) ||
        (t.rawCategory || '').toLowerCase().includes(q)
      ) {
        const cleaned: Transaction = { ...t };
        delete cleaned.includedFrom;
        toExclude.push(cleaned);
      } else {
        remaining.push(t);
      }
    }

    if (toExclude.length === 0) {
      this.service.showToast(`No matching transactions found to exclude for "${this.descriptionMatchKeyword().trim()}".`, 'info');
      return;
    }

    this.previewResult.set({
      ...res,
      transactions: remaining,
      excluded: [...toExclude, ...res.excluded],
      excludedCount: (res.excludedCount || 0) + toExclude.length
    });
    this.service.showToast(`Excluded ${toExclude.length} matching transaction(s) (moved to Excluded tab)`, 'info');
  }

  public excludeTransaction(tx: Transaction): void {
    const res = this.previewResult();
    if (!res) return;

    const remaining = res.transactions.filter((t) => t.id !== tx.id);
    const cleaned: Transaction = { ...tx };
    delete cleaned.includedFrom;

    this.previewResult.set({
      ...res,
      transactions: remaining,
      excluded: [cleaned, ...res.excluded],
      excludedCount: (res.excludedCount || 0) + 1
    });
    this.service.showToast(`Moved "${tx.description}" to Excluded tab`, 'info');
  }

  public includeMatchingTransactions(): void {
    const q = this.descriptionMatchKeyword().trim().toLowerCase();
    if (!q) {
      this.service.showToast('Please enter a keyword to match excluded transactions.', 'info');
      return;
    }
    const res = this.previewResult();
    if (!res || !res.excluded || res.excluded.length === 0) return;

    const toInclude: Transaction[] = [];
    const remainingExcluded: Transaction[] = [];

    for (const t of res.excluded) {
      if (
        (t.description || '').toLowerCase().includes(q) ||
        (t.merchant || '').toLowerCase().includes(q) ||
        (t.rawCategory || '').toLowerCase().includes(q)
      ) {
        const tagged: Transaction = { ...t, includedFrom: 'excluded' };
        toInclude.push(tagged);
      } else {
        remainingExcluded.push(t);
      }
    }

    if (toInclude.length === 0) {
      this.service.showToast(`No excluded transactions found matching "${this.descriptionMatchKeyword().trim()}".`, 'info');
      return;
    }

    this.previewResult.set({
      ...res,
      transactions: [...toInclude, ...res.transactions],
      excluded: remainingExcluded,
      excludedCount: Math.max(0, (res.excludedCount || 0) - toInclude.length)
    });
    this.service.showToast(`Included ${toInclude.length} matching transaction(s) back into import list`, 'success');
  }

  public getMatchingExcludedTransactionsCount(keyword: string): number {
    const q = (keyword || '').trim().toLowerCase();
    if (!q) return 0;
    const res = this.previewResult();
    if (!res || !res.excluded) return 0;

    let count = 0;
    for (const t of res.excluded) {
      if (
        (t.description || '').toLowerCase().includes(q) ||
        (t.merchant || '').toLowerCase().includes(q) ||
        (t.rawCategory || '').toLowerCase().includes(q)
      ) {
        count++;
      }
    }
    return count;
  }

  public isMatchingGroupDone(): boolean {
    const q = this.descriptionMatchKeyword().trim().toLowerCase();
    if (!q) return false;
    const res = this.previewResult();
    if (!res || !res.transactions) return false;

    const matching = res.transactions.filter(
      (t) =>
        !this.isTxOwnerExcluded(t) &&
        ((t.description || '').toLowerCase().includes(q) ||
          (t.merchant || '').toLowerCase().includes(q) ||
          (t.rawCategory || '').toLowerCase().includes(q))
    );

    return matching.length > 0 && matching.every((t) => t.isDone);
  }

  public toggleMatchingGroupDone(): void {
    const q = this.descriptionMatchKeyword().trim().toLowerCase();
    if (!q) {
      this.service.showToast('Please type a keyword to match transactions.', 'info');
      return;
    }
    const res = this.previewResult();
    if (!res || !res.transactions) return;

    const matching = res.transactions.filter(
      (t) =>
        !this.isTxOwnerExcluded(t) &&
        ((t.description || '').toLowerCase().includes(q) ||
          (t.merchant || '').toLowerCase().includes(q) ||
          (t.rawCategory || '').toLowerCase().includes(q))
    );

    if (matching.length === 0) {
      this.service.showToast(`No matching transactions found for "${this.descriptionMatchKeyword().trim()}".`, 'info');
      return;
    }

    const targetState = !this.isMatchingGroupDone();
    matching.forEach((t) => {
      t.isDone = targetState;
    });

    this.previewResult.set({ ...res });
    this.service.showToast(
      targetState
        ? `✓ Marked all ${matching.length} matching items as done`
        : `↩ Unmarked done for all ${matching.length} matching items`,
      'info'
    );
  }

  public clearCategoryMatchKeyword(): void {
    this.categoryMatchKeyword.set('');
  }

  public onCategoryFilterKeywordChange(keyword: string): void {
    this.onDescriptionKeywordChange(keyword);
  }

  public clearCategoryFilterKeyword(): void {
    this.clearDescriptionMatchKeyword();
  }

  public onTypeKeywordChange(keyword: string): void {
    this.typeMatchKeyword.set(keyword);
  }

  public clearTypeMatchKeyword(): void {
    this.typeMatchKeyword.set('');
    this.typeBatchItem.set('');
    this.typeBatchGroup.set('');
  }

  public onUniversalKeywordChange(keyword: string): void {
    this.onDescriptionKeywordChange(keyword);
  }

  public clearUniversalKeyword(): void {
    this.clearDescriptionMatchKeyword();
  }

  public onDescriptionKeywordChange(keyword: string): void {
    this.descriptionMatchKeyword.set(keyword);
    this.categoryMatchKeyword.set(keyword);
    this.typeMatchKeyword.set(keyword);
  }

  public clearDescriptionMatchKeyword(): void {
    this.descriptionMatchKeyword.set('');
    this.categoryMatchKeyword.set('');
    this.typeMatchKeyword.set('');
    this.descriptionBatchItem.set('');
    this.descriptionBatchGroup.set('');
  }

  public loadMoreCategories(): void {
    this.categoryDisplayLimit.update((c) => c + 60);
  }

  public loadAllCategories(): void {
    this.categoryDisplayLimit.set(999999);
  }

  public loadMoreDescriptions(): void {
    this.descriptionDisplayLimit.update((c) => c + 60);
  }

  public loadAllDescriptions(): void {
    this.descriptionDisplayLimit.set(999999);
  }

  public togglePreviewTable(): void {
    this.showPreviewTable.update((v) => !v);
  }

  public autoMatchAllCategories(): void {
    const groups = this.service.categoryGroups();
    const allCandidates: { item: string; group: string; normItem: string; normGroup: string }[] = [];
    for (const g of groups) {
      const normGroup = this.normalizeCategoryText(g.name);
      for (const it of g.items) {
        allCandidates.push({
          item: it.name,
          group: g.name,
          normItem: this.normalizeCategoryText(it.name),
          normGroup,
        });
      }
    }

    const res = this.previewResult();
    if (!res || !res.transactions || res.transactions.length === 0) {
      this.service.showToast('No transactions to match.', 'info');
      return;
    }

    let txsUpdated = 0;
    for (const t of res.transactions) {
      // 1. Try matching rawCategory if present
      let match = t.rawCategory ? this.findBestCategoryMatch(t.rawCategory, allCandidates) : null;
      // 2. Fallback to description
      if (!match) {
        match = this.findBestCategoryMatch(t.description || t.merchant || '', allCandidates);
      }
      if (match) {
        t.categoryItem = match.item;
        t.categoryGroup = match.group;
        txsUpdated++;
      }
    }

    this.previewResult.set({ ...res });

    if (txsUpdated > 0) {
      this.service.showToast(
        `✨ Auto-matched ${txsUpdated} transactions to Splitboard categories!`,
        'success'
      );
    } else {
      this.service.showToast('No automatic category matches found.', 'info');
    }
  }

  public assignAllMappingsToPerson(personName: string): void {
    const res = this.previewResult();
    if (!res || !res.transactions || res.transactions.length === 0) return;
    for (const t of res.transactions) {
      t.splitType = t.paidBy === personName ? 'SELF' : 'OTHER';
    }
    this.previewResult.set({ ...res });
    this.service.showToast(`Assigned split to ${personName} for all ${res.transactions.length} transactions!`, 'success');
  }

  public resetAllCategoryMappingsToUncategorized(): void {
    const res = this.previewResult();
    if (!res || !res.transactions || res.transactions.length === 0) return;
    for (const t of res.transactions) {
      t.categoryItem = 'Uncategorized';
      t.categoryGroup = 'Uncategorized';
    }
    this.previewResult.set({ ...res });
    this.service.showToast('Reset all categories to Uncategorized.', 'info');
  }

  private normalizeCategoryText(s: string): string {
    if (!s) return '';
    return s
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private findBestCategoryMatch(
    text: string,
    candidates: { item: string; group: string; normItem: string; normGroup: string }[]
  ): { item: string; group: string } | null {
    const normText = this.normalizeCategoryText(text);
    if (!normText || normText === 'uncategorized') return null;

    let bestMatch: { item: string; group: string } | null = null;
    let highestScore = 0;

    const stopWords = new Set(['and', '&', 'the', 'for', 'of', 'in', 'an', 'ai', 'to', 'a', 'or', 'on', 'at', 'with', 'inc', 'llc', 'gmbh']);
    const rawWords = normText.split(' ').filter((w) => w.length >= 3 && !stopWords.has(w));

    for (const cand of candidates) {
      let score = 0;

      // 1. Exact match with item name
      if (normText === cand.normItem) {
        score = 1000;
      }
      // 2. Exact match with group name
      else if (normText === cand.normGroup) {
        score = 800;
      }
      // 3. Raw text contains full item name
      else if (normText.includes(cand.normItem) && cand.normItem.length >= 3) {
        score = 600 + cand.normItem.length * 10;
      }
      // 4. Item contains full raw text
      else if (cand.normItem.includes(normText) && normText.length >= 3) {
        score = 500 + normText.length * 10;
      }
      // 5. Raw text contains full group name
      else if (normText.includes(cand.normGroup) && cand.normGroup.length >= 3) {
        score = 400 + cand.normGroup.length * 5;
      }
      // 6. Group contains full raw text
      else if (cand.normGroup.includes(normText) && normText.length >= 3) {
        score = 350 + normText.length * 5;
      }
      // 7. Word overlap matching
      else if (rawWords.length > 0) {
        const itemWords = cand.normItem.split(' ').filter((w) => w.length >= 3 && !stopWords.has(w));
        const groupWords = cand.normGroup.split(' ').filter((w) => w.length >= 3 && !stopWords.has(w));

        let matchedWords = 0;
        for (const rw of rawWords) {
          const itemHit = itemWords.some(
            (iw) => iw === rw || iw.startsWith(rw) || rw.startsWith(iw) || this.isFuzzyWordMatch(rw, iw)
          );
          const groupHit = groupWords.some(
            (gw) => gw === rw || gw.startsWith(rw) || rw.startsWith(gw) || this.isFuzzyWordMatch(rw, gw)
          );
          if (itemHit) matchedWords += 2;
          else if (groupHit) matchedWords += 1;
        }

        if (matchedWords > 0) {
          score = 200 + matchedWords * 50;
        }
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = { item: cand.item, group: cand.group };
      }
    }

    return highestScore >= 200 ? bestMatch : null;
  }

  private isFuzzyWordMatch(w1: string, w2: string): boolean {
    if (w1.length < 4 || w2.length < 4) return false;
    const prefixLen = Math.min(4, Math.min(w1.length, w2.length));
    return w1.slice(0, prefixLen) === w2.slice(0, prefixLen);
  }


  public toggleDescriptionGroup(desc: string): void {
    this.expandedDescriptionGroups.update((set) => {
      const next = new Set(set);
      if (next.has(desc)) next.delete(desc);
      else next.add(desc);
      return next;
    });
  }

  public isDescriptionGroupExpanded(desc: string): boolean {
    return this.expandedDescriptionGroups().has(desc);
  }

  public isIncomeTx(tx: Transaction | undefined | null): boolean {
    if (!tx) return false;
    if (this.previewTab() === 'incomes') return true;
    if (tx.type === 'INCOME' || tx.includedFrom === 'incomes') return true;
    const catGroup = (tx.categoryGroup || '').toLowerCase();
    const catItem = (tx.categoryItem || '').toLowerCase();
    const rawCat = (tx.rawCategory || '').toLowerCase();
    return catGroup.includes('income') || catItem.includes('income') || rawCat.includes('income');
  }

  public isIncomeGroup(grp: DescriptionGroup | TransactionGroup | undefined | null): boolean {
    if (!grp) return false;
    if (this.previewTab() === 'incomes') return true;
    return !!grp.items && grp.items.length > 0 && grp.items.every((t) => this.isIncomeTx(t));
  }

  public currentActiveTabTransactions = computed<Transaction[]>(() => {
    const tab = this.previewTab();
    const res = this.previewResult();
    if (!res) return [];
    if (tab === 'valid') return this.sortedTransactions();
    if (tab === 'review') return this.reviewTransactions();
    if (tab === 'incomes') return this.sortedIncomes();
    if (tab === 'duplicates') return this.sortedDuplicates();
    if (tab === 'excluded') return this.sortedExcluded();
    if (tab === 'deleted') return this.sortedDeleted();
    return [];
  });

  public descriptionGroups = computed<DescriptionGroup[]>(() => {
    const txs = this.currentActiveTabTransactions();
    const map = new Map<string, Transaction[]>();

    for (const tx of txs) {
      const key = (tx.description || 'Unspecified').trim();
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(tx);
    }

    const groups: DescriptionGroup[] = [];
    for (const [description, items] of map.entries()) {
      if (items.length < 2) continue; // Only group when at least 2 items exist!

      const totalAmount = items.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
      const firstCat = (items[0]?.categoryItem || '').trim();
      const firstGroup = (items[0]?.categoryGroup || '').trim();

      const allSameCat = items.every(
        (t) => (t.categoryItem || '').trim().toLowerCase() === firstCat.toLowerCase()
      );
      const allSameGroup = items.every(
        (t) => (t.categoryGroup || '').trim().toLowerCase() === firstGroup.toLowerCase()
      );
      const allSameCategory = allSameCat && allSameGroup && !!firstCat;

      let isMixedCategory = false;
      let mixedCategorySummary = '';
      if (!allSameCategory && items.some((t) => !!t.categoryItem)) {
        isMixedCategory = true;
        const counts = new Map<string, number>();
        items.forEach((t) => {
          const label = t.categoryItem
            ? (t.categoryGroup ? `${t.categoryItem} (${t.categoryGroup})` : t.categoryItem)
            : 'Uncategorized';
          counts.set(label, (counts.get(label) || 0) + 1);
        });
        mixedCategorySummary =
          'Mixed categories in group: ' +
          Array.from(counts.entries())
            .map(([k, v]) => `${v}x ${k}`)
            .join(', ');
      }

      const firstSplit = items[0]?.splitType;
      const allSameSplit = items.every((t) => t.splitType === firstSplit);

      const firstOwner = items[0]?.paidBy;
      const allSameOwner = items.every((t) => t.paidBy === firstOwner);

      const firstNote = items[0]?.note;
      const allSameNote = items.every((t) => (t.note || '') === (firstNote || ''));

      groups.push({
        description,
        count: items.length,
        totalAmount,
        categoryItem: allSameCategory ? items[0].categoryItem : undefined,
        categoryGroup: allSameCategory ? items[0].categoryGroup : undefined,
        isMixedCategory,
        mixedCategorySummary,
        splitType: allSameSplit ? firstSplit : undefined,
        owner: allSameOwner ? firstOwner : undefined,
        note: allSameNote ? (firstNote || '') : undefined,
        items
      });
    }

    return groups;
  });

  public onGroupNoteChange(group: DescriptionGroup, newNote: string): void {
    group.note = newNote;
    group.items.forEach((tx) => {
      tx.note = newNote;
    });
  }

  public trackGroup(_index: number, grp: DescriptionGroup): string {
    return grp.description;
  }

  public trackTx(_index: number, tx: Transaction): string {
    return tx.id;
  }

  public singleTransactions = computed<Transaction[]>(() => {
    const multiDescriptions = new Set(this.descriptionGroups().map((g) => g.description));
    return this.currentActiveTabTransactions().filter((t) => !multiDescriptions.has((t.description || 'Unspecified').trim()));
  });

  public onGroupCategoryChange(group: DescriptionGroup, newCategory: string, newGroup?: string): void {
    if (newCategory === '__ADD_NEW__') {
      this.openAddCategoryModal(group.items[0], 'group', group);
      return;
    }
    group.categoryItem = newCategory;
    group.categoryGroup = newGroup;
    group.isMixedCategory = false;
    group.mixedCategorySummary = '';
    group.items.forEach((tx) => {
      tx.categoryItem = newCategory;
      if (newGroup) {
        tx.categoryGroup = newGroup;
      }
      if (newCategory.toLowerCase().includes('reimburse')) {
        tx.isReimbursable = true;
        tx.reimbursementStatus = 'PENDING';
        tx.splitType = 'SELF';
      }
    });
    const res = this.previewResult();
    if (res) {
      this.previewResult.set({ ...res });
    }
    this.service.showToast(`Updated category for all ${group.count} "${group.description}" items`, 'success');
  }

  public getGroupSplitValue(group: DescriptionGroup): 'SPLIT_5050' | '100_P1' | '100_P2' | 'MIXED' | 'NONE' {
    if (!group.items || group.items.length === 0) return 'NONE';
    const firstVal = this.getInlineSplitValue(group.items[0]);
    if (!firstVal) {
      const anySet = group.items.some((tx) => !!this.getInlineSplitValue(tx));
      return anySet ? 'MIXED' : 'NONE';
    }
    const allSame = group.items.every((tx) => this.getInlineSplitValue(tx) === firstVal);
    return allSame ? firstVal : 'MIXED';
  }

  public hasUnselectedSplits(group: DescriptionGroup): boolean {
    return group.items.some((t) => !t.splitType);
  }

  public onGroupSplitChange(group: DescriptionGroup, choice: 'SPLIT_5050' | '100_P1' | '100_P2'): void {
    const p1 = this.service.personOne().name;
    group.items.forEach((tx) => {
      if (choice === 'SPLIT_5050') {
        tx.splitType = 'SPLIT';
      } else if (choice === '100_P1') {
        tx.splitType = tx.paidBy === p1 ? 'SELF' : 'OTHER';
      } else {
        tx.splitType = tx.paidBy === p1 ? 'OTHER' : 'SELF';
      }
    });
    group.splitType = choice === 'SPLIT_5050' ? 'SPLIT' : (choice === '100_P1' ? (group.items[0]?.paidBy === p1 ? 'SELF' : 'OTHER') : (group.items[0]?.paidBy === p1 ? 'OTHER' : 'SELF'));
    const res = this.previewResult();
    if (res) {
      this.previewResult.set({
        ...res,
        transactions: [...res.transactions]
      });
    }
    this.service.showToast(`Updated split for all ${group.count} "${group.description}" items`, 'success');
  }

  public toggleGroupOwner(group: DescriptionGroup): void {
    const p1 = this.service.personOne().name;
    const p2 = this.service.personTwo().name;
    const currentOwner = group.items[0]?.paidBy || p1;
    const newOwner = currentOwner === p1 ? p2 : p1;
    group.items.forEach((tx) => {
      tx.paidBy = newOwner;
    });
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
    this.service.showToast(`Owner set to ${newOwner} for all ${group.count} items`, 'info');
  }

  public isGroupUnderReview(group: DescriptionGroup): boolean {
    if (!group.items || group.items.length === 0) return false;
    return group.items.every((tx) => tx.isUnderReview);
  }

  public toggleGroupReview(group: DescriptionGroup): void {
    const allReviewed = this.isGroupUnderReview(group);
    const targetState = !allReviewed;
    group.items.forEach((tx) => {
      tx.isUnderReview = targetState;
    });
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
    this.service.showToast(
      targetState
        ? `🔍 Flagged all ${group.count} "${group.description}" items for review`
        : `✓ Resolved review for all ${group.count} "${group.description}" items`,
      'info'
    );
  }

  public isGroupDone(group: DescriptionGroup): boolean {
    if (!group.items || group.items.length === 0) return false;
    return group.items.every((tx) => tx.isDone);
  }

  public toggleGroupDone(group: DescriptionGroup): void {
    const allDone = this.isGroupDone(group);
    const targetState = !allDone;
    group.items.forEach((tx) => {
      tx.isDone = targetState;
    });
    const res = this.previewResult();
    if (res) this.previewResult.set({ ...res });
    this.service.showToast(
      targetState
        ? `✓ Marked all ${group.count} "${group.description}" items as done`
        : `↩ Unmarked done for all ${group.count} "${group.description}" items`,
      'info'
    );
  }

  public includeGroup(group: DescriptionGroup): void {
    const tab = this.previewTab();
    const res = this.previewResult();
    if (!res) return;
    const ids = new Set(group.items.map((t) => t.id));

    if (tab === 'incomes') {
      const tagged = group.items.map((t) => ({ ...t, includedFrom: 'incomes' as const }));
      this.previewResult.set({
        ...res,
        incomes: res.incomes.filter((t) => !ids.has(t.id)),
        transactions: [...tagged, ...res.transactions],
        incomesCount: Math.max(0, res.incomesCount - group.count)
      });
      this.service.showToast(`Included all ${group.count} "${group.description}" items into import list`, 'success');
    } else if (tab === 'duplicates') {
      const tagged = group.items.map((t) => ({ ...t, includedFrom: 'duplicates' as const }));
      this.previewResult.set({
        ...res,
        duplicates: res.duplicates.filter((t) => !ids.has(t.id)),
        transactions: [...tagged, ...res.transactions],
        duplicatesCount: Math.max(0, res.duplicatesCount - group.count)
      });
      this.service.showToast(`Included all ${group.count} "${group.description}" items into import list`, 'success');
    } else if (tab === 'excluded') {
      const tagged = group.items.map((t) => ({ ...t, includedFrom: 'excluded' as const }));
      this.previewResult.set({
        ...res,
        excluded: res.excluded.filter((t) => !ids.has(t.id)),
        transactions: [...tagged, ...res.transactions],
        excludedCount: Math.max(0, res.excludedCount - group.count)
      });
      this.service.showToast(`Included all ${group.count} "${group.description}" items into import list`, 'success');
    } else if (tab === 'deleted') {
      group.items.forEach((t) => this.service.restoreDeletedSignature(this.service.getTransactionSignature(t), t));
      const tagged = group.items.map((t) => ({ ...t, includedFrom: 'deleted' as const }));
      this.previewResult.set({
        ...res,
        deleted: (res.deleted || []).filter((t) => !ids.has(t.id)),
        transactions: [...tagged, ...res.transactions],
        deletedCount: Math.max(0, (res.deletedCount || res.deleted?.length || 0) - group.count)
      });
      this.service.showToast(`Restored all ${group.count} "${group.description}" items into import list`, 'success');
    }
  }

  public removeGroupTransactions(group: DescriptionGroup): void {
    const tab = this.previewTab();
    const ids = new Set(group.items.map((t) => t.id));
    const res = this.previewResult();
    if (!res) return;

    if (tab === 'valid' || tab === 'review') {
      const removedItems = res.transactions.filter((t) => ids.has(t.id));
      const toReturnToDuplicates: Transaction[] = [];
      const toReturnToIncomes: Transaction[] = [];
      const toReturnToExcluded: Transaction[] = [];
      const toDelete: Transaction[] = [];

      for (const t of removedItems) {
        if (t.includedFrom === 'duplicates') {
          const clean = { ...t };
          delete clean.includedFrom;
          toReturnToDuplicates.push(clean);
        } else if (t.includedFrom === 'incomes') {
          const clean = { ...t };
          delete clean.includedFrom;
          toReturnToIncomes.push(clean);
        } else if (t.includedFrom === 'excluded') {
          const clean = { ...t };
          delete clean.includedFrom;
          toReturnToExcluded.push(clean);
        } else {
          const isDbDuplicate = this.service.transactions().some(
            (dbt) => this.service.getTransactionSignature(dbt) === this.service.getTransactionSignature(t)
          );
          if (isDbDuplicate) {
            const clean = { ...t };
            delete clean.includedFrom;
            toReturnToDuplicates.push(clean);
          } else {
            toDelete.push(t);
          }
        }
      }

      if (toDelete.length > 0) {
        this.service.recordDeletedTransactions(toDelete);
      }

      this.previewResult.set({
        ...res,
        transactions: res.transactions.filter((t) => !ids.has(t.id)),
        duplicates: [...toReturnToDuplicates, ...res.duplicates],
        duplicatesCount: (res.duplicatesCount || 0) + toReturnToDuplicates.length,
        incomes: [...toReturnToIncomes, ...res.incomes],
        incomesCount: (res.incomesCount || 0) + toReturnToIncomes.length,
        excluded: [...toReturnToExcluded, ...res.excluded],
        excludedCount: (res.excludedCount || 0) + toReturnToExcluded.length,
        deleted: [...toDelete, ...(res.deleted || [])],
        deletedCount: (res.deletedCount || 0) + toDelete.length
      });

      if (toDelete.length > 0) {
        this.service.showToast(`Remembered ${toDelete.length} new items as deleted for future imports`, 'info');
      } else {
        this.service.showToast(`Returned ${removedItems.length} items to their original sections`, 'info');
      }
      return;
    } else if (tab === 'incomes') {
      this.previewResult.set({
        ...res,
        incomes: res.incomes.filter((t) => !ids.has(t.id)),
        incomesCount: Math.max(0, res.incomesCount - group.count)
      });
    } else if (tab === 'duplicates') {
      this.previewResult.set({
        ...res,
        duplicates: res.duplicates.filter((t) => !ids.has(t.id)),
        duplicatesCount: Math.max(0, res.duplicatesCount - group.count)
      });
    } else if (tab === 'excluded') {
      this.previewResult.set({
        ...res,
        excluded: res.excluded.filter((t) => !ids.has(t.id)),
        excludedCount: Math.max(0, res.excludedCount - group.count)
      });
    } else if (tab === 'deleted') {
      this.previewResult.set({
        ...res,
        deleted: (res.deleted || []).filter((t) => !ids.has(t.id)),
        deletedCount: Math.max(0, (res.deletedCount || res.deleted?.length || 0) - group.count)
      });
    }
    this.service.showToast(`Skipped ${group.count} items`, 'info');
  }

  // Smart Grouping for Excluded, Duplicate & Deleted Transactions
  public expandedGroups = signal<Set<string>>(new Set());

  public toggleGroup(groupId: string): void {
    this.expandedGroups.update((set) => {
      const next = new Set(set);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  public isGroupExpanded(groupId: string): boolean {
    return this.expandedGroups().has(groupId);
  }

  private groupTransactions(txs: Transaction[], isExcluded: boolean): TransactionGroup[] {
    const rules = this.service.excludeRules();
    const map = new Map<string, TransactionGroup>();

    for (const tx of txs) {
      let groupKey = '';
      const desc = tx.description || 'Other';

      if (isExcluded) {
        const matchedRule = rules.find((r) => desc.toLowerCase().includes(r.keyword.toLowerCase().trim()));
        if (matchedRule) {
          groupKey = matchedRule.keyword;
        }
      }

      if (!groupKey) {
        let cleaned = desc
          .replace(/for\s+[A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?/gi, '')
          .replace(/\b\d{4}[./-]\d{2}[./-]\d{2}\b/g, '')
          .replace(/\b\d{2}[./-]\d{2}[./-]\d{4}\b/g, '')
          .replace(/\*\d{4}/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        const words = cleaned.split(' ');
        groupKey = words.slice(0, Math.min(5, words.length)).join(' ');
        if (!groupKey) groupKey = desc.slice(0, 30);
      }

      const id = 'grp-' + groupKey.toLowerCase().replace(/[^a-z0-9]/g, '-');
      if (!map.has(groupKey)) {
        map.set(groupKey, {
          id,
          title: groupKey,
          count: 0,
          totalAmount: 0,
          items: []
        });
      }

      const g = map.get(groupKey)!;
      g.count++;
      g.totalAmount += Number(tx.amount) || 0;
      g.items.push(tx);
    }

    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }

  public groupedExcluded = computed(() => {
    const excluded = this.sortedExcluded();
    if (!excluded || excluded.length === 0) return [];
    return this.groupTransactions(excluded, true);
  });

  public groupedDuplicates = computed(() => {
    const duplicates = this.sortedDuplicates();
    if (!duplicates || duplicates.length === 0) return [];
    return this.groupTransactions(duplicates, false);
  });

  public groupedDeleted = computed(() => {
    const deleted = this.sortedDeleted();
    if (!deleted || deleted.length === 0) return [];
    return this.groupTransactions(deleted, false);
  });

  public includeExcludedGroup(group: TransactionGroup): void {
    const res = this.previewResult();
    if (!res) return;
    const groupItemIds = new Set(group.items.map((t) => t.id));
    const tagged = group.items.map((t) => ({ ...t, includedFrom: 'excluded' as const }));
    this.previewResult.set({
      ...res,
      excluded: res.excluded.filter((t) => !groupItemIds.has(t.id)),
      transactions: [...tagged, ...res.transactions],
      excludedCount: Math.max(0, res.excludedCount - group.count)
    });
    this.service.showToast(`Included all ${group.count} transactions from "${group.title}"`, 'success');
  }

  public includeDuplicateGroup(group: TransactionGroup): void {
    const res = this.previewResult();
    if (!res) return;
    const groupItemIds = new Set(group.items.map((t) => t.id));
    const tagged = group.items.map((t) => ({ ...t, includedFrom: 'duplicates' as const }));
    this.previewResult.set({
      ...res,
      duplicates: res.duplicates.filter((t) => !groupItemIds.has(t.id)),
      transactions: [...tagged, ...res.transactions],
      duplicatesCount: Math.max(0, res.duplicatesCount - group.count)
    });
    this.service.showToast(`Included all ${group.count} transactions from "${group.title}"`, 'success');
  }

  public includeDeletedGroup(group: TransactionGroup): void {
    const res = this.previewResult();
    if (!res) return;
    const groupItemIds = new Set(group.items.map((t) => t.id));
    group.items.forEach((t) => this.service.restoreDeletedSignature(this.service.getTransactionSignature(t), t));
    const tagged = group.items.map((t) => ({ ...t, includedFrom: 'deleted' as const }));
    this.previewResult.set({
      ...res,
      deleted: (res.deleted || []).filter((t) => !groupItemIds.has(t.id)),
      transactions: [...tagged, ...res.transactions],
      deletedCount: Math.max(0, (res.deletedCount || 0) - group.count)
    });
    this.service.showToast(`Restored all ${group.count} transactions from "${group.title}"`, 'success');
  }

  public includeAllExcluded(): void {
    const res = this.previewResult();
    if (!res || res.excluded.length === 0) return;
    const count = res.excluded.length;
    const tagged = res.excluded.map((t) => ({ ...t, includedFrom: 'excluded' as const }));
    this.previewResult.set({
      ...res,
      transactions: [...res.transactions, ...tagged],
      excluded: [],
      excludedCount: 0
    });
    this.service.showToast(`Included all ${count} excluded rows into import list`, 'success');
  }

  public removeValidTransaction(txId: string): void {
    const res = this.previewResult();
    if (!res) return;
    const targetTx = res.transactions.find((t) => t.id === txId);
    if (!targetTx) {
      this.previewResult.set({
        ...res,
        transactions: res.transactions.filter((t) => t.id !== txId)
      });
      return;
    }

    if (targetTx.includedFrom) {
      this.excludeIncludedTransaction(targetTx);
      return;
    }

    const isDbDuplicate = this.service.transactions().some(
      (dbt) => this.service.getTransactionSignature(dbt) === this.service.getTransactionSignature(targetTx)
    );
    if (isDbDuplicate) {
      const clean = { ...targetTx };
      delete clean.includedFrom;
      this.previewResult.set({
        ...res,
        transactions: res.transactions.filter((t) => t.id !== txId),
        duplicates: [clean, ...res.duplicates],
        duplicatesCount: (res.duplicatesCount || 0) + 1
      });
      this.service.showToast('Returned duplicate transaction to Duplicates', 'info');
      return;
    }

    this.service.recordDeletedTransaction(targetTx);
    this.previewResult.set({
      ...res,
      transactions: res.transactions.filter((t) => t.id !== txId),
      deleted: [targetTx, ...(res.deleted || [])],
      deletedCount: (res.deletedCount || 0) + 1
    });
    this.service.showToast(`Remembered as deleted for future imports`, 'info');
  }

  public async commitImport() {
    const res = this.previewResult();
    if (!res || res.transactions.length === 0) return;

    const unselected = this.unselectedSplitCount();
    if (unselected > 0) {
      this.service.showToast(
        `Please select a split for ${unselected} transaction${unselected > 1 ? 's' : ''} before importing.`,
        'error'
      );
      this.previewTab.set('valid');
      setTimeout(() => {
        const firstMissing = document.querySelector('.split-button-group.needs-split');
        if (firstMissing) {
          firstMissing.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
      return;
    }

    const toAdd = res.transactions.map(({ includedFrom, ...rest }) => rest);
    const toAddIncomes = (res.incomes || []).map(({ includedFrom, ...rest }) => rest);
    const allToAdd = [...toAdd, ...toAddIncomes];

    const editBatch = this.editingBatchFileName();
    const batchFileName = editBatch || this.uploadedFileName() || res.bankName || 'Imported Statement';

    // Persist full statement batch snapshot (transactions, incomes, duplicates, excluded, deleted)
    const snapshot: StatementBatchSnapshot = {
      fileName: batchFileName,
      importedAt: new Date().toISOString(),
      bankName: res.bankName || this.selectedBank() || 'Generic Bank',
      owner: this.selectedOwner() || '',
      transactions: [...toAdd],
      incomes: [...toAddIncomes],
      duplicates: [...(res.duplicates || [])],
      excluded: [...(res.excluded || [])],
      deleted: [...(res.deleted || [])],
    };
    this.service.saveStatementSnapshot(snapshot);

    if (editBatch) {
      this.service.transactions.update((curr) => [
        ...allToAdd,
        ...curr.filter((t) => t.sourceFile !== editBatch)
      ]);
      this.service.showToast(`Successfully updated statement "${editBatch}" (${allToAdd.length} transactions)!`, 'success');
      this.editingBatchFileName.set(null);
      this.service.batchToEdit.set(null);
    } else {
      this.service.addTransactions(allToAdd);
      this.service.showToast(`Successfully imported ${res.transactions.length} transactions!`, 'success');
    }

    if (res.duplicatesCount > 0 || res.excludedCount > 0) {
      let msg = `Imported ${res.transactions.length} new transactions.`;
      if (res.duplicatesCount > 0) msg += `\n• Skipped ${res.duplicatesCount} duplicates.`;
      if (res.excludedCount > 0) msg += `\n• Filtered ${res.excludedCount} excluded by bank rules.`;
      await this.service.showAlert('Import Completed', msg);
    }

    this.service.clearImportDraft();
    this.clearPreview();
    this.importCompleted.emit();
  }

  public async undoAndReopenBatch(fileName: string): Promise<void> {
    const batchTxns = this.service.transactions().filter((t) => t.sourceFile === fileName);
    const snapshot = this.service.getStatementSnapshot(fileName);

    if (batchTxns.length === 0 && !snapshot) {
      this.service.showToast(`No transactions found for statement "${fileName}".`, 'info');
      return;
    }

    this.editingBatchFileName.set(fileName);

    // Prefer active ledger transactions (which reflect any user edits/splits/categories)
    const sourceTxns = batchTxns.length > 0 ? batchTxns : (snapshot?.transactions || []);
    const cloned = sourceTxns.map((t) => ({ ...t }));
    const bankName = cloned[0]?.bank || snapshot?.bankName || 'Generic Bank';
    const payerName = cloned[0]?.paidBy || snapshot?.owner || '';

    // Separate expenses and incomes from active batch
    const expenses = cloned.filter((t) => t.type !== 'INCOME');
    const incomes = cloned.filter((t) => t.type === 'INCOME');

    // Combine with any extra incomes preserved in snapshot
    const snapshotIncomes = (snapshot?.incomes || []).filter(
      (si) => !incomes.some((i) => i.id === si.id || this.service.getTransactionSignature(i) === this.service.getTransactionSignature(si))
    );
    const allIncomes = [...incomes, ...snapshotIncomes];

    // Determine date range of this statement
    const dates = cloned.map((t) => t.date || '').filter(Boolean).sort();
    const minDate = dates[0] || '';
    const maxDate = dates[dates.length - 1] || '';

    // Find previously deleted transactions associated with this statement batch
    const deletedForBatch = [
      ...(snapshot?.deleted || []),
      ...this.service.deletedTransactions().filter(
        (t) => t.sourceFile === fileName || (bankName && t.bank === bankName && minDate && maxDate && t.date >= minDate && t.date <= maxDate)
      )
    ];
    const uniqueDeletedMap = new Map<string, Transaction>();
    for (const d of deletedForBatch) {
      const sig = d.id || this.service.getTransactionSignature(d);
      if (!uniqueDeletedMap.has(sig)) {
        uniqueDeletedMap.set(sig, d);
      }
    }
    const finalDeleted = Array.from(uniqueDeletedMap.values());

    const finalDuplicates = snapshot?.duplicates ? snapshot.duplicates.map((t) => ({ ...t })) : [];
    const finalExcluded = snapshot?.excluded ? snapshot.excluded.map((t) => ({ ...t })) : [];

    this.uploadedFileName.set(fileName);
    this.selectedBank.set(bankName);
    if (payerName) this.selectedOwner.set(payerName);
    this.isPdfLoaded.set(false);
    this.pdfDocInstance = null;
    this.pdfArrayBuffer = null;
    this.pdfPagesList.set([]);
    this.isGroupByDescription.set(true);
    this.previewResult.set({
      transactions: expenses,
      incomes: allIncomes,
      duplicates: finalDuplicates,
      excluded: finalExcluded,
      deleted: finalDeleted,
      incomesCount: allIncomes.length,
      duplicatesCount: finalDuplicates.length,
      excludedCount: finalExcluded.length,
      deletedCount: finalDeleted.length,
      bankName: bankName,
      totalParsed: cloned.length + allIncomes.length + finalDuplicates.length + finalExcluded.length + finalDeleted.length
    });

    this.previewTab.set('valid');
    this.sortColumn.set('original');

    this.scrollToPreviewOrImport();

    const parts: string[] = [];
    if (finalExcluded.length > 0) parts.push(`${finalExcluded.length} excluded`);
    if (finalDuplicates.length > 0) parts.push(`${finalDuplicates.length} duplicates`);
    if (finalDeleted.length > 0) parts.push(`${finalDeleted.length} previously deleted`);
    const extraMsg = parts.length > 0 ? ` (${parts.join(', ')})` : '';
    this.service.showToast(`Loaded statement "${fileName}" with all original state restored${extraMsg}.`, 'info');
  }

  public async onRehydrateFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    await this.rehydrateBatchFromFile(file);
    input.value = '';
  }

  public async rehydrateBatchFromFile(file: File): Promise<void> {
    const batchFileName = this.editingBatchFileName();
    if (!batchFileName) return;

    this.isParsing.set(true);
    try {
      const bankName = this.selectedBank() || 'Generic Bank';
      const owner = this.selectedOwner() || this.service.personOne().name;
      const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';

      if (isPdf) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          this.pdfArrayBuffer = arrayBuffer;
          await this.renderPdfDoc(arrayBuffer);
        } catch (err) {
          console.warn('PDF pre-render notice:', err);
        }
      }

      const parsed = await this.parser.parseFile(file, bankName, owner);
      parsed.bankName = bankName;

      // Build a lookup of existing user edits from active ledger and current preview
      const existingTxs = this.service.transactions().filter((t) => t.sourceFile === batchFileName);
      const currentPreviewTxs = this.previewResult()?.transactions || [];
      const userEditsMap = new Map<string, Transaction>();

      for (const t of [...existingTxs, ...currentPreviewTxs]) {
        const sig = this.service.getTransactionSignature(t);
        userEditsMap.set(sig, t);
        if (t.id) userEditsMap.set(t.id, t);
      }

      // Merge user edits into parsed transactions and duplicates
      const applyUserEdits = (t: Transaction): Transaction => {
        const sig = this.service.getTransactionSignature(t);
        const match = userEditsMap.get(sig) || (t.id ? userEditsMap.get(t.id) : undefined);
        if (match) {
          return {
            ...t,
            id: match.id || t.id,
            categoryGroup: match.categoryGroup || t.categoryGroup,
            categoryItem: match.categoryItem || t.categoryItem,
            splitType: match.splitType || t.splitType,
            splitMode: match.splitMode || t.splitMode,
            splitPercentage: match.splitPercentage !== undefined ? match.splitPercentage : t.splitPercentage,
            paidBy: match.paidBy || t.paidBy,
            customSplitAmounts: match.customSplitAmounts ? { ...match.customSplitAmounts } : t.customSplitAmounts,
            note: match.note !== undefined ? match.note : t.note,
            sourceFile: batchFileName,
            isDone: true
          };
        }
        return { ...t, sourceFile: batchFileName };
      };

      const mergedTransactions = parsed.transactions.map(applyUserEdits);

      // Check if any items in duplicates actually belong to this batch being edited
      const realDuplicates: Transaction[] = [];
      for (const d of parsed.duplicates) {
        const sig = this.service.getTransactionSignature(d);
        const match = userEditsMap.get(sig);
        if (match) {
          mergedTransactions.push(applyUserEdits(d));
        } else {
          realDuplicates.push(d);
        }
      }

      const mergedIncomes = parsed.incomes.map(applyUserEdits);

      const rehydratedResult: ParsedStatementResult = {
        transactions: mergedTransactions,
        incomes: mergedIncomes,
        duplicates: realDuplicates,
        excluded: parsed.excluded.map((t) => ({ ...t, sourceFile: batchFileName })),
        deleted: parsed.deleted.map((t) => ({ ...t, sourceFile: batchFileName })),
        incomesCount: mergedIncomes.length,
        duplicatesCount: realDuplicates.length,
        excludedCount: parsed.excluded.length,
        deletedCount: parsed.deleted.length,
        bankName: bankName,
        totalParsed: mergedTransactions.length + mergedIncomes.length + realDuplicates.length + parsed.excluded.length + parsed.deleted.length
      };

      this.previewResult.set(rehydratedResult);
      this.service.showToast(
        `Re-hydrated "${batchFileName}" with original file: ${parsed.excluded.length} excluded and ${realDuplicates.length} duplicates restored!`,
        'success'
      );
    } catch (err: any) {
      console.error('Failed to rehydrate statement from file:', err);
      this.service.showToast('Failed to parse statement file: ' + (err?.message || err), 'error');
    } finally {
      this.isParsing.set(false);
    }
  }

  public viewingBatch = signal<ImportedBatch | null>(null);

  public openBatchModal(b: ImportedBatch): void {
    this.viewingBatch.set(b);
  }

  public closeBatchModal(): void {
    this.viewingBatch.set(null);
  }

  public getBatchTransactions(fileName: string): Transaction[] {
    return this.service.transactions().filter((t) => t.sourceFile === fileName);
  }

  public async editBatchFromModal(fileName: string): Promise<void> {
    this.closeBatchModal();
    await this.undoAndReopenBatch(fileName);
  }

  public async deleteBatchFromModal(fileName: string): Promise<void> {
    this.closeBatchModal();
    await this.service.undoImportBatch(fileName);
  }

  public clearPreview() {
    this.previewResult.set(null);
    this.uploadedFileName.set('');
    this.selectedBank.set('');
    this.detectedBankSuggestion.set('');
    this.rawClipboardText = '';
    this.isPdfLoaded.set(false);
    this.pdfDocInstance = null;
    this.pdfArrayBuffer = null;
    this.pdfPagesList.set([]);
    this.isGroupByDescription.set(false);
    this.editingBatchFileName.set(null);
    this.service.batchToEdit.set(null);
    this.importCompleted.emit();
  }
}
