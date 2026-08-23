import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LedgerComponent } from './components/ledger/ledger';
import { BudgetDashboardComponent } from './components/budget-dashboard/budget-dashboard';
import { ImportComponent } from './components/import/import';
import { SettingsComponent } from './components/settings/settings';
import { TransactionService } from './services/transaction.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    LedgerComponent,
    BudgetDashboardComponent,
    ImportComponent,
    SettingsComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  public service = inject(TransactionService);
  public activeTab = signal<'dashboard' | 'ledger' | 'import' | 'settings'>('dashboard');

  public switchTab(tab: 'dashboard' | 'ledger' | 'import' | 'settings') {
    this.activeTab.set(tab);
  }

  public formatSyncTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(timestamp).toLocaleDateString();
  }
}
