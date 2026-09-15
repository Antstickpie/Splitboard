import {
  Component,
  Input,
  Output,
  EventEmitter,
  inject,
  signal,
  computed,
  OnChanges,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { Transaction, SplitType, SplitMode } from '../../models';
import { CategorySelectComponent } from '../category-select/category-select';

export interface CategorySplitLine {
  id: string;
  amount: number;
  categoryItem: string;
  categoryGroup: string;
  description: string;
  note: string;
  splitType: SplitType;
  splitMode: SplitMode;
  splitPercentage?: number;
  customSplitAmounts?: Record<string, number>;
}

@Component({
  selector: 'app-category-split-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, CategorySelectComponent],
  templateUrl: './category-split-modal.html',
  styleUrls: ['./category-split-modal.css']
})
export class CategorySplitModalComponent implements OnChanges {
  public service = inject(TransactionService);
  public Math = Math;

  @Input() targetTx: Transaction | null = null;
  @Input() contextTransactions: Transaction[] = [];

  @Output() save = new EventEmitter<Transaction[]>();
  @Output() merge = new EventEmitter<string>();
  @Output() close = new EventEmitter<void>();

  public splitLines = signal<CategorySplitLine[]>([]);
  public totalAmount = signal<number>(0);
  public originalTx = signal<Transaction | null>(null);
  public isAlreadySplit = signal<boolean>(false);
  public existingGroupId = signal<string | null>(null);

  public allocatedAmount = computed(() => {
    const lines = this.splitLines();
    const sum = lines.reduce((acc, l) => acc + (Number(l.amount) || 0), 0);
    return parseFloat(sum.toFixed(2));
  });

  public remainingAmount = computed(() => {
    const total = this.totalAmount();
    const alloc = this.allocatedAmount();
    return parseFloat((total - alloc).toFixed(2));
  });

  public isValid = computed(() => {
    const lines = this.splitLines();
    if (lines.length < 2) return false;
    const rem = Math.abs(this.remainingAmount());
    if (rem > 0.005) return false;
    for (const line of lines) {
      if (!line.amount || line.amount <= 0) return false;
    }
    return true;
  });

  public ngOnChanges(changes: SimpleChanges): void {
    if (changes['targetTx'] && this.targetTx) {
      this.initFromTarget(this.targetTx);
    }
  }

  private initFromTarget(tx: Transaction): void {
    this.originalTx.set(tx);

    const pool = this.contextTransactions && this.contextTransactions.length > 0
      ? this.contextTransactions
      : this.service.transactions();

    if (tx.splitGroupId) {
      this.isAlreadySplit.set(true);
      this.existingGroupId.set(tx.splitGroupId);
      const siblings = pool.filter((t) => t.splitGroupId === tx.splitGroupId);
      const sorted = siblings.length > 0
        ? [...siblings].sort((a, b) => (a.splitPartIndex || 0) - (b.splitPartIndex || 0))
        : [tx];

      const sum = sorted.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
      const origAmt = tx.splitOriginalAmount ?? parseFloat(sum.toFixed(2));
      this.totalAmount.set(origAmt);

      const lines: CategorySplitLine[] = sorted.map((s) => ({
        id: s.id,
        amount: Number(s.amount) || 0,
        categoryItem: s.categoryItem || '',
        categoryGroup: s.categoryGroup || '',
        description: s.description || tx.description || '',
        note: s.note || '',
        splitType: s.splitType || 'SPLIT',
        splitMode: s.splitMode || 'PERCENTAGE',
        splitPercentage: s.splitPercentage !== undefined ? s.splitPercentage : 50,
        customSplitAmounts: s.customSplitAmounts ? { ...s.customSplitAmounts } : undefined
      }));

      // If only 1 sibling was found for some reason, ensure at least 2 lines
      if (lines.length < 2) {
        const half = parseFloat((origAmt / 2).toFixed(2));
        lines[0].amount = half;
        lines.push({
          id: 'split-part-' + Date.now() + '-1',
          amount: parseFloat((origAmt - half).toFixed(2)),
          categoryItem: '',
          categoryGroup: '',
          description: tx.description || '',
          note: '',
          splitType: tx.splitType || 'SPLIT',
          splitMode: tx.splitMode || 'PERCENTAGE',
          splitPercentage: tx.splitPercentage !== undefined ? tx.splitPercentage : 50,
          customSplitAmounts: tx.customSplitAmounts ? { ...tx.customSplitAmounts } : undefined
        });
      }

      this.splitLines.set(lines);
    } else {
      this.isAlreadySplit.set(false);
      this.existingGroupId.set(null);
      const amt = Math.abs(Number(tx.amount) || 0);
      this.totalAmount.set(amt);

      const half = parseFloat((amt / 2).toFixed(2));
      const otherHalf = parseFloat((amt - half).toFixed(2));

      const lines: CategorySplitLine[] = [
        {
          id: tx.id,
          amount: half,
          categoryItem: tx.categoryItem || '',
          categoryGroup: tx.categoryGroup || '',
          description: tx.description || '',
          note: tx.note || '',
          splitType: tx.splitType || 'SPLIT',
          splitMode: tx.splitMode || 'PERCENTAGE',
          splitPercentage: tx.splitPercentage !== undefined ? tx.splitPercentage : 50,
          customSplitAmounts: tx.customSplitAmounts ? { ...tx.customSplitAmounts } : undefined
        },
        {
          id: 'split-part-' + Date.now() + '-1',
          amount: otherHalf,
          categoryItem: '',
          categoryGroup: '',
          description: tx.description || '',
          note: '',
          splitType: tx.splitType || 'SPLIT',
          splitMode: tx.splitMode || 'PERCENTAGE',
          splitPercentage: tx.splitPercentage !== undefined ? tx.splitPercentage : 50,
          customSplitAmounts: tx.customSplitAmounts ? { ...tx.customSplitAmounts } : undefined
        }
      ];

      this.splitLines.set(lines);
    }
  }

  public addLine(): void {
    const rem = Math.max(0, this.remainingAmount());
    const orig = this.originalTx();
    const current = this.splitLines();

    const newLine: CategorySplitLine = {
      id: 'split-part-' + Date.now() + '-' + current.length,
      amount: rem,
      categoryItem: '',
      categoryGroup: '',
      description: orig?.description || '',
      note: '',
      splitType: orig?.splitType || 'SPLIT',
      splitMode: orig?.splitMode || 'PERCENTAGE',
      splitPercentage: orig?.splitPercentage !== undefined ? orig.splitPercentage : 50,
      customSplitAmounts: orig?.customSplitAmounts ? { ...orig.customSplitAmounts } : undefined
    };

    this.splitLines.update((lines) => [...lines, newLine]);
  }

  public removeLine(index: number): void {
    if (this.splitLines().length <= 2) return;
    this.splitLines.update((lines) => lines.filter((_, i) => i !== index));
  }

  public splitEvenly(): void {
    const total = this.totalAmount();
    const lines = this.splitLines();
    const count = lines.length;
    if (count === 0) return;

    const share = parseFloat((total / count).toFixed(2));
    let accumulated = 0;

    const updated = lines.map((line, idx) => {
      if (idx === count - 1) {
        const lastShare = parseFloat((total - accumulated).toFixed(2));
        return { ...line, amount: lastShare };
      }
      accumulated = parseFloat((accumulated + share).toFixed(2));
      return { ...line, amount: share };
    });

    this.splitLines.set(updated);
  }

  public allocateRemainingTo(index: number): void {
    const rem = this.remainingAmount();
    if (Math.abs(rem) <= 0.005) return;

    this.splitLines.update((lines) =>
      lines.map((line, i) => {
        if (i === index) {
          const newAmt = Math.max(0, parseFloat(((Number(line.amount) || 0) + rem).toFixed(2)));
          return { ...line, amount: newAmt };
        }
        return line;
      })
    );
  }

  public onCategoryChanged(index: number, event: { item: string; group: string }): void {
    this.splitLines.update((lines) =>
      lines.map((line, i) => {
        if (i === index) {
          return {
            ...line,
            categoryItem: event.item,
            categoryGroup: event.group
          };
        }
        return line;
      })
    );
  }

  public trackLine(index: number, line: CategorySplitLine): string {
    return line.id || String(index);
  }

  public onAmountChange(): void {
    this.splitLines.update((lines) => [...lines]);
  }

  public onNoteChange(): void {
    this.splitLines.update((lines) => [...lines]);
  }

  public setLineSplitOption(index: number, opt: 'SPLIT_5050' | 'P1' | 'P2'): void {
    this.splitLines.update((lines) =>
      lines.map((line, i) => {
        if (i === index) {
          if (opt === 'SPLIT_5050') {
            return {
              ...line,
              splitType: 'SPLIT' as SplitType,
              splitMode: 'PERCENTAGE' as SplitMode,
              splitPercentage: 50,
              customSplitAmounts: undefined
            };
          } else if (opt === 'P1') {
            return {
              ...line,
              splitType: 'SELF' as SplitType,
              splitMode: 'PERCENTAGE' as SplitMode,
              splitPercentage: 100,
              customSplitAmounts: undefined
            };
          } else if (opt === 'P2') {
            return {
              ...line,
              splitType: 'OTHER' as SplitType,
              splitMode: 'PERCENTAGE' as SplitMode,
              splitPercentage: 0,
              customSplitAmounts: undefined
            };
          }
        }
        return line;
      })
    );
  }

  public onSave(): void {
    if (!this.isValid()) return;
    const orig = this.originalTx();
    if (!orig) return;

    const groupId = this.existingGroupId() || ('split-grp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
    const totalParts = this.splitLines().length;
    const totalAmt = this.totalAmount();

    const result: Transaction[] = this.splitLines().map((line, idx) => {
      return {
        ...orig,
        id: line.id || ('split-part-' + Date.now() + '-' + idx),
        amount: Number(line.amount),
        categoryItem: line.categoryItem || 'Uncategorized',
        categoryGroup: line.categoryGroup || '',
        description: (line.description && line.description.trim()) ? line.description.trim() : (orig.description || 'Split Transaction'),
        note: line.note ? line.note.trim() : undefined,
        splitType: line.splitType,
        splitMode: line.splitMode,
        splitPercentage: line.splitPercentage,
        customSplitAmounts: line.customSplitAmounts,
        splitGroupId: groupId,
        splitOriginalAmount: totalAmt,
        splitPartIndex: idx + 1,
        splitTotalParts: totalParts
      };
    });

    this.save.emit(result);
  }

  public onMerge(): void {
    const gid = this.existingGroupId();
    if (gid) {
      this.merge.emit(gid);
    }
  }

  public onCancel(): void {
    this.close.emit();
  }
}
