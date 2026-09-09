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
  @Input() group: string = '';
  @Input() placeholder: string = '📁 Uncategorized';
  @Input() customTitle?: string;
  @Input() compact: boolean = false;
  @Input() disabled: boolean = false;
  @Input() allowAddNew: boolean = true;
  @Input() minWidth: string = '140px';

  @Output() valueChange = new EventEmitter<string>();
  @Output() groupChange = new EventEmitter<string>();
  @Output() categoryChange = new EventEmitter<{ item: string; group: string }>();
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
    const allGroups = this.service.categoryGroups();

    // Check if this item name exists in multiple groups
    let matchCount = 0;
    for (const g of allGroups) {
      if (g.items.some((i) => i.name.toLowerCase() === val.toLowerCase())) {
        matchCount++;
      }
    }
    const isDuplicate = matchCount > 1;

    // 1. If group input is provided, search that group first!
    if (this.group) {
      const matchGrp = allGroups.find((g) => g.name.toLowerCase() === this.group.toLowerCase());
      if (matchGrp) {
        const icon = matchGrp.icon || '📁';
        return isDuplicate ? `${icon} ${val} (${matchGrp.name})` : `${icon} ${val}`;
      }
    }

    // 2. Otherwise find the first matching group
    for (const grp of allGroups) {
      const found = grp.items.find((i) => i.name.toLowerCase() === val.toLowerCase());
      if (found) {
        const icon = grp.icon || '📁';
        return isDuplicate ? `${icon} ${found.name} (${grp.name})` : `${icon} ${found.name}`;
      }
    }

    return `📁 ${val}`;
  }

  public get fullTooltip(): string {
    if (this.customTitle) {
      return this.customTitle;
    }
    if (!this.value || this.value === 'Uncategorized') {
      return 'Click to select category';
    }
    if (this.group) {
      return `${this.group} › ${this.value}`;
    }
    return this.displayLabel;
  }

  public isSelected(itemName: string, groupName: string): boolean {
    if (!this.value || this.value === 'Uncategorized') return false;
    if (this.value.toLowerCase() !== itemName.toLowerCase()) return false;
    if (this.group) {
      return this.group.toLowerCase() === groupName.toLowerCase();
    }
    const firstGroup = this.service.categoryGroups().find((g) =>
      g.items.some((i) => i.name.toLowerCase() === itemName.toLowerCase())
    );
    return firstGroup?.name === groupName;
  }

  public isHighlighted(itemName: string, groupName: string): boolean {
    const curr = this.flattenedSelectableItems()[this.highlightedIndex()];
    return (
      curr?.type === 'item' &&
      curr.name.toLowerCase() === itemName.toLowerCase() &&
      (curr.groupName || '').toLowerCase() === groupName.toLowerCase()
    );
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
    if (this.disabled) return;
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
    if (this.disabled) return;
    if (this.isOpen()) {
      this.closeDropdown();
    } else {
      this.openDropdown(event);
    }
  }

  public selectItem(name: string, groupName: string = ''): void {
    if (name === '__ADD_NEW__') {
      this.addNewRequested.emit();
      this.valueChange.emit('__ADD_NEW__');
    } else {
      this.group = groupName;
      this.value = name;
      this.groupChange.emit(groupName);
      this.categoryChange.emit({ item: name, group: groupName });
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
      const item = items[currIdx];
      if (item) {
        if (item.type === 'item') {
          this.selectItem(item.name, item.groupName || '');
        } else if (item.type === 'uncat') {
          this.selectItem('', '');
        } else if (item.type === 'add_new') {
          this.addNewRequested.emit();
          this.valueChange.emit('__ADD_NEW__');
          this.closeDropdown();
        }
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
