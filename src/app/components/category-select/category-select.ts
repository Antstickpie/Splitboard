import {
  Component,
  Input,
  Output,
  EventEmitter,
  inject,
  signal,
  computed,
  ElementRef,
  ViewChild,
  HostListener,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { CategoryGroup } from '../../models';

@Component({
  selector: 'app-category-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './category-select.html',
  styleUrls: ['./category-select.css']
})
export class CategorySelectComponent implements OnDestroy {
  public service = inject(TransactionService);
  private elementRef = inject(ElementRef);

  @Input() value: string = '';
  @Input() placeholder: string = '📁 Uncategorized';
  @Input() compact: boolean = false;
  @Input() allowAddNew: boolean = true;
  @Input() minWidth: string = '140px';

  @Output() valueChange = new EventEmitter<string>();
  @Output() addNewRequested = new EventEmitter<void>();

  @ViewChild('triggerBtn') triggerBtnRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('searchInput') searchInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('dropdownPopover') dropdownPopoverRef?: ElementRef<HTMLDivElement>;

  public isOpen = signal<boolean>(false);
  public searchQuery = signal<string>('');
  public highlightedIndex = signal<number>(0);

  public popoverTop = signal<number>(0);
  public popoverLeft = signal<number>(0);
  public popoverWidth = signal<number>(240);

  // Filtered Category Groups based on search query
  public filteredGroups = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const groups = this.service.categoryGroups();
    if (!q) return groups;

    return groups
      .map((grp) => {
        const matchesGrpName = grp.name.toLowerCase().includes(q);
        const matchingItems = grp.items.filter(
          (itm) => itm.name.toLowerCase().includes(q) || matchesGrpName
        );
        if (matchesGrpName || matchingItems.length > 0) {
          return {
            ...grp,
            items: matchesGrpName && matchingItems.length === 0 ? grp.items : matchingItems
          };
        }
        return null;
      })
      .filter((g): g is CategoryGroup => g !== null);
  });

  public flattenedSelectableItems = computed<{ type: 'uncat' | 'add_new' | 'item'; name: string; icon?: string; groupName?: string }[]>(() => {
    const list: { type: 'uncat' | 'add_new' | 'item'; name: string; icon?: string; groupName?: string }[] = [];
    const q = this.searchQuery().toLowerCase().trim();

    if (!q || 'uncategorized'.includes(q)) {
      list.push({ type: 'uncat', name: '' });
    }

    if (this.allowAddNew && (!q || 'add new category'.includes(q) || q.length > 0)) {
      list.push({ type: 'add_new', name: '__ADD_NEW__' });
    }

    for (const grp of this.filteredGroups()) {
      for (const itm of grp.items) {
        list.push({
          type: 'item',
          name: itm.name,
          icon: grp.icon || '📁',
          groupName: grp.name
        });
      }
    }

    return list;
  });

  public get displayLabel(): string {
    const val = this.value;
    if (!val || val === 'Uncategorized') {
      return this.placeholder;
    }
    for (const grp of this.service.categoryGroups()) {
      const found = grp.items.find((i) => i.name === val);
      if (found) {
        return `${grp.icon || '📁'} ${found.name}`;
      }
    }
    return `📁 ${val}`;
  }

  public updatePopoverPosition(): void {
    if (!this.triggerBtnRef?.nativeElement) return;
    const rect = this.triggerBtnRef.nativeElement.getBoundingClientRect();
    const dropdownHeight = 260;
    const spaceBelow = window.innerHeight - rect.bottom;
    const width = Math.max(250, rect.width);

    let top = rect.bottom + 4;
    if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
      top = rect.top - dropdownHeight - 4;
    }

    let left = rect.left;
    if (left + width > window.innerWidth - 10) {
      left = window.innerWidth - width - 10;
    }
    if (left < 10) left = 10;

    this.popoverTop.set(Math.round(top));
    this.popoverLeft.set(Math.round(left));
    this.popoverWidth.set(Math.round(width));
  }

  public openDropdown(event?: MouseEvent): void {
    if (event) event.stopPropagation();
    this.searchQuery.set('');
    this.highlightedIndex.set(0);
    this.updatePopoverPosition();
    this.isOpen.set(true);

    setTimeout(() => {
      if (this.dropdownPopoverRef?.nativeElement) {
        if (this.dropdownPopoverRef.nativeElement.parentNode !== document.body) {
          document.body.appendChild(this.dropdownPopoverRef.nativeElement);
        }
        this.updatePopoverPosition();
        this.searchInputRef?.nativeElement?.focus();
      }
    }, 0);
  }

  public closeDropdown(): void {
    if (this.dropdownPopoverRef?.nativeElement?.parentNode === document.body) {
      document.body.removeChild(this.dropdownPopoverRef.nativeElement);
    }
    this.isOpen.set(false);
    this.searchQuery.set('');
  }

  public toggleDropdown(event?: MouseEvent): void {
    if (this.isOpen()) {
      this.closeDropdown();
    } else {
      this.openDropdown(event);
    }
  }

  public selectItem(name: string): void {
    if (name === '__ADD_NEW__') {
      this.addNewRequested.emit();
      this.valueChange.emit('__ADD_NEW__');
    } else {
      this.valueChange.emit(name);
    }
    this.closeDropdown();
  }

  public onKeyDown(event: KeyboardEvent): void {
    const items = this.flattenedSelectableItems();
    if (!this.isOpen()) {
      if (event.key === 'Enter' || event.key === 'ArrowDown') {
        event.preventDefault();
        this.openDropdown();
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.highlightedIndex.update((curr) => (curr + 1) % Math.max(1, items.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.highlightedIndex.update((curr) => (curr - 1 + items.length) % Math.max(1, items.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const currIdx = this.highlightedIndex();
      if (items[currIdx]) {
        this.selectItem(items[currIdx].name);
      } else if (this.searchQuery().trim()) {
        this.addNewRequested.emit();
        this.valueChange.emit('__ADD_NEW__');
        this.closeDropdown();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeDropdown();
    }
  }

  @HostListener('document:click', ['$event'])
  public onDocumentClick(event: MouseEvent): void {
    const target = event.target as Node;
    const clickedInsideComponent = this.elementRef.nativeElement.contains(target);
    const clickedInsidePopover = this.dropdownPopoverRef?.nativeElement?.contains(target);
    if (!clickedInsideComponent && !clickedInsidePopover) {
      this.closeDropdown();
    }
  }

  @HostListener('window:resize')
  public onWindowResize(): void {
    if (this.isOpen()) {
      this.updatePopoverPosition();
    }
  }

  @HostListener('window:scroll')
  public onWindowScroll(): void {
    if (this.isOpen()) {
      this.updatePopoverPosition();
    }
  }

  public ngOnDestroy(): void {
    if (this.dropdownPopoverRef?.nativeElement?.parentNode === document.body) {
      document.body.removeChild(this.dropdownPopoverRef.nativeElement);
    }
  }
}
