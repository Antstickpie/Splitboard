import { Injectable, signal } from '@angular/core';
import { AppDataBackup, Transaction } from '../models';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private readonly DB_NAME = 'splitboard_db';
  private readonly DB_VERSION = 1;
  private readonly TX_STORE = 'transactions';
  private readonly META_STORE = 'metadata';

  public isDbReady = signal<boolean>(false);
  public dbTxCount = signal<number>(0);
  public isMigratedFromLocalStorage = signal<boolean>(false);

  private db: IDBDatabase | null = null;
  private saveDebounceTimer: any = null;

  constructor() {
    this.init().catch((err) => {
      console.error('[StorageService] IndexedDB init failed:', err);
    });
  }

  /**
   * Initializes the native IndexedDB splitboard_db database.
   */
  public async init(): Promise<boolean> {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      console.warn('[StorageService] IndexedDB not available in current environment');
      return false;
    }

    if (this.db) {
      this.isDbReady.set(true);
      return true;
    }

    return new Promise<boolean>((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 1. Transactions store with rich indexes for fast range slicing & analytics
        if (!db.objectStoreNames.contains(this.TX_STORE)) {
          const txStore = db.createObjectStore(this.TX_STORE, { keyPath: 'id' });
          txStore.createIndex('date', 'date', { unique: false });
          txStore.createIndex('categoryGroup', 'categoryGroup', { unique: false });
          txStore.createIndex('categoryItem', 'categoryItem', { unique: false });
          txStore.createIndex('paidBy', 'paidBy', { unique: false });
          txStore.createIndex('source', 'source', { unique: false });
          txStore.createIndex('importedAt', 'importedAt', { unique: false });
        }

        // 2. Metadata store for app settings, persons, categories, budgets, and rules
        if (!db.objectStoreNames.contains(this.META_STORE)) {
          db.createObjectStore(this.META_STORE, { keyPath: 'key' });
        }
      };

      request.onsuccess = async (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        this.isDbReady.set(true);
        await this.refreshStats();
        resolve(true);
      };

      request.onerror = (event) => {
        const err = (event.target as IDBOpenDBRequest).error;
        console.error('[StorageService] Failed to open IndexedDB:', err);
        reject(err);
      };
    });
  }

  /**
   * Refreshes the live transaction count from IndexedDB.
   */
  public async refreshStats(): Promise<number> {
    if (!this.db) return 0;
    try {
      const count = await this.getTransactionCount();
      this.dbTxCount.set(count);
      return count;
    } catch {
      return 0;
    }
  }

  /**
   * Returns the count of transactions stored in IndexedDB.
   */
  public getTransactionCount(): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve(0);
      try {
        const tx = this.db.transaction(this.TX_STORE, 'readonly');
        const store = tx.objectStore(this.TX_STORE);
        const req = store.count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Loads the complete application state from IndexedDB.
   * Returns null if database is empty or uninitialized.
   */
  public async loadAll(): Promise<AppDataBackup | null> {
    if (!this.db) {
      await this.init();
    }
    const db = this.db;
    if (!db) return null;

    return new Promise<AppDataBackup | null>((resolve, reject) => {
      try {
        const tx = db.transaction([this.TX_STORE, this.META_STORE], 'readonly');
        const txStore = tx.objectStore(this.TX_STORE);
        const metaStore = tx.objectStore(this.META_STORE);

        const allTxsReq = txStore.getAll();
        const allMetaReq = metaStore.getAll();

        tx.oncomplete = () => {
          const transactions: Transaction[] = allTxsReq.result || [];
          const metaEntries: { key: string; value: any }[] = allMetaReq.result || [];

          if (transactions.length === 0 && metaEntries.length === 0) {
            resolve(null);
            return;
          }

          const metaMap = new Map<string, any>();
          for (const entry of metaEntries) {
            metaMap.set(entry.key, entry.value);
          }

          const backup: AppDataBackup = {
            version: metaMap.get('version') || 1,
            exportedAt: metaMap.get('exportedAt') || new Date().toISOString(),
            persons: metaMap.get('persons') || [],
            categoryGroups: metaMap.get('categoryGroups') || [],
            transactions: transactions,
            monthlyBudgets: metaMap.get('monthlyBudgets') || [],
            bankConfigs: metaMap.get('bankConfigs') || [],
            rules: metaMap.get('rules') || [],
            excludeRules: metaMap.get('excludeRules') || [],
            deletedSignatures: metaMap.get('deletedSignatures') || [],
            settings: metaMap.get('settings') || {}
          };

          this.dbTxCount.set(transactions.length);
          resolve(backup);
        };

        tx.onerror = () => {
          reject(tx.error);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Saves the entire state into IndexedDB with a 300ms debounce.
   * Atomically writes transactions into `transactions` and metadata into `metadata`.
   */
  public saveAllDebounced(data: AppDataBackup, delayMs = 300): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.saveDebounceTimer) {
        clearTimeout(this.saveDebounceTimer);
      }

      this.saveDebounceTimer = setTimeout(async () => {
        try {
          await this.saveAllImmediate(data);
          resolve();
        } catch (err) {
          reject(err);
        }
      }, delayMs);
    });
  }

  /**
   * Immediately writes full state to IndexedDB using a single atomic transaction.
   */
  public async saveAllImmediate(data: AppDataBackup): Promise<void> {
    if (!this.db) {
      await this.init();
    }
    const db = this.db;
    if (!db) {
      console.warn('[StorageService] IndexedDB not ready for immediate save');
      return;
    }

    return new Promise<void>((resolve, reject) => {
      try {
        const idbTx = db.transaction([this.TX_STORE, this.META_STORE], 'readwrite');
        const txStore = idbTx.objectStore(this.TX_STORE);
        const metaStore = idbTx.objectStore(this.META_STORE);

        // 1. Clear existing transactions and bulk insert new list
        txStore.clear();
        for (const tx of data.transactions || []) {
          txStore.put(tx);
        }

        // 2. Write metadata tables
        const metaPayloads: { key: string; value: any }[] = [
          { key: 'version', value: data.version || 1 },
          { key: 'exportedAt', value: new Date().toISOString() },
          { key: 'persons', value: data.persons || [] },
          { key: 'categoryGroups', value: data.categoryGroups || [] },
          { key: 'monthlyBudgets', value: data.monthlyBudgets || [] },
          { key: 'bankConfigs', value: data.bankConfigs || [] },
          { key: 'rules', value: data.rules || [] },
          { key: 'excludeRules', value: data.excludeRules || [] },
          { key: 'deletedSignatures', value: data.deletedSignatures || [] },
          { key: 'settings', value: data.settings || {} }
        ];

        for (const entry of metaPayloads) {
          metaStore.put(entry);
        }

        idbTx.oncomplete = () => {
          this.dbTxCount.set((data.transactions || []).length);
          resolve();
        };

        idbTx.onerror = () => {
          console.error('[StorageService] Save transaction failed:', idbTx.error);
          reject(idbTx.error);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Full SELECT * Equivalent:
   * Direct database query extracting every record from `transactions` and `metadata`.
   */
  public async exportAll(): Promise<AppDataBackup> {
    const backup = await this.loadAll();
    if (!backup) {
      throw new Error('Database is empty or could not be queried');
    }
    return backup;
  }

  /**
   * Full Re-Importing:
   * Atomically clears and replaces all records in IndexedDB with the provided backup.
   */
  public async importAll(data: AppDataBackup): Promise<void> {
    if (!data) throw new Error('Cannot import empty data payload');
    await this.saveAllImmediate(data);
    await this.refreshStats();
  }

  /**
   * Clears all transactions and metadata from the database.
   */
  public async clearAll(): Promise<void> {
    const db = this.db;
    if (!db) return;
    return new Promise<void>((resolve, reject) => {
      try {
        const idbTx = db.transaction([this.TX_STORE, this.META_STORE], 'readwrite');
        idbTx.objectStore(this.TX_STORE).clear();
        idbTx.objectStore(this.META_STORE).clear();
        idbTx.oncomplete = () => {
          this.dbTxCount.set(0);
          resolve();
        };
        idbTx.onerror = () => reject(idbTx.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Queries transactions by a date range using the 'date' index.
   */
  public async getTransactionsByDateRange(startDate: string, endDate: string): Promise<Transaction[]> {
    const db = this.db;
    if (!db) return [];
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(this.TX_STORE, 'readonly');
        const store = tx.objectStore(this.TX_STORE);
        const index = store.index('date');
        const range = IDBKeyRange.bound(startDate, endDate);
        const req = index.getAll(range);

        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }
}
