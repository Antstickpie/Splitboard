import { Injectable, inject } from '@angular/core';
import * as XLSX from 'xlsx';
import { TransactionService } from './transaction.service';
import { Transaction, SplitType } from '../models';

export interface ParsedStatementResult {
  transactions: Transaction[];
  duplicates: Transaction[];
  excluded: Transaction[];
  duplicatesCount: number;
  excludedCount: number;
  bankName: string;
  totalParsed: number;
}

@Injectable({
  providedIn: 'root'
})
export class StatementParserService {
  private service = inject(TransactionService);

  public async parseFile(
    file: File,
    bankName: string,
    defaultOwner: string,
    customMappings?: Record<string, number>
  ): Promise<ParsedStatementResult> {
    const isXlsx = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    const isPdf = file.name.endsWith('.pdf');

    if (isPdf) {
      return this.parsePdfFile(file, bankName, defaultOwner);
    }

    let rawText = '';
    if (isXlsx) {
      const data = new Uint8Array(await file.arrayBuffer());
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      rawText = XLSX.utils.sheet_to_csv(firstSheet);
    } else {
      rawText = await file.text();
    }

    return this.parseText(rawText, bankName, defaultOwner, file.name, customMappings);
  }

  public async parsePdfFile(
    file: File,
    bankName: string,
    defaultOwner: string
  ): Promise<ParsedStatementResult> {
    const arrayBuffer = await file.arrayBuffer();
    let fullText = '';

    // Check if pdfjsLib is loaded in window or try runtime evaluation
    const winPdfJs = (window as any).pdfjsLib;
    if (winPdfJs) {
      try {
        const loadingTask = winPdfJs.getDocument({ data: new Uint8Array(arrayBuffer) });
        const pdf = await loadingTask.promise;

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(' ');
          fullText += '\n' + pageText;
        }
      } catch (e) {
        console.warn('pdfjsLib runtime parse failed:', e);
      }
    }

    // Fallback: extract plain text / stream text from raw PDF bytes
    if (!fullText.trim()) {
      fullText = this.extractRawPdfText(new Uint8Array(arrayBuffer));
    }

    return this.extractTransactionsFromPdfText(fullText, bankName, defaultOwner, file.name);
  }

  private extractRawPdfText(bytes: Uint8Array): string {
    const decoder = new TextDecoder('latin1');
    const raw = decoder.decode(bytes);
    const textPieces: string[] = [];

    // Extract text blocks inside parentheses (text) Tj / TJ
    const tjRegex = /\(([^)]+)\)\s*(?:Tj|'|")/g;
    let match: RegExpExecArray | null;
    while ((match = tjRegex.exec(raw)) !== null) {
      textPieces.push(match[1]);
    }

    // Also look for bracketed array text [(text)-100(more)] TJ
    const arrayRegex = /\[(.*?)\]\s*TJ/g;
    while ((match = arrayRegex.exec(raw)) !== null) {
      const inner = match[1];
      const innerMatches = inner.match(/\(([^)]+)\)/g);
      if (innerMatches) {
        textPieces.push(innerMatches.map((m) => m.slice(1, -1)).join(' '));
      }
    }

    return textPieces.join(' ');
  }

  public parseText(
    text: string,
    bankName: string,
    defaultOwner: string,
    fileName: string,
    customMappings?: Record<string, number>
  ): ParsedStatementResult {
    const lines = this.splitIntoLines(text);
    if (lines.length === 0) {
      return { transactions: [], duplicates: [], excluded: [], duplicatesCount: 0, excludedCount: 0, bankName, totalParsed: 0 };
    }

    const detectedBank = this.detectBank(bankName, fileName, text);
    const delimiter = this.detectDelimiter(text);
    const parsedRows = lines.map((line) => this.parseCsvLine(line, delimiter));

    const mapping = customMappings || this.detectColumnMapping(parsedRows, detectedBank);
    const existingSignatures = new Set(
      this.service.transactions().map((t) => this.service.getTransactionSignature(t))
    );

    const transactions: Transaction[] = [];
    const duplicates: Transaction[] = [];
    const excluded: Transaction[] = [];
    const startIdx = mapping.hasHeader ? (mapping.headerRowIndex !== undefined ? mapping.headerRowIndex + 1 : 1) : 0;

    for (let i = startIdx; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      if (!row || row.length < 2) continue;

      const dateStr = mapping.dateIdx >= 0 ? (row[mapping.dateIdx] || '').trim() : '';
      const isoDate = this.normalizeDate(dateStr);
      if (!isoDate) continue;

      let desc = mapping.descIdx >= 0 ? (row[mapping.descIdx] || '').trim() : 'Transaction';
      if (mapping.descIdx2 !== undefined && mapping.descIdx2 >= 0 && row[mapping.descIdx2]) {
        desc += ' ' + row[mapping.descIdx2].trim();
      }

      const rawAmt = mapping.amountIdx >= 0 ? (row[mapping.amountIdx] || '').trim() : '0';
      const amount = this.parseAmount(rawAmt);
      if (amount === 0) continue;

      const cleanDesc = desc.replace(/\s+/g, ' ').trim();
      const { group, item, defaultSplit } = this.matchCategory(cleanDesc);

      // Extract statement Currency and convert if different from Base Currency
      let txCurrency = '';
      if (mapping.currencyIdx !== undefined && mapping.currencyIdx >= 0 && row[mapping.currencyIdx]) {
        txCurrency = row[mapping.currencyIdx].trim().toUpperCase();
      } else {
        const customConfig = this.service.bankConfigs().find((b) => b.name.toLowerCase() === detectedBank.toLowerCase());
        if (customConfig?.defaultCurrency) {
          txCurrency = customConfig.defaultCurrency.toUpperCase();
        }
      }

      if (txCurrency === '€' || txCurrency === 'EURO') txCurrency = 'EUR';
      else if (txCurrency === '$') txCurrency = 'USD';
      else if (txCurrency === '₹') txCurrency = 'INR';
      else if (txCurrency === '£') txCurrency = 'GBP';

      const baseCurr = this.service.currency();
      let finalAmount = Math.abs(amount);
      let origAmt: number | undefined;
      let origCurr: string | undefined;
      let exRate: number | undefined;

      if (txCurrency && txCurrency !== baseCurr) {
        origAmt = Math.abs(amount);
        origCurr = txCurrency;
        exRate = this.service.getExchangeRate(txCurrency, baseCurr);
        finalAmount = this.service.convertAmount(origAmt, txCurrency, baseCurr);
      }

      const tx: Transaction = {
        id: 'tx-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now(),
        date: isoDate,
        amount: finalAmount,
        type: amount < 0 ? 'EXPENSE' : 'INCOME',
        description: cleanDesc,
        bank: detectedBank,
        account: detectedBank,
        paidBy: defaultOwner || this.service.personOne().name,
        categoryGroup: group,
        categoryItem: item,
        splitType: defaultSplit || 'SELF',
        splitPercentage: 50,
        currency: baseCurr,
        originalAmount: origAmt,
        originalCurrency: origCurr,
        exchangeRate: exRate,
        sourceFile: fileName,
        createdAt: new Date().toISOString()
      };

      // 1. Check Bank Exclusion Rules (e.g. Daily Interest, Internal Transfers)
      const fullRowText = (cleanDesc + ' ' + (row[0] || '') + ' ' + (row[1] || '')).trim();
      if (this.service.isTransactionExcluded(fullRowText, detectedBank)) {
        excluded.push(tx);
        continue;
      }

      // 2. Check Duplicates
      const sig = this.service.getTransactionSignature(tx);
      if (existingSignatures.has(sig)) {
        duplicates.push(tx);
      } else {
        existingSignatures.add(sig);
        transactions.push(tx);
      }
    }

    return {
      transactions,
      duplicates,
      excluded,
      duplicatesCount: duplicates.length,
      excludedCount: excluded.length,
      bankName: detectedBank,
      totalParsed: parsedRows.length - (mapping.hasHeader ? 1 : 0)
    };
  }

  private extractTransactionsFromPdfText(
    text: string,
    bankName: string,
    defaultOwner: string,
    fileName: string
  ): ParsedStatementResult {
    const transactions: Transaction[] = [];
    const duplicates: Transaction[] = [];
    const excluded: Transaction[] = [];
    const detectedBank = this.detectBank(bankName, fileName, text);
    const existingSignatures = new Set(
      this.service.transactions().map((t) => this.service.getTransactionSignature(t))
    );

    // Matches German statement patterns: DD.MM.YYYY | DD/MM/YYYY text +/-amount EUR
    const regex = /(\d{2}[./\-]\d{2}[./\-]\d{2,4})\s+([A-Za-z0-9\s\-.,/&@äöüÄÖÜß#*+]+?)\s+([+\-]?\s*\d{1,3}(?:\.\d{3})*,\d{2}|[+\-]?\s*\d+\.\d{2})\s*(?:EUR|€)?/g;

    let match: RegExpExecArray | null;
    let count = 0;

    while ((match = regex.exec(text)) !== null) {
      count++;
      const rawDate = match[1];
      const rawDesc = match[2].trim();
      const rawAmt = match[3];

      const isoDate = this.normalizeDate(rawDate);
      if (!isoDate) continue;

      const amount = this.parseAmount(rawAmt);
      if (amount === 0) continue;

      const cleanDesc = rawDesc.replace(/\s+/g, ' ').trim();
      const { group, item, defaultSplit } = this.matchCategory(cleanDesc);

      const tx: Transaction = {
        id: 'tx-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now(),
        date: isoDate,
        amount: Math.abs(amount),
        type: amount < 0 ? 'EXPENSE' : 'INCOME',
        description: cleanDesc,
        bank: detectedBank,
        account: detectedBank,
        paidBy: defaultOwner || this.service.personOne().name,
        categoryGroup: group,
        categoryItem: item,
        splitType: defaultSplit || 'SELF',
        splitPercentage: 50,
        sourceFile: fileName,
        createdAt: new Date().toISOString()
      };

      if (this.service.isTransactionExcluded(cleanDesc, detectedBank)) {
        excluded.push(tx);
        continue;
      }

      const sig = this.service.getTransactionSignature(tx);
      if (existingSignatures.has(sig)) {
        duplicates.push(tx);
      } else {
        existingSignatures.add(sig);
        transactions.push(tx);
      }
    }

    return {
      transactions,
      duplicates,
      excluded,
      duplicatesCount: duplicates.length,
      excludedCount: excluded.length,
      bankName: detectedBank,
      totalParsed: count
    };
  }

  private detectBank(selectedBank: string, fileName: string, text: string): string {
    const combined = (selectedBank + ' ' + fileName + ' ' + text.slice(0, 1000)).toLowerCase();
    if (combined.includes('deutsche bank') || combined.includes('db')) return 'Deutsche Bank';
    if (combined.includes('zinia') || combined.includes('amazon visa') || combined.includes('santander')) return 'Amazon Visa (Zinia)';
    if (combined.includes('amex') || combined.includes('american express')) return 'Amex';
    if (combined.includes('revolut') || combined.includes('-rev-') || combined.includes('rev_') || combined.includes('an-rev')) return 'Revolut';
    if (combined.includes('commerzbank') || combined.includes('commerz')) return 'Commerzbank';
    return selectedBank || 'Generic Bank';
  }

  private detectColumnMapping(rows: string[][], bank: string): {
    dateIdx: number;
    descIdx: number;
    descIdx2?: number;
    amountIdx: number;
    currencyIdx?: number;
    hasHeader: boolean;
    headerRowIndex?: number;
  } {
    if (rows.length === 0) return { dateIdx: 0, descIdx: 1, amountIdx: 2, hasHeader: true };

    // Find actual header row (sometimes banks have metadata in first 2-5 rows)
    let headerRowIdx = 0;
    for (let r = 0; r < Math.min(6, rows.length); r++) {
      const lineStr = rows[r].join(' ').toLowerCase();
      if (
        lineStr.includes('datum') ||
        lineStr.includes('date') ||
        lineStr.includes('buchungstag') ||
        lineStr.includes('verwendungszweck') ||
        lineStr.includes('betrag') ||
        lineStr.includes('amount') ||
        lineStr.includes('description') ||
        lineStr.includes('started date')
      ) {
        headerRowIdx = r;
        break;
      }
    }

    const header = rows[headerRowIdx].map((h) => h.toLowerCase().trim());
    const genericCurrencyIdx = header.findIndex(
      (h) => h.includes('currency') || h.includes('währung') || h.includes('curr') || h.includes('devise')
    );

    // Look up bank from exported / user-configured BankConfigs
    const bankConfig = this.service.bankConfigs().find(
      (b) => b.name.toLowerCase() === bank.toLowerCase() || bank.toLowerCase().includes(b.name.toLowerCase())
    );

    let dateIdx = -1;
    let descIdx = -1;
    let descIdx2: number | undefined = undefined;
    let amountIdx = -1;
    let currencyIdx: number | undefined = genericCurrencyIdx >= 0 ? genericCurrencyIdx : undefined;

    if (bankConfig) {
      if (bankConfig.dateColName) {
        dateIdx = header.findIndex((h) => h.includes(bankConfig.dateColName!.toLowerCase()));
      }
      if (bankConfig.descColName) {
        descIdx = header.findIndex((h) => h.includes(bankConfig.descColName!.toLowerCase()));
      }
      if (bankConfig.descColName2) {
        const d2 = header.findIndex((h) => h.includes(bankConfig.descColName2!.toLowerCase()));
        if (d2 >= 0 && d2 !== descIdx) descIdx2 = d2;
      }
      if (bankConfig.amountColName) {
        amountIdx = header.findIndex((h) => h.includes(bankConfig.amountColName!.toLowerCase()));
      }
      if (bankConfig.currencyColName) {
        const cIdx = header.findIndex((h) => h.includes(bankConfig.currencyColName!.toLowerCase()));
        if (cIdx >= 0) currencyIdx = cIdx;
      }
    }

    // Smart Fallback if bank config column was not found in header
    if (dateIdx === -1) {
      dateIdx = header.findIndex((h) => h.includes('started date') || h.includes('completed date') || h.includes('transaktion') || h.includes('buchungstag') || h.includes('datum') || h.includes('date') || h.includes('buchung'));
    }
    if (descIdx === -1) {
      descIdx = header.findIndex((h) => h.includes('description') || h.includes('beschreibung') || h.includes('händler') || h.includes('begünstigter') || h.includes('buchungstext') || h.includes('verwendungszweck') || h.includes('empfänger') || h.includes('payee') || h.includes('text') || h.includes('details'));
    }
    if (descIdx2 === undefined) {
      const secondaryDesc = header.findIndex((h) => (h.includes('verwendungszweck') || h.includes('auftraggeber') || h.includes('details')) && h !== header[descIdx]);
      if (secondaryDesc >= 0) descIdx2 = secondaryDesc;
    }
    if (amountIdx === -1) {
      amountIdx = header.findIndex((h) => h.includes('amount') || h.includes('betrag') || h.includes('summe') || h.includes('soll') || h.includes('haben') || h.includes('wert'));
    }

    if (dateIdx === -1) dateIdx = 0;
    if (descIdx === -1) descIdx = 1;
    if (amountIdx === -1) amountIdx = rows[headerRowIdx].length - 1;

    return {
      dateIdx,
      descIdx,
      descIdx2,
      amountIdx,
      currencyIdx,
      hasHeader: true,
      headerRowIndex: headerRowIdx
    };
  }

  public normalizeDate(str: string): string | null {
    if (!str) return null;
    const clean = str.trim();

    // DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
    const dmyMatch = clean.match(/^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})/);
    if (dmyMatch) {
      const day = dmyMatch[1].padStart(2, '0');
      const month = dmyMatch[2].padStart(2, '0');
      let year = dmyMatch[3];
      if (year.length === 2) year = '20' + year;
      return `${year}-${month}-${day}`;
    }

    // YYYY-MM-DD or YYYY.MM.DD
    const ymdMatch = clean.match(/^(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})/);
    if (ymdMatch) {
      const year = ymdMatch[1];
      const month = ymdMatch[2].padStart(2, '0');
      const day = ymdMatch[3].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    const dt = new Date(clean);
    if (!isNaN(dt.getTime())) {
      return dt.toISOString().slice(0, 10);
    }

    return null;
  }

  public parseAmount(raw: string): number {
    if (!raw) return 0;
    let clean = raw.trim();

    const isNegative = clean.includes('-') || clean.endsWith('S') || clean.endsWith('D');
    clean = clean.replace(/[^0-9,.-]/g, '');

    if (clean.includes(',') && clean.includes('.')) {
      if (clean.indexOf('.') < clean.indexOf(',')) {
        clean = clean.replace(/\./g, '').replace(',', '.');
      } else {
        clean = clean.replace(/,/g, '');
      }
    } else if (clean.includes(',')) {
      clean = clean.replace(',', '.');
    }

    const val = parseFloat(clean);
    if (isNaN(val)) return 0;
    return isNegative ? -Math.abs(val) : val;
  }

  private matchCategory(desc: string): { group?: string; item?: string; defaultSplit?: SplitType; defaultOwner?: string } {
    const d = desc.toLowerCase();

    // 1. Evaluate user-configured rules first
    for (const rule of this.service.rules()) {
      if (rule.keyword && d.includes(rule.keyword.toLowerCase())) {
        return {
          group: rule.categoryGroup,
          item: rule.categoryItem,
          defaultSplit: rule.splitType || 'SELF',
          defaultOwner: rule.paidBy
        };
      }
    }

    // 2. Evaluate default category names matching
    for (const grp of this.service.categoryGroups()) {
      for (const item of grp.items) {
        const iname = item.name.toLowerCase();
        const cleanName = iname.replace(/\[.*?\]/g, '').trim();

        if (cleanName && cleanName.length > 3 && d.includes(cleanName)) {
          let defaultSplit: SplitType = 'SELF';
          if (iname.includes('split') || iname.includes('[s]') || iname.includes('groceries') || iname.includes('utilities') || iname.includes('rent')) {
            defaultSplit = 'SPLIT';
          }
          return { group: grp.name, item: item.name, defaultSplit, defaultOwner: item.defaultOwner };
        }
      }
    }

    // 3. Common German banking heuristics
    if (d.includes('rewe') || d.includes('edeka') || d.includes('aldi') || d.includes('lidl') || d.includes('kaufland') || d.includes('penny') || d.includes('supermarkt')) {
      return { group: 'Housing', item: 'Groceries', defaultSplit: 'SPLIT' };
    }
    if (d.includes('miete') || d.includes('rent') || d.includes('stadtwerke') || d.includes('vattenfall') || d.includes('eon') || d.includes('telekom') || d.includes('vodafone')) {
      return { group: 'Housing', item: 'Rent and Utilities', defaultSplit: 'SPLIT' };
    }
    if (d.includes('enpal') || d.includes('gehalt') || d.includes('salary') || d.includes('lohn')) {
      return { group: 'Income', item: 'Salary / Income', defaultSplit: 'SELF', defaultOwner: this.service.personOne().name };
    }
    if (d.includes('bosch')) {
      return { group: 'Income', item: 'Salary / Income', defaultSplit: 'SELF', defaultOwner: this.service.personTwo().name };
    }

    return {};
  }

  private splitIntoLines(text: string): string[] {
    return text
      .split(/\r\n|\n|\r/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  private detectDelimiter(text: string): string {
    const commaCount = (text.match(/,/g) || []).length;
    const semicolonCount = (text.match(/;/g) || []).length;
    const tabCount = (text.match(/\t/g) || []).length;

    if (semicolonCount > commaCount && semicolonCount > tabCount) return ';';
    if (tabCount > commaCount && tabCount > semicolonCount) return '\t';
    return ',';
  }

  private parseCsvLine(line: string, delimiter: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += c;
      }
    }
    result.push(current.trim());
    return result;
  }
}
