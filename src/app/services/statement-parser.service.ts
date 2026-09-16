import { Injectable, inject } from '@angular/core';
import * as XLSX from 'xlsx';
import { TransactionService } from './transaction.service';
import { Transaction, SplitType, BankConfig, ParsedStatementResult } from '../models';

export type { ParsedStatementResult };

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

    try {
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

      if (pdfLib) {
        if (pdfLib.GlobalWorkerOptions && !pdfLib.GlobalWorkerOptions.workerSrc) {
          pdfLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
        }
        const loadingTask = pdfLib.getDocument({ data: new Uint8Array(arrayBuffer) });
        const pdf = await loadingTask.promise;

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();

          const items = (textContent.items as any[])
            .filter((item) => item && typeof item.str === 'string' && item.str.trim().length > 0)
            .map((item) => ({
              str: item.str,
              x: item.transform ? item.transform[4] : 0,
              y: item.transform ? item.transform[5] : 0
            }));

          // Sort items top-to-bottom (descending Y), then left-to-right (ascending X)
          items.sort((a, b) => b.y - a.y || a.x - b.x);

          // Group items into visual lines
          interface LineGroup {
            minY: number;
            maxY: number;
            avgY: number;
            items: { str: string; x: number; y: number }[];
          }
          const lines: LineGroup[] = [];

          for (const item of items) {
            let bestLine: LineGroup | null = null;
            let minDist = Infinity;
            for (const line of lines) {
              const dist = Math.abs(line.avgY - item.y);
              if (dist < minDist) {
                minDist = dist;
                bestLine = line;
              }
            }

            if (bestLine && (minDist <= 10.0 || (item.y >= bestLine.minY - 6.0 && item.y <= bestLine.maxY + 6.0))) {
              bestLine.items.push(item);
              bestLine.minY = Math.min(bestLine.minY, item.y);
              bestLine.maxY = Math.max(bestLine.maxY, item.y);
              bestLine.avgY = (bestLine.avgY * (bestLine.items.length - 1) + item.y) / bestLine.items.length;
            } else {
              lines.push({ minY: item.y, maxY: item.y, avgY: item.y, items: [item] });
            }
          }

          // Sort lines top-to-bottom
          lines.sort((a, b) => b.avgY - a.avgY);

          // Sort items in each line left-to-right
          const pageLines: string[] = [];
          for (const line of lines) {
            line.items.sort((a, b) => a.x - b.x);
            pageLines.push(line.items.map((i) => i.str).join(' '));
          }

          fullText += '\n' + pageLines.join('\n');
        }
      }
    } catch (e) {
      console.warn('[StatementParser] pdfjsLib parse failed:', e);
    }

    if (!fullText.trim()) {
      fullText = this.extractRawPdfText(new Uint8Array(arrayBuffer));
    }

    return this.extractTransactionsFromPdfText(fullText, bankName, defaultOwner, file.name);
  }

  private extractRawPdfText(bytes: Uint8Array): string {
    const decoder = new TextDecoder('latin1');
    const raw = decoder.decode(bytes);
    const textPieces: string[] = [];

    const tjRegex = /\(([^)]+)\)\s*(?:Tj|'|")/g;
    let match: RegExpExecArray | null;
    while ((match = tjRegex.exec(raw)) !== null) {
      textPieces.push(match[1]);
    }

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
    statementOwner: string,
    fileName: string,
    customMappings?: Record<string, number>
  ): ParsedStatementResult {
    const lines = this.splitIntoLines(text);
    if (lines.length === 0) {
      return { transactions: [], incomes: [], duplicates: [], excluded: [], deleted: [], incomesCount: 0, duplicatesCount: 0, excludedCount: 0, deletedCount: 0, bankName, totalParsed: 0 };
    }

    const detectedBank = this.detectBank(bankName, fileName, text);
    const effectiveBank = (bankName && bankName !== 'Auto-Detect' ? bankName : detectedBank || 'Generic Bank').trim();
    const delimiter = this.detectDelimiter(text);
    const parsedRows = lines.map((line) => this.parseCsvLine(line, delimiter));

    const mapping = customMappings || this.detectColumnMapping(parsedRows, detectedBank);

    const bankCfg = this.service.bankConfigs().find((b) => b.name.toLowerCase() === detectedBank.toLowerCase());
    let invertSigns = bankCfg?.invertAmountSign ?? false;

    const startIdx = mapping.hasHeader ? (mapping.headerRowIndex !== undefined ? mapping.headerRowIndex + 1 : 1) : 0;

    // Smart credit card sign heuristic
    if (!bankCfg || bankCfg.invertAmountSign === undefined) {
      let paymentInNegativeCount = 0;
      let merchantInPositiveCount = 0;
      let totalNegativeCount = 0;
      let totalPositiveCount = 0;

      for (let i = startIdx; i < Math.min(startIdx + 50, parsedRows.length); i++) {
        const row = parsedRows[i];
        if (!row || row.length < 2) continue;
        const rawAmt = mapping.amountIdx >= 0 ? (row[mapping.amountIdx] || '').trim() : '0';
        const amt = this.parseAmount(rawAmt);
        if (amt === 0) continue;

        const rowDesc = ((mapping.descIdx >= 0 ? row[mapping.descIdx] : '') + ' ' + (mapping.descIdx2 !== undefined && mapping.descIdx2 >= 0 ? row[mapping.descIdx2] : '')).toLowerCase();

        if (amt < 0) {
          totalNegativeCount++;
          if (rowDesc.includes('zahlung erhalten') || rowDesc.includes('überweisung erhalten') || rowDesc.includes('payment received') || rowDesc.includes('besten dank')) {
            paymentInNegativeCount++;
          }
        } else {
          totalPositiveCount++;
          if (rowDesc.includes('dm-') || rowDesc.includes('drogerie') || rowDesc.includes('penny') || rowDesc.includes('rewe') || rowDesc.includes('edeka') || rowDesc.includes('aldi') || rowDesc.includes('lidl') || rowDesc.includes('supermarkt') || rowDesc.includes('amazon') || rowDesc.includes('uber') || rowDesc.includes('restaurant')) {
            merchantInPositiveCount++;
          }
        }
      }

      if (paymentInNegativeCount > 0 || (merchantInPositiveCount >= 2 && totalPositiveCount > totalNegativeCount)) {
        invertSigns = true;
      }
    }

    const duplicateTracker = this.createDuplicateTracker(fileName);

    const transactions: Transaction[] = [];
    const incomes: Transaction[] = [];
    const duplicates: Transaction[] = [];
    const excluded: Transaction[] = [];
    const deleted: Transaction[] = [];

    for (let i = startIdx; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      if (!row || row.length < 2) continue;

      const dateStr = mapping.dateIdx >= 0 ? (row[mapping.dateIdx] || '').trim() : '';
      const isoDate = this.normalizeDate(dateStr);
      if (!isoDate) continue;

      let desc = mapping.descIdx >= 0 ? (row[mapping.descIdx] || '').trim() : 'Transaction';
      if (mapping.descIdx2 !== undefined && mapping.descIdx2 >= 0 && row[mapping.descIdx2]) {
        const secondary = row[mapping.descIdx2].trim();
        if (secondary && secondary !== desc) {
          desc += ' ' + secondary;
        }
      }

      let amount = 0;
      const rawDebit = mapping.debitIdx !== undefined && mapping.debitIdx >= 0 ? (row[mapping.debitIdx] || '').trim() : '';
      const rawCredit = mapping.creditIdx !== undefined && mapping.creditIdx >= 0 ? (row[mapping.creditIdx] || '').trim() : '';

      if (rawDebit && this.parseAmount(rawDebit) > 0) {
        amount = -Math.abs(this.parseAmount(rawDebit));
      } else if (rawCredit && this.parseAmount(rawCredit) > 0) {
        amount = Math.abs(this.parseAmount(rawCredit));
      } else if (mapping.amountIdx >= 0) {
        amount = this.parseAmount(row[mapping.amountIdx] || '0');
      }

      if (mapping.sollHabenIdx !== undefined && mapping.sollHabenIdx >= 0 && row[mapping.sollHabenIdx]) {
        const sh = row[mapping.sollHabenIdx].trim().toLowerCase();
        if (sh === 's' || sh === 'soll' || sh === 'd' || sh === 'debit' || sh === 'belastung' || sh === 'dr') {
          amount = -Math.abs(amount);
        } else if (sh === 'h' || sh === 'haben' || sh === 'c' || sh === 'credit' || sh === 'gutschrift' || sh === 'cr') {
          amount = Math.abs(amount);
        }
      }

      if (amount === 0) continue;

      const cleanDesc = this.service.fixMojibake(desc.replace(/\s+/g, ' ').trim());
      const { group, item, defaultSplit, incomeNextMonth, defaultNote } = this.matchCategory(cleanDesc, detectedBank);

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

      const isCharge = invertSigns ? amount > 0 : amount < 0;
      const isIncomeOrPayment = !isCharge;

      const tx: Transaction = {
        id: 'tx-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now(),
        date: isoDate,
        amount: finalAmount,
        type: isIncomeOrPayment ? 'INCOME' : 'EXPENSE',
        incomeMonth: (isIncomeOrPayment && incomeNextMonth) ? this.service.getNextMonth(isoDate.slice(0, 7)) : undefined,
        description: cleanDesc,
        bank: effectiveBank,
        account: effectiveBank,
        paidBy: statementOwner || this.service.personOne().name,
        categoryGroup: group || 'Uncategorized',
        categoryItem: item || 'Uncategorized',
        splitType: defaultSplit,
        splitPercentage: 50,
        note: defaultNote || undefined,
        currency: baseCurr,
        originalAmount: origAmt,
        originalCurrency: origCurr,
        exchangeRate: exRate,
        sourceFile: fileName,
        rawDate: dateStr.trim(),
        createdAt: new Date().toISOString()
      };

      const fullRowText = (cleanDesc + ' ' + (row[0] || '') + ' ' + (row[1] || '')).trim();
      const sig = this.service.getTransactionSignature(tx);

      if (this.service.isTransactionExcluded(fullRowText, effectiveBank) || this.service.isSignatureExcluded(sig, tx)) {
        excluded.push(tx);
        continue;
      }

      const matchedDbTx = duplicateTracker.claim(tx);
      if (matchedDbTx) {
        this.service.restoreDeletedSignature(sig, tx);
        this.service.restoreExcludedSignature(sig, tx);
        if (matchedDbTx.categoryGroup) tx.categoryGroup = matchedDbTx.categoryGroup;
        if (matchedDbTx.categoryItem) tx.categoryItem = matchedDbTx.categoryItem;
        if (matchedDbTx.splitType) tx.splitType = matchedDbTx.splitType;
        if (matchedDbTx.splitMode) tx.splitMode = matchedDbTx.splitMode;
        if (matchedDbTx.splitPercentage !== undefined) tx.splitPercentage = matchedDbTx.splitPercentage;
        if (matchedDbTx.paidBy) tx.paidBy = matchedDbTx.paidBy;
        if (matchedDbTx.customSplitAmounts) tx.customSplitAmounts = { ...matchedDbTx.customSplitAmounts };
        if (matchedDbTx.note) tx.note = matchedDbTx.note;
        if (matchedDbTx.bank && !tx.bank) tx.bank = matchedDbTx.bank;
        tx.isDone = true;
        duplicates.push(tx);
        continue;
      }

      if (this.service.isSignatureDeleted(sig, tx)) {
        deleted.push(tx);
        continue;
      }

      if (isIncomeOrPayment) {
        incomes.push(tx);
      } else {
        transactions.push(tx);
      }
    }

    transactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    incomes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    duplicates.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    excluded.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    deleted.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    return {
      transactions,
      incomes,
      duplicates,
      excluded,
      deleted,
      incomesCount: incomes.length,
      duplicatesCount: duplicates.length,
      excludedCount: excluded.length,
      deletedCount: deleted.length,
      bankName: effectiveBank,
      totalParsed: transactions.length + incomes.length + duplicates.length + excluded.length + deleted.length
    };
  }

  public cleanTransactionDescription(raw: string, bankCfg?: BankConfig): string {
    if (!raw) return '';
    let clean = raw;

    if (bankCfg?.accountNumber) {
      const accNum = bankCfg.accountNumber.replace(/[^a-zA-Z0-9]/g, '');
      if (accNum.length >= 3) {
        const accRegex = new RegExp(`(?:\\*{2,}|[a-zA-Z0-9]*)\\s*${accNum}\\b`, 'gi');
        clean = clean.replace(accRegex, ' ');
      }
    }

    if (bankCfg?.ignoreColName) {
      const tokens = bankCfg.ignoreColName.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      for (const tok of tokens) {
        const tokRegex = new RegExp(`\\b${tok}\\b[:\\s]*`, 'gi');
        clean = clean.replace(tokRegex, ' ');
      }
    }

    clean = clean.replace(/\b(?:karte|card|konto|karten-?nr\.?)[:\s]*\*{3,}\d{2,6}\b/gi, ' ');
    clean = clean.replace(/(?:\*{3,}[\s-]*)+\d{2,6}\b/g, ' ');
    clean = clean.replace(/(?:\*{4}[\s-]*){1,3}\d{4}\b/g, ' ');
    clean = clean.replace(/\b\d{4}[ -]\*{4}[ -]\*{4}[ -]\d{4}\b/g, ' ');
    clean = clean.replace(/\b(?:karte|card)[:\s]+(?:\*{3,}|\d{4})\b/gi, ' ');
    clean = clean.replace(/(?:^|\s)[+\-]\d+\s*(?:punkte|points|pts)?\s*$/gi, ' ');
    clean = clean.replace(/[./]{2,}/g, ' ');
    clean = clean.replace(/(?:^|\s)[-–—]{1,3}(?=\s|$)/g, ' ');
    clean = clean.replace(/^[–—\-_:.,/\s]+|[–—\-_:.,/\s]+$/g, '');
    clean = clean.replace(/\s+/g, ' ').trim();
    return this.service.fixMojibake(clean);
  }

  private createDuplicateTracker(fileName?: string): {
    claim: (tx: Transaction) => Transaction | null;
  } {
    const exactMap = new Map<string, Transaction[]>();
    const noBankMap = new Map<string, Transaction[]>();
    const normMap = new Map<string, Transaction[]>();
    const sourceFileMap = new Map<string, Transaction[]>();

    const getKeys = (t: Transaction) => {
      const d = (t.date || '').slice(0, 10);
      const amt = Math.abs(Number(t.amount) || 0).toFixed(2);
      const desc = (t.description || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const bank = (t.bank || '').trim().toLowerCase();
      const normMerchant = this.normalizeMerchant(desc);

      const exact = `${d}_${amt}_${desc}_${bank}`;
      const noBank = `${d}_${amt}_${desc}`;
      const norm = normMerchant ? `${d}_${amt}_${normMerchant}` : '';
      const sf = t.sourceFile && fileName && t.sourceFile === fileName ? `${d}_${amt}_${normMerchant || desc}` : '';

      return { exact, noBank, norm, sf };
    };

    for (const t of this.service.transactions()) {
      const k = getKeys(t);
      if (!exactMap.has(k.exact)) exactMap.set(k.exact, []);
      exactMap.get(k.exact)!.push(t);

      if (!noBankMap.has(k.noBank)) noBankMap.set(k.noBank, []);
      noBankMap.get(k.noBank)!.push(t);

      if (k.norm) {
        if (!normMap.has(k.norm)) normMap.set(k.norm, []);
        normMap.get(k.norm)!.push(t);
      }
      if (k.sf) {
        if (!sourceFileMap.has(k.sf)) sourceFileMap.set(k.sf, []);
        sourceFileMap.get(k.sf)!.push(t);
      }

      if (t.splitOriginalAmount && t.splitPartIndex === 1) {
        const kOrig = getKeys({ ...t, amount: t.splitOriginalAmount });
        if (!exactMap.has(kOrig.exact)) exactMap.set(kOrig.exact, []);
        exactMap.get(kOrig.exact)!.push(t);

        if (!noBankMap.has(kOrig.noBank)) noBankMap.set(kOrig.noBank, []);
        noBankMap.get(kOrig.noBank)!.push(t);

        if (kOrig.norm) {
          if (!normMap.has(kOrig.norm)) normMap.set(kOrig.norm, []);
          normMap.get(kOrig.norm)!.push(t);
        }
        if (kOrig.sf) {
          if (!sourceFileMap.has(kOrig.sf)) sourceFileMap.set(kOrig.sf, []);
          sourceFileMap.get(kOrig.sf)!.push(t);
        }
      }
    }

    const popMatched = (map: Map<string, Transaction[]>, key: string): Transaction | null => {
      const arr = map.get(key);
      if (arr && arr.length > 0) {
        const match = arr.shift()!;
        const remove = (m: Map<string, Transaction[]>, mk: string) => {
          const list = m.get(mk);
          if (list) {
            const idx = list.indexOf(match);
            if (idx >= 0) list.splice(idx, 1);
          }
        };
        const mk = getKeys(match);
        remove(exactMap, mk.exact);
        remove(noBankMap, mk.noBank);
        if (mk.norm) remove(normMap, mk.norm);
        if (mk.sf) remove(sourceFileMap, mk.sf);
        return match;
      }
      return null;
    };

    const claim = (tx: Transaction): Transaction | null => {
      const k = getKeys(tx);
      let match = popMatched(exactMap, k.exact);
      if (match) return match;

      match = popMatched(noBankMap, k.noBank);
      if (match) return match;

      if (k.sf) {
        match = popMatched(sourceFileMap, k.sf);
        if (match) return match;
      }

      if (k.norm) {
        match = popMatched(normMap, k.norm);
        if (match) return match;
      }

      return null;
    };

    return { claim };
  }

  private extractTransactionsFromPdfText(
    text: string,
    bankName: string,
    statementOwner: string,
    fileName: string
  ): ParsedStatementResult {
    const transactions: Transaction[] = [];
    const incomes: Transaction[] = [];
    const duplicates: Transaction[] = [];
    const excluded: Transaction[] = [];
    const deleted: Transaction[] = [];
    const detectedBank = this.detectBank(bankName, fileName, text);
    const effectiveBank = (bankName && bankName !== 'Auto-Detect' ? bankName : detectedBank || 'Generic Bank').trim();
    const duplicateTracker = this.createDuplicateTracker(fileName);

    const bankCfg = this.service.bankConfigs().find((b) => b.name.toLowerCase() === detectedBank.toLowerCase());

    // Extract fallback year if statement dates are DD.MM or DD-MM
    let fallbackYear = new Date().getFullYear().toString();
    const yearMatch = text.match(/\b(202\d)\b/);
    if (yearMatch) fallbackYear = yearMatch[1];

    const rawLines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

    // Date regex: Match DD.MM.YYYY, DD.MM., DD-MM-YYYY, DD-MM-, DD/MM/YYYY, DD/MM/, YYYY-MM-DD, or DD Month YYYY
    const dateAtStartRegex = /^(?:((?:0[1-9]|[12]\d|3[01]|[1-9])[./\-](?:0[1-9]|1[0-2]|[1-9])(?:[./\-](?:20\d{2}|\d{2}))?)|(\d{4}[./\-](?:0[1-9]|1[0-2])[./\-](?:0[1-9]|[12]\d|3[01]))|((?:0[1-9]|[12]\d|3[01]|[1-9])\s+(?:jan|feb|mär|mar|apr|mai|may|jun|jul|aug|sep|okt|oct|nov|dez|dec)[a-z]*(?:\s+20\d{2})?))[./\-]?(?:\s|$)/i;
    const amountRegex = /([+\-\u2010-\u2015\u2212]?\s*\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\s*[+\-\u2010-\u2015\u2212SH]?)/g;

    // Group lines into row blocks starting with each date line
    interface Block {
      dateStr: string;
      lines: string[];
    }
    const blocks: Block[] = [];
    let currentBlock: Block | null = null;

    for (const line of rawLines) {
      // Skip pure page headers and column headers
      if (
        /^\s*(?:booking\s+date|value\s+item|debit\s+credit|page\s+\d+|seite\s+\d+|kontoauszug|account\s+statement|date\s+details|buchungstag\s+wert)\s*$/i.test(line) ||
        /\b(?:booking\s+date\s+value\s+item|debit\s+credit)\b/i.test(line) ||
        /^\s*(?:page|seite)\s+\d+(?:\s*(?:\/|of)\s*\d+)?\s*$/i.test(line)
      ) {
        continue;
      }

      const dateMatch = line.match(dateAtStartRegex);
      if (dateMatch) {
        if (currentBlock && currentBlock.lines.length > 0) {
          blocks.push(currentBlock);
        }
        const matchedDate = (dateMatch[1] || dateMatch[2] || dateMatch[3] || '').trim();
        currentBlock = { dateStr: matchedDate, lines: [line] };
      } else if (currentBlock) {
        // Check for wrapped year line from date column e.g. "2026 2026 PayPal Europe..."
        const yearWrap = line.match(/^(20\d{2})(?:\s+20\d{2})?\s*(.*)$/);
        if (yearWrap && (/[-./]$/.test(currentBlock.dateStr) || /^\d{1,2}[./\-]\d{1,2}$/.test(currentBlock.dateStr))) {
          currentBlock.dateStr = currentBlock.dateStr.replace(/[-./]+$/, '') + '-' + yearWrap[1];
          if (yearWrap[2]) {
            currentBlock.lines.push(yearWrap[2]);
          }
        } else {
          currentBlock.lines.push(line);
        }
      }
    }
    if (currentBlock && currentBlock.lines.length > 0) {
      blocks.push(currentBlock);
    }

    for (const block of blocks) {
      let rawDate = block.dateStr.replace(/[-./]+$/, '').trim();
      if (/^\d{1,2}[./\-]\d{1,2}$/.test(rawDate)) {
        rawDate = rawDate + '.' + fallbackYear;
      }
      const isoDate = this.normalizeDate(rawDate);
      if (!isoDate) continue;

      let fullBlockText = block.lines.join(' ');
      // Normalize spacing in amounts: "+ 109.99" -> "+109.99", "- 113.36" -> "-113.36"
      fullBlockText = fullBlockText.replace(/([+\-\u2010-\u2015\u2212])\s+(\d)/g, '$1$2');
      fullBlockText = fullBlockText.replace(/([+\-\u2010-\u2015\u2212]?\b\d{1,3})\s+(\d{1,3}[.,]\d{2}\b)/g, '$1$2');

      // Strip full 3-part dates before searching for amounts so dates aren't parsed as amounts
      const textForAmounts = fullBlockText.replace(/\b\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}\b/g, ' ');
      const amtMatches = Array.from(textForAmounts.matchAll(amountRegex));
      if (amtMatches.length === 0) continue;

      // Select the amount token: prefer signed token or last money amount
      let chosenAmtStr = amtMatches[amtMatches.length - 1][1].trim();
      for (const m of amtMatches) {
        const token = m[1].trim();
        if (/[+\-\u2010-\u2015\u2212]/.test(token) || token.endsWith('S') || token.endsWith('H')) {
          chosenAmtStr = token;
          break;
        }
      }

      let amount = this.parseAmount(chosenAmtStr);
      if (chosenAmtStr.endsWith('S') || /[-\u2010-\u2015\u2212]$/.test(chosenAmtStr) || /^[-\u2010-\u2015\u2212]/.test(chosenAmtStr)) {
        amount = -Math.abs(amount);
      } else if (chosenAmtStr.endsWith('H') || chosenAmtStr.endsWith('+') || chosenAmtStr.startsWith('+')) {
        amount = Math.abs(amount);
      }
      if (amount === 0) continue;

      // Build clean description: take full block and remove dates and amount numbers
      let descCandidate = fullBlockText;
      descCandidate = descCandidate.replace(amountRegex, ' ');
      descCandidate = descCandidate.replace(/\b\d{1,2}[./\-]\d{1,2}(?:[./\-]\d{2,4})?\b/g, ' ');
      descCandidate = descCandidate.replace(/\b202\d\b/g, ' ');
      descCandidate = descCandidate.replace(/\b(?:EUR|€|USD|\$|GBP|£)\b/g, ' ');

      const cleanDesc = this.cleanTransactionDescription(descCandidate, bankCfg);
      if (!cleanDesc || cleanDesc.length < 2 || !/[a-zA-Z0-9]/.test(cleanDesc)) {
        continue;
      }

      const { group, item, defaultSplit, incomeNextMonth, defaultNote } = this.matchCategory(cleanDesc, detectedBank);

      // Income detection: positive sign (+, H, credit), income description keywords, or category rule
      const isIncomeDesc =
        /\b(gehalt|salary|lohn|gutschrift|zinsgutschrift|bezüge|bezuege|credit\s+transfer\s+received|überweisung\s+erhalten|ueberweisung\s+erhalten|überweisung\s+von|ueberweisung\s+von|transfer\s+from|received\s+from|erstattung|rückzahlung|rueckzahlung|deposit|inflow)\b/i.test(
          cleanDesc
        ) ||
        /\b(gehalt|salary|lohn|gutschrift|zinsgutschrift|bezüge|bezuege|überweisung\s+von|ueberweisung\s+von|transfer\s+from|received\s+from)\b/i.test(fullBlockText);

      const isExpenseDesc =
        /\b(direct\s+debit|lastschrift|kartenzahlung|kartenverfügung|kartenabrechnung|card\s+payment|debit\s+card|girocard|auszahlung|bargeld|entgelt|gebühr|gebuehr|fee|standing\s+order|dauerauftrag|überweisung\s+an|ueberweisung\s+an|transfer\s+to|payment\s+to)\b/i.test(
          fullBlockText
        );

      let isCharge = true;
      if (chosenAmtStr.includes('-') || chosenAmtStr.includes('–') || chosenAmtStr.includes('—') || chosenAmtStr.endsWith('S') || chosenAmtStr.endsWith('D')) {
        isCharge = true;
      } else if (chosenAmtStr.includes('+') || chosenAmtStr.endsWith('H') || chosenAmtStr.endsWith('C')) {
        isCharge = false;
      } else if (isIncomeDesc && !isExpenseDesc) {
        isCharge = false;
      } else if (isExpenseDesc) {
        isCharge = true;
      } else {
        isCharge = group !== 'Income';
      }

      const isIncomeOrPayment = !isCharge;

      const tx: Transaction = {
        id: 'tx-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now(),
        date: isoDate,
        amount: Math.abs(amount),
        type: isIncomeOrPayment ? 'INCOME' : 'EXPENSE',
        incomeMonth: (isIncomeOrPayment && incomeNextMonth) ? this.service.getNextMonth(isoDate.slice(0, 7)) : undefined,
        description: cleanDesc,
        bank: effectiveBank,
        account: effectiveBank,
        paidBy: statementOwner || this.service.personOne().name,
        categoryGroup: group || 'Uncategorized',
        categoryItem: item || 'Uncategorized',
        splitType: defaultSplit,
        splitPercentage: 50,
        note: defaultNote || undefined,
        currency: bankCfg?.defaultCurrency || this.service.currency(),
        sourceFile: fileName,
        createdAt: new Date().toISOString()
      };

      const sig = this.service.getTransactionSignature(tx);

      if (this.service.isTransactionExcluded(cleanDesc, effectiveBank) || this.service.isSignatureExcluded(sig, tx)) {
        excluded.push(tx);
        continue;
      }

      const matchedDbTx = duplicateTracker.claim(tx);
      if (matchedDbTx) {
        this.service.restoreDeletedSignature(sig, tx);
        this.service.restoreExcludedSignature(sig, tx);
        if (matchedDbTx.categoryGroup) tx.categoryGroup = matchedDbTx.categoryGroup;
        if (matchedDbTx.categoryItem) tx.categoryItem = matchedDbTx.categoryItem;
        if (matchedDbTx.splitType) tx.splitType = matchedDbTx.splitType;
        if (matchedDbTx.splitMode) tx.splitMode = matchedDbTx.splitMode;
        if (matchedDbTx.splitPercentage !== undefined) tx.splitPercentage = matchedDbTx.splitPercentage;
        if (matchedDbTx.paidBy) tx.paidBy = matchedDbTx.paidBy;
        if (matchedDbTx.customSplitAmounts) tx.customSplitAmounts = { ...matchedDbTx.customSplitAmounts };
        if (matchedDbTx.note) tx.note = matchedDbTx.note;
        if (matchedDbTx.bank && !tx.bank) tx.bank = matchedDbTx.bank;
        tx.isDone = true;
        duplicates.push(tx);
        continue;
      }

      if (this.service.isSignatureDeleted(sig, tx)) {
        deleted.push(tx);
        continue;
      }

      if (isIncomeOrPayment) {
        incomes.push(tx);
      } else {
        transactions.push(tx);
      }
    }

    return {
      transactions,
      incomes,
      duplicates,
      excluded,
      deleted,
      incomesCount: incomes.length,
      duplicatesCount: duplicates.length,
      excludedCount: excluded.length,
      deletedCount: deleted.length,
      bankName: effectiveBank,
      totalParsed: transactions.length + incomes.length + duplicates.length + excluded.length + deleted.length
    };
  }

  private detectBank(selectedBank: string, fileName: string, text: string): string {
    if (selectedBank && selectedBank !== 'Generic Bank' && selectedBank !== 'Auto-Detect') return selectedBank;
    return '';
  }

  private detectColumnMapping(rows: string[][], bank: string): {
    dateIdx: number;
    descIdx: number;
    descIdx2?: number;
    amountIdx: number;
    debitIdx?: number;
    creditIdx?: number;
    currencyIdx?: number;
    sollHabenIdx?: number;
    hasHeader: boolean;
    headerRowIndex?: number;
  } {
    if (rows.length === 0) return { dateIdx: 0, descIdx: 1, amountIdx: 2, hasHeader: true };

    let bestHeaderRowIdx = 0;
    let maxHeaderScore = -1;

    for (let r = 0; r < Math.min(15, rows.length); r++) {
      const row = rows[r];
      if (!row || row.length < 2) continue;

      let score = 0;
      for (const cell of row) {
        const c = cell.toLowerCase().trim();
        if (!c) continue;
        if (c.includes('buchungstag') || c === 'datum' || c === 'date' || c === 'transaktion' || c.includes('started date') || c.includes('booking date') || c.includes('txn date') || c.includes('transaction date') || c.includes('value date')) score += 4;
        if (c.includes('betrag') || c === 'amount' || c.includes('umsatz') || c === 'soll' || c === 'haben' || c === 'summe' || c.includes('withdrawal') || c.includes('deposit') || c.includes('debit') || c.includes('credit')) score += 4;
        if (c.includes('begünstigter') || c.includes('beguenstigter') || c.includes('auftraggeber') || c.includes('verwendungszweck') || c.includes('buchungstext') || c.includes('description') || c.includes('händler') || c.includes('empfänger') || c.includes('payee') || c.includes('text') || c.includes('narration') || c.includes('particulars')) score += 4;
        if (c.includes('wertstellung') || c.includes('valuta') || c.includes('iban') || c.includes('bic') || c.includes('währung') || c.includes('currency') || c.includes('kundenreferenz') || c.includes('mandatsreferenz') || c.includes('chq') || c.includes('ref') || c.includes('info')) score += 2;
      }

      if (score > maxHeaderScore) {
        maxHeaderScore = score;
        bestHeaderRowIdx = r;
      }
    }

    const hasHeader = maxHeaderScore >= 4;
    const headerRowIdx = hasHeader ? bestHeaderRowIdx : 0;
    const header = rows[headerRowIdx].map((h) => h.toLowerCase().trim());
    const genericCurrencyIdx = header.findIndex(
      (h) => h.includes('currency') || h.includes('währung') || h.includes('curr') || h.includes('devise')
    );

    const bankConfig = this.service.bankConfigs().find(
      (b) => b.name.toLowerCase() === bank.toLowerCase() || bank.toLowerCase().includes(b.name.toLowerCase())
    );

    let dateIdx = -1;
    let descIdx = -1;
    let descIdx2: number | undefined = undefined;
    let amountIdx = -1;
    let debitIdx: number | undefined = undefined;
    let creditIdx: number | undefined = undefined;
    let sollHabenIdx: number | undefined = undefined;
    let currencyIdx: number | undefined = genericCurrencyIdx >= 0 ? genericCurrencyIdx : undefined;

    if (bankConfig) {
      if (bankConfig.dateColName) {
        const aliases = bankConfig.dateColName.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
        dateIdx = header.findIndex((h) => aliases.some((a) => h.includes(a)));
      }
      if (bankConfig.descColName) {
        const aliases = bankConfig.descColName.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
        descIdx = header.findIndex((h) => aliases.some((a) => h.includes(a)));
      }
      if (bankConfig.descColName2) {
        const aliases = bankConfig.descColName2.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
        const d2 = header.findIndex((h) => aliases.some((a) => h.includes(a)));
        if (d2 >= 0 && d2 !== descIdx) descIdx2 = d2;
      }
      if (bankConfig.amountColName) {
        const aliases = bankConfig.amountColName.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
        amountIdx = header.findIndex((h) => aliases.some((a) => h.includes(a)));
      }
      if (bankConfig.currencyColName) {
        const aliases = bankConfig.currencyColName.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
        const cIdx = header.findIndex((h) => aliases.some((a) => h.includes(a)));
        if (cIdx >= 0) currencyIdx = cIdx;
      }
    }

    const dCol = header.findIndex(
      (h) =>
        h.includes('withdrawal') ||
        h.includes('debit amt') ||
        h.includes('debit amount') ||
        h === 'debit' ||
        h === 'dr'
    );
    if (dCol >= 0) debitIdx = dCol;

    const cCol = header.findIndex(
      (h) =>
        h.includes('deposit') ||
        h.includes('credit amt') ||
        h.includes('credit amount') ||
        h === 'credit' ||
        h === 'cr'
    );
    if (cCol >= 0) creditIdx = cCol;

    if (dateIdx === -1) {
      dateIdx = header.findIndex((h) => h.includes('buchungstag') || h.includes('started date') || h.includes('completed date') || h.includes('transaktion') || h === 'datum' || h === 'date' || h.includes('booking date') || h.includes('txn date') || h.includes('transaction date') || h.includes('value date') || h.includes('value dt') || h.includes('buchung'));
    }
    if (descIdx === -1) {
      descIdx = header.findIndex((h) => h.includes('begünstigter') || h.includes('beguenstigter') || h.includes('auftraggeber') || h.includes('empfänger') || h.includes('händler') || h.includes('payee') || h.includes('description') || h.includes('beschreibung') || h.includes('buchungstext') || h.includes('narration') || h.includes('particulars'));
    }
    if (descIdx === -1) {
      descIdx = header.findIndex((h) => h.includes('verwendungszweck') || h.includes('text') || h.includes('details'));
    }
    if (descIdx2 === undefined) {
      const secondaryDesc = header.findIndex((h, idx) => idx !== descIdx && (h.includes('verwendungszweck') || h.includes('auftraggeber') || h.includes('buchungstext') || h.includes('chq') || h.includes('ref') || h.includes('details') || h.includes('info')));
      if (secondaryDesc >= 0) descIdx2 = secondaryDesc;
    }
    if (amountIdx === -1 && debitIdx === undefined && creditIdx === undefined) {
      amountIdx = header.findIndex((h) => h.includes('betrag') || h === 'amount' || h.includes('umsatz') || h.includes('summe') || h.includes('soll') || h.includes('haben') || h.includes('wert'));
    }

    const shIdx = header.findIndex((h) => h.includes('soll/haben') || h === 's/h' || h === 'sh' || h.includes('haben/soll') || h === 'umsatzart');
    if (shIdx >= 0 && shIdx !== amountIdx) {
      sollHabenIdx = shIdx;
    }

    if (dateIdx === -1) dateIdx = 0;
    if (descIdx === -1) descIdx = Math.min(1, header.length - 1);
    if (amountIdx === -1 && debitIdx === undefined && creditIdx === undefined) amountIdx = header.length - 1;

    return {
      dateIdx,
      descIdx,
      descIdx2,
      amountIdx,
      debitIdx,
      creditIdx,
      sollHabenIdx,
      currencyIdx,
      hasHeader: true,
      headerRowIndex: headerRowIdx
    };
  }

  public normalizeDate(str: string): string | null {
    if (!str) return null;
    const clean = str.trim();

    const dmyMatch = clean.match(/^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})/);
    if (dmyMatch) {
      const dNum = parseInt(dmyMatch[1], 10);
      const mNum = parseInt(dmyMatch[2], 10);
      let yNum = parseInt(dmyMatch[3], 10);
      if (yNum < 100) yNum += 2000;

      if (dNum >= 1 && dNum <= 31 && mNum >= 1 && mNum <= 12 && yNum >= 2000 && yNum <= 2099) {
        const day = dNum.toString().padStart(2, '0');
        const month = mNum.toString().padStart(2, '0');
        return `${yNum}-${month}-${day}`;
      }
      return null;
    }

    const ymdMatch = clean.match(/^(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})/);
    if (ymdMatch) {
      const yNum = parseInt(ymdMatch[1], 10);
      const mNum = parseInt(ymdMatch[2], 10);
      const dNum = parseInt(ymdMatch[3], 10);
      if (dNum >= 1 && dNum <= 31 && mNum >= 1 && mNum <= 12 && yNum >= 2000 && yNum <= 2099) {
        const year = yNum.toString();
        const month = mNum.toString().padStart(2, '0');
        const day = dNum.toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      return null;
    }

    const engMatch = clean.match(/\b(?:(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})|(\d{1,2})(?:st|nd|rd|th)?\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?),?\s+(\d{4}))\b/i);
    if (engMatch) {
      const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const mStr = (engMatch[1] || engMatch[5]).toLowerCase().slice(0, 3);
      const mIdx = months.indexOf(mStr) + 1;
      const dNum = parseInt(engMatch[2] || engMatch[4], 10);
      const yNum = parseInt(engMatch[3] || engMatch[6], 10);
      if (mIdx >= 1 && dNum >= 1 && dNum <= 31 && yNum >= 2000 && yNum <= 2099) {
        return `${yNum}-${mIdx.toString().padStart(2, '0')}-${dNum.toString().padStart(2, '0')}`;
      }
    }

    return null;
  }

  public parseAmount(raw: string): number {
    if (!raw) return 0;
    let clean = raw.trim().replace(/[\u2010-\u2015\u2212]/g, '-');

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

  public normalizeMerchant(desc: string): string {
    if (!desc) return '';
    let clean = desc.toLowerCase();

    clean = clean.replace(/\*{3,}\d{2,6}/g, ' ');
    clean = clean.replace(/\b\d{2}[./\-]\d{2}(?:[./\-]\d{2,4})?\b/g, ' ');
    clean = clean.replace(/\b(?:de|lu|nl|fr|at|ch|gb|us)\d{6,}\b/g, ' ');
    clean = clean.replace(/\b(?:ref|auftrag|kdnr|mandat|kauf|kartenzahlung|lastschrift|end-to-end)\b[:\s#0-9a-z]*/g, ' ');
    clean = clean.replace(/\b(gmbh|ag|kg|ug|co\.?\s*kg|se|sarl|sa|ltd|inc|bv|plc|e\.?\s*k\.?)\b/g, ' ');
    clean = clean.replace(/\b(deutschland|germany|frankfurt|berlin|muenchen|münchen|hamburg|stuttgart|kornwestheim|ludwigsburg|duesseldorf|düsseldorf|koeln|köln)\b/g, ' ');
    clean = clean.replace(/\b[a-z]?\d+[a-z]?\b/g, ' ');
    clean = clean.replace(/[^a-z0-9äöüß\s]/g, ' ').replace(/\s+/g, ' ').trim();
    return clean;
  }

  public matchCategory(
    desc: string,
    bank?: string
  ): { group?: string; item?: string; defaultSplit?: SplitType; incomeNextMonth?: boolean; defaultNote?: string } {
    if (!desc) return {};
    const rawLower = desc.toLowerCase();
    const bankLower = (bank || '').toLowerCase();
    const normDesc = this.normalizeMerchant(desc);

    for (const rule of this.service.rules()) {
      const ruleBank = (rule.bank || 'All').toLowerCase();
      const matchesBank = ruleBank === 'all' || !bankLower || bankLower.includes(ruleBank) || ruleBank.includes(bankLower);
      if (matchesBank && rule.keyword) {
        const kw = rule.keyword.toLowerCase().trim();
        if (rawLower.includes(kw) || normDesc.includes(kw)) {
          return {
            group: rule.categoryGroup,
            item: rule.categoryItem,
            defaultSplit: rule.splitType || 'SPLIT',
            incomeNextMonth: rule.incomeNextMonth,
            defaultNote: rule.defaultNote
          };
        }
      }
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
