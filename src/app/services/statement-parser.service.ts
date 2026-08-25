import { Injectable, inject } from '@angular/core';
import * as XLSX from 'xlsx';
import { TransactionService } from './transaction.service';
import { Transaction, SplitType } from '../models';

export interface ParsedStatementResult {
  transactions: Transaction[];
  incomes: Transaction[];
  duplicates: Transaction[];
  excluded: Transaction[];
  incomesCount: number;
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

    try {
      let pdfLib = (window as any).pdfjsLib;
      if (!pdfLib) {
        // Wait briefly or dynamically import if not yet loaded on window
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
          
          // Sort items by Y (top to bottom) with 3.5px line tolerance, then X (left to right)
          const items = (textContent.items as any[]).map((item) => ({
            str: item.str || '',
            x: item.transform ? item.transform[4] : 0,
            y: item.transform ? item.transform[5] : 0
          }));

          items.sort((a, b) => {
            if (Math.abs(a.y - b.y) <= 3.5) {
              return a.x - b.x; // same line: left to right
            }
            return b.y - a.y; // top to bottom
          });

          let lastY: number | undefined;
          let pageText = '';

          for (const item of items) {
            if (lastY !== undefined && Math.abs(item.y - lastY) > 3.5) {
              pageText += '\n';
            } else if (pageText.length > 0 && !pageText.endsWith(' ') && !pageText.endsWith('\n')) {
              pageText += ' ';
            }
            pageText += item.str;
            lastY = item.y;
          }

          fullText += '\n' + pageText;
        }
        console.log(`[StatementParser] Parsed ${pdf.numPages} PDF pages with Y/X coordinate sorting.`);
      }
    } catch (e) {
      console.warn('[StatementParser] pdfjsLib runtime parse failed:', e);
    }

    // Fallback: extract plain text / stream text from raw PDF bytes
    if (!fullText.trim()) {
      console.log('[StatementParser] Using raw PDF byte extractor fallback.');
      fullText = this.extractRawPdfText(new Uint8Array(arrayBuffer));
    }

    console.log('[StatementParser] === Extracted Multi-page PDF Text ===\n' + fullText);

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
      return { transactions: [], incomes: [], duplicates: [], excluded: [], incomesCount: 0, duplicatesCount: 0, excludedCount: 0, bankName, totalParsed: 0 };
    }

    const detectedBank = this.detectBank(bankName, fileName, text);
    const delimiter = this.detectDelimiter(text);
    const parsedRows = lines.map((line) => this.parseCsvLine(line, delimiter));

    const mapping = customMappings || this.detectColumnMapping(parsedRows, detectedBank);
    
    // Check if bank has explicit invertAmountSign config or auto-detect credit card inversion
    const bankCfg = this.service.bankConfigs().find((b) => b.name.toLowerCase() === detectedBank.toLowerCase());
    let invertSigns = bankCfg?.invertAmountSign ?? false;

    const startIdx = mapping.hasHeader ? (mapping.headerRowIndex !== undefined ? mapping.headerRowIndex + 1 : 1) : 0;

    // Smart Heuristic: Only for credit cards where charges are positive and repayments negative
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

    // Count occurrences already in Database (never flag intra-statement rows as duplicate)
    const dbSigCounts = new Map<string, number>();
    for (const t of this.service.transactions()) {
      const sig = this.service.getTransactionSignature(t);
      dbSigCounts.set(sig, (dbSigCounts.get(sig) || 0) + 1);
    }

    const transactions: Transaction[] = [];
    const incomes: Transaction[] = [];
    const duplicates: Transaction[] = [];
    const excluded: Transaction[] = [];

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

      const rawAmt = mapping.amountIdx >= 0 ? (row[mapping.amountIdx] || '').trim() : '0';
      let amount = this.parseAmount(rawAmt);

      // If separate Soll/Haben column exists (e.g. S = Soll / Debit, H = Haben / Credit)
      if (mapping.sollHabenIdx !== undefined && mapping.sollHabenIdx >= 0 && row[mapping.sollHabenIdx]) {
        const sh = row[mapping.sollHabenIdx].trim().toLowerCase();
        if (sh === 's' || sh === 'soll' || sh === 'd' || sh === 'debit' || sh === 'belastung') {
          amount = -Math.abs(amount);
        } else if (sh === 'h' || sh === 'haben' || sh === 'c' || sh === 'credit' || sh === 'gutschrift') {
          amount = Math.abs(amount);
        }
      }

      if (amount === 0) continue;

      const cleanDesc = this.service.fixMojibake(desc.replace(/\s+/g, ' ').trim());
      const { group, item, defaultSplit } = this.matchCategory(cleanDesc, detectedBank);

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

      // If invertSigns is true (+ is charge/expense, - is payment/credit)
      const isCharge = invertSigns ? amount > 0 : amount < 0;
      const isIncomeOrPayment = !isCharge;

      const tx: Transaction = {
        id: 'tx-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now(),
        date: isoDate,
        amount: finalAmount,
        type: isIncomeOrPayment ? 'INCOME' : 'EXPENSE',
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
        rawDate: dateStr.trim(),
        createdAt: new Date().toISOString()
      };

      // 1. Check Bank Exclusion Rules (e.g. Daily Interest, Internal Transfers)
      const fullRowText = (cleanDesc + ' ' + (row[0] || '') + ' ' + (row[1] || '')).trim();
      if (this.service.isTransactionExcluded(fullRowText, detectedBank)) {
        excluded.push(tx);
        continue;
      }

      // 2. Check Duplicates against Database only
      const sig = this.service.getTransactionSignature(tx);
      const dbCount = dbSigCounts.get(sig) || 0;
      if (dbCount > 0) {
        duplicates.push(tx);
        dbSigCounts.set(sig, dbCount - 1);
      } else if (isIncomeOrPayment) {
        incomes.push(tx);
      } else {
        transactions.push(tx);
      }
    }

    transactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    incomes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    duplicates.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    excluded.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    return {
      transactions,
      incomes,
      duplicates,
      excluded,
      incomesCount: incomes.length,
      duplicatesCount: duplicates.length,
      excludedCount: excluded.length,
      bankName: detectedBank,
      totalParsed: transactions.length + incomes.length + duplicates.length + excluded.length
    };
  }

  public cleanTransactionDescription(raw: string): string {
    if (!raw) return '';
    let clean = raw;

    // 1. Remove common noise IDs, references, IBANs, BICs
    clean = clean.replace(/\b(?:IBAN|BIC|EREF|MREF|CRED|KREF|KUNDENREFERENZ|MANDATSREFERENZ|GLÄUBIGER-ID|GLAEUBIGER-ID|END-TO-END-REF)[.:]?\s*[A-Z0-9\-+/]+/gi, '');
    clean = clean.replace(/\b[A-Z]{2}\d{2}\s*(?:[A-Z0-9]{4}\s*){3,7}[A-Z0-9]{1,4}\b/g, ''); // Raw IBAN pattern
    clean = clean.replace(/\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g, ''); // Raw BIC pattern

    // 2. Remove terminal, card numbers, timestamps, and valuta tags
    clean = clean.replace(/\b(?:TERMINAL|TA-NR|TERMID|T-ID)[.:]?\s*\d+/gi, '');
    clean = clean.replace(/\*{3,}\d{2,6}/g, '');
    clean = clean.replace(/\b\d{2}:\d{2}(?::\d{2})?\b/g, '');
    clean = clean.replace(/\bVALUTA\s*\d{1,2}[./\-]\d{1,2}(?:[./\-]\d{2,4})?/gi, '');

    // 3. Remove standard transaction method labels if merchant text exists
    const withoutMethod = clean.replace(
      /\b(SEPA-(?:Basis)?Lastschrift|Lastschrift|Direct debit|SEPA direct debit|SEPA-(?:Credit )?Transfer|Überweisung|Credit transfer|Kartenzahlung|Kartenverfügung|Card payment|Debit card payment|Girocard|Dauerauftrag|Standing order|Gutschrift|Gutschrift\s*Arbeitgeber|Auszahlung|Withdrawal)\b/gi,
      ''
    ).trim();

    if (withoutMethod.length > 2 && /[a-zA-Z0-9]/.test(withoutMethod)) {
      clean = withoutMethod;
    }

    // 4. Strip any trailing disclaimer notes / footer text
    clean = clean.split(/\b(?:important notes|please raise any objections|interest rate|rate \d+\s*%|cheques,? bills of exchange|closing balance|new balance|neuer kontostand|rechnungsabschluss|saldenbestätigung|deposit guarantee|einlagensicherung|information on deposit|gesetzliche einlagensicherung|hinweise zur rechnungslegung|allgemeine geschäftsbedingungen|disclaimer)\b/i)[0];

    // 5. Remove leading/trailing symbols and compress whitespace
    clean = clean.replace(/^[-–—:,./\s]+|[-–—:,./\s]+$/g, '').replace(/\s+/g, ' ').trim();
    return this.service.fixMojibake(clean);
  }

  private extractTransactionsFromPdfText(
    text: string,
    bankName: string,
    defaultOwner: string,
    fileName: string
  ): ParsedStatementResult {
    console.log('[StatementParser] === Processing PDF text for bank:', bankName, '===');
    const transactions: Transaction[] = [];
    const incomes: Transaction[] = [];
    const duplicates: Transaction[] = [];
    const excluded: Transaction[] = [];
    const detectedBank = this.detectBank(bankName, fileName, text);
    
    // Count occurrences already in Database
    const dbSigCounts = new Map<string, number>();
    for (const t of this.service.transactions()) {
      const sig = this.service.getTransactionSignature(t);
      dbSigCounts.set(sig, (dbSigCounts.get(sig) || 0) + 1);
    }

    const bankCfg = this.service.bankConfigs().find((b) => b.name.toLowerCase() === detectedBank.toLowerCase());
    let invertSigns = bankCfg?.invertAmountSign ?? false;

    // Detect statement year from text if dates are DD.MM.
    let fallbackYear = new Date().getFullYear().toString();
    const yearMatch = text.match(/\b(202\d)\b/);
    if (yearMatch) fallbackYear = yearMatch[1];
    console.log('[StatementParser] Detected bank:', detectedBank, 'Fallback Year:', fallbackYear);

    // Line-by-line processing
    const rawLines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    console.log(`[StatementParser] Total raw lines in PDF: ${rawLines.length}`);

    // Strictly bounded date pattern: Day 01-31, Month 01-12, optional Year 2000-2099
    const strictDatePattern = '(?:0[1-9]|[12]\\d|3[01]|[1-9])[./\\-](?:0[1-9]|1[0-2]|[1-9])(?:[./\\-](?:20\\d{2}|\\d{2}))?';
    const startWithDateRegex = new RegExp(`^(${strictDatePattern})\\b`, 'i');
    const amountTokenRegex = /([+\-]?\s*\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\s*[+\-SH]?)/g;

    // Group lines into transaction blocks starting with a Date line
    interface RawBlock {
      dateStr: string;
      lines: string[];
    }
    const blocks: RawBlock[] = [];
    let currentBlock: RawBlock | null = null;

    for (const line of rawLines) {
      // 1. If line marks the end of transactions / footer disclaimers, finalize currentBlock and stop appending
      if (
        /\b(important notes|please raise any objections|interest rate|rate \d+\s*%|cheques,? bills of exchange|closing balance|new balance|neuer kontostand|rechnungsabschluss|saldenbestätigung|deposit guarantee|einlagensicherung|information on deposit|gesetzliche einlagensicherung|hinweise zur rechnungslegung|allgemeine geschäftsbedingungen|disclaimer)\b/i.test(
          line
        )
      ) {
        if (currentBlock && currentBlock.lines.length > 0) {
          blocks.push(currentBlock);
          currentBlock = null;
        }
        console.log('[StatementParser] Reached statement footer disclaimer boundary:', line);
        continue;
      }

      // 2. Skip metadata / table headers / carry forwards across multi-page statements
      if (
        /\b(branch number|balance as at|opening balance|closing balance|old balance|new balance|alter kontostand|neuer kontostand|rechnungsabschluss|kontostand per|saldo per|page \d|seite \d|kontoauszug|booking\s+date|value\s+item|debit\s+credit|carry\s+forward|total\s+turnover)\b/i.test(
          line
        )
      ) {
        console.log('[StatementParser] Skipped metadata header line:', line);
        continue;
      }

      const dateMatch = line.match(startWithDateRegex);
      if (dateMatch) {
        if (currentBlock && currentBlock.lines.length > 0) {
          blocks.push(currentBlock);
        }
        currentBlock = { dateStr: dateMatch[1].trim(), lines: [line] };
      } else if (currentBlock) {
        currentBlock.lines.push(line);
      }
    }
    if (currentBlock && currentBlock.lines.length > 0) {
      blocks.push(currentBlock);
    }

    console.log(`[StatementParser] Grouped into ${blocks.length} transaction blocks.`);

    for (const block of blocks) {
      let rawDate = block.dateStr;
      if (/^\d{1,2}[./\-]\d{1,2}\.?$/.test(rawDate)) {
        rawDate = rawDate.replace(/\.$/, '') + '.' + fallbackYear;
      }
      const isoDate = this.normalizeDate(rawDate);
      if (!isoDate) {
        console.log('[StatementParser] Failed to normalize block date:', block.dateStr);
        continue;
      }

      const fullBlockText = block.lines.join(' ');

      // Find amounts in this block
      const amtMatches = Array.from(fullBlockText.matchAll(amountTokenRegex));
      if (amtMatches.length === 0) {
        console.log('[StatementParser] No amount token found in block:', fullBlockText);
        continue;
      }

      // Prefer amount token that has sign (+ / - / S / H) or the last valid amount
      let chosenAmtStr = amtMatches[amtMatches.length - 1][1].trim();
      for (const m of amtMatches) {
        const token = m[1].trim();
        if (token.includes('-') || token.includes('+') || token.endsWith('S') || token.endsWith('H')) {
          chosenAmtStr = token;
          break;
        }
      }

      let amount = this.parseAmount(chosenAmtStr);
      if (chosenAmtStr.endsWith('S') || chosenAmtStr.endsWith('-')) {
        amount = -Math.abs(amount);
      } else if (chosenAmtStr.endsWith('H') || chosenAmtStr.endsWith('+')) {
        amount = Math.abs(amount);
      }
      if (amount === 0) continue;

      // Clean description: remove dates, amount token, and currency symbols
      let descCandidate = fullBlockText;
      descCandidate = descCandidate.replace(new RegExp(strictDatePattern, 'g'), '');
      descCandidate = descCandidate.replace(chosenAmtStr, '');
      descCandidate = descCandidate.replace(/\b(?:EUR|€|USD|\$|GBP|£)\b/g, '');

      const cleanDesc = this.cleanTransactionDescription(descCandidate);
      if (!cleanDesc || cleanDesc.length < 2 || !/[a-zA-Z0-9]/.test(cleanDesc)) {
        console.log('[StatementParser] Rejected empty/invalid description from block:', fullBlockText);
        continue;
      }

      const { group, item, defaultSplit } = this.matchCategory(cleanDesc, detectedBank);

      // Check for explicit income vs expense keywords in block
      const isIncomeDesc =
        /\b(gehalt|salary|lohn|gutschrift|zinsgutschrift|bezüge|bezuege|credit\s+transfer\s+received|überweisung\s+erhalten|erstattung|rückzahlung)\b/i.test(
          cleanDesc
        ) ||
        /\b(gehalt|salary|lohn|gutschrift|zinsgutschrift|bezüge|bezuege)\b/i.test(fullBlockText);

      const isExpenseDesc =
        /\b(direct\s+debit|lastschrift|kartenzahlung|kartenverfügung|kartenabrechnung|card\s+payment|debit\s+card|girocard|auszahlung|bargeld|entgelt|gebühr|gebuehr|fee|standing\s+order|dauerauftrag)\b/i.test(
          fullBlockText
        );

      let isCharge = true;
      if (chosenAmtStr.includes('-') || chosenAmtStr.endsWith('S')) {
        isCharge = true;
      } else if (chosenAmtStr.includes('+') || chosenAmtStr.endsWith('H')) {
        isCharge = false;
      } else if (isIncomeDesc && !isExpenseDesc) {
        isCharge = false;
      } else if (isExpenseDesc) {
        isCharge = true;
      } else {
        // In bank PDF statements (Debit/Credit columns without negative signs), regular items are charges/expenses
        isCharge = group !== 'Income';
      }

      const isIncomeOrPayment = !isCharge;

      const tx: Transaction = {
        id: 'tx-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now(),
        date: isoDate,
        amount: Math.abs(amount),
        type: isIncomeOrPayment ? 'INCOME' : 'EXPENSE',
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
        console.log('[StatementParser] Excluded by rule:', cleanDesc);
        continue;
      }

      const sig = this.service.getTransactionSignature(tx);
      const dbCount = dbSigCounts.get(sig) || 0;
      if (dbCount > 0) {
        duplicates.push(tx);
        dbSigCounts.set(sig, dbCount - 1);
        console.log('[StatementParser] Duplicate found:', cleanDesc, tx.amount);
      } else if (isIncomeOrPayment) {
        incomes.push(tx);
        console.log('[StatementParser] Parsed Income/Payment:', cleanDesc, tx.amount);
      } else {
        transactions.push(tx);
        console.log('[StatementParser] Parsed Valid Expense:', cleanDesc, tx.amount);
      }
    }

    transactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    incomes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    duplicates.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    excluded.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    console.log(
      `[StatementParser] Result -> ${transactions.length} expenses, ${incomes.length} incomes, ${duplicates.length} duplicates, ${excluded.length} excluded.`
    );

    return {
      transactions,
      incomes,
      duplicates,
      excluded,
      incomesCount: incomes.length,
      duplicatesCount: duplicates.length,
      excludedCount: excluded.length,
      bankName: detectedBank,
      totalParsed: transactions.length + incomes.length + duplicates.length + excluded.length
    };
  }

  private detectBank(selectedBank: string, fileName: string, text: string): string {
    const combined = (selectedBank + ' ' + fileName + ' ' + text.slice(0, 1000)).toLowerCase();
    if (combined.includes('deutsche bank') || /\b(deutsche\s*bank|db\s*pbc|db\s*privat)\b/i.test(combined)) return 'Deutsche Bank';
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
    sollHabenIdx?: number;
    hasHeader: boolean;
    headerRowIndex?: number;
  } {
    if (rows.length === 0) return { dateIdx: 0, descIdx: 1, amountIdx: 2, hasHeader: true };

    // Find actual header row using scoring across all candidate rows in first 15 lines
    let bestHeaderRowIdx = 0;
    let maxHeaderScore = -1;

    for (let r = 0; r < Math.min(15, rows.length); r++) {
      const row = rows[r];
      if (!row || row.length < 2) continue;

      let score = 0;
      for (const cell of row) {
        const c = cell.toLowerCase().trim();
        if (!c) continue;
        if (c.includes('buchungstag') || c === 'datum' || c === 'date' || c === 'transaktion' || c.includes('started date') || c.includes('booking date')) score += 4;
        if (c.includes('betrag') || c === 'amount' || c.includes('umsatz') || c === 'soll' || c === 'haben' || c === 'summe') score += 4;
        if (c.includes('begünstigter') || c.includes('beguenstigter') || c.includes('auftraggeber') || c.includes('verwendungszweck') || c.includes('buchungstext') || c.includes('description') || c.includes('händler') || c.includes('empfänger') || c.includes('payee') || c.includes('text')) score += 4;
        if (c.includes('wertstellung') || c.includes('valuta') || c.includes('iban') || c.includes('bic') || c.includes('währung') || c.includes('currency') || c.includes('kundenreferenz') || c.includes('mandatsreferenz') || c.includes('info')) score += 2;
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

    // Look up bank from exported / user-configured BankConfigs
    const bankConfig = this.service.bankConfigs().find(
      (b) => b.name.toLowerCase() === bank.toLowerCase() || bank.toLowerCase().includes(b.name.toLowerCase())
    );

    let dateIdx = -1;
    let descIdx = -1;
    let descIdx2: number | undefined = undefined;
    let amountIdx = -1;
    let sollHabenIdx: number | undefined = undefined;
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
      dateIdx = header.findIndex((h) => h.includes('buchungstag') || h.includes('started date') || h.includes('completed date') || h.includes('transaktion') || h === 'datum' || h === 'date' || h.includes('booking date') || h.includes('buchung'));
    }
    if (descIdx === -1) {
      descIdx = header.findIndex((h) => h.includes('begünstigter') || h.includes('beguenstigter') || h.includes('auftraggeber') || h.includes('empfänger') || h.includes('händler') || h.includes('payee') || h.includes('description') || h.includes('beschreibung') || h.includes('buchungstext'));
    }
    if (descIdx === -1) {
      descIdx = header.findIndex((h) => h.includes('verwendungszweck') || h.includes('text') || h.includes('details'));
    }
    if (descIdx2 === undefined) {
      const secondaryDesc = header.findIndex((h, idx) => idx !== descIdx && (h.includes('verwendungszweck') || h.includes('auftraggeber') || h.includes('buchungstext') || h.includes('details') || h.includes('info')));
      if (secondaryDesc >= 0) descIdx2 = secondaryDesc;
    }
    if (amountIdx === -1) {
      amountIdx = header.findIndex((h) => h.includes('betrag') || h === 'amount' || h.includes('umsatz') || h.includes('summe') || h.includes('soll') || h.includes('haben') || h.includes('wert'));
    }

    // Detect Soll/Haben column if separate
    const shIdx = header.findIndex((h) => h.includes('soll/haben') || h === 's/h' || h === 'sh' || h.includes('haben/soll') || h === 'umsatzart');
    if (shIdx >= 0 && shIdx !== amountIdx) {
      sollHabenIdx = shIdx;
    }

    if (dateIdx === -1) dateIdx = 0;
    if (descIdx === -1) descIdx = Math.min(1, header.length - 1);
    if (amountIdx === -1) amountIdx = header.length - 1;

    return {
      dateIdx,
      descIdx,
      descIdx2,
      amountIdx,
      sollHabenIdx,
      currencyIdx,
      hasHeader: true,
      headerRowIndex: headerRowIdx
    };
  }

  public normalizeDate(str: string): string | null {
    if (!str) return null;
    const clean = str.trim();

    // 1. DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
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

    // 2. YYYY-MM-DD or YYYY.MM.DD
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

    // 3. English Month formats: "28 Feb 2026", "28 February 2026", "Feb 28, 2026", "February 28, 2026"
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

  /**
   * Cleans messy bank description strings to isolate core merchant name/tokens
   * (e.g. "DM-DROGERIE MARKT D1A4 KORNWESTHEIM DE" -> "dm drogerie markt")
   */
  public normalizeMerchant(desc: string): string {
    if (!desc) return '';
    let clean = desc.toLowerCase();

    // Strip masked cards, transaction references, dates, and order numbers
    clean = clean.replace(/\*{3,}\d{2,6}/g, ' ');
    clean = clean.replace(/\b\d{2}[./\-]\d{2}(?:[./\-]\d{2,4})?\b/g, ' ');
    clean = clean.replace(/\b(?:de|lu|nl|fr|at|ch|gb|us)\d{6,}\b/g, ' ');
    clean = clean.replace(/\b(?:ref|auftrag|kdnr|mandat|kauf|kartenzahlung|lastschrift|end-to-end)\b[:\s#0-9a-z]*/g, ' ');

    // Strip common company legal forms and location suffixes
    clean = clean.replace(/\b(gmbh|ag|kg|ug|co\.?\s*kg|se|sarl|sa|ltd|inc|bv|plc|e\.?\s*k\.?)\b/g, ' ');
    clean = clean.replace(/\b(deutschland|germany|frankfurt|berlin|muenchen|münchen|hamburg|stuttgart|kornwestheim|ludwigsburg|duesseldorf|düsseldorf|koeln|köln)\b/g, ' ');

    // Strip store codes, terminal numbers (e.g. "337", "D1A4", "0451")
    clean = clean.replace(/\b[a-z]?\d+[a-z]?\b/g, ' ');

    // Replace non-alphanumeric (except spaces) and collapse whitespace
    clean = clean.replace(/[^a-z0-9äöüß\s]/g, ' ').replace(/\s+/g, ' ').trim();
    return clean;
  }

  public matchCategory(
    desc: string,
    bank?: string
  ): { group?: string; item?: string; defaultSplit?: SplitType; defaultOwner?: string } {
    if (!desc) return {};
    const rawLower = desc.toLowerCase();
    const bankLower = (bank || '').toLowerCase();
    const normDesc = this.normalizeMerchant(desc);

    // =========================================================================
    // LAYER 1: Explicit User-Configured Rules (highest priority)
    // =========================================================================
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
            defaultOwner: rule.paidBy
          };
        }
      }
    }

    // =========================================================================
    // LAYER 2: Historical Ledger Learning (Learns from user's past categorized transactions)
    // =========================================================================
    const pastTransactions = this.service.transactions();
    if (pastTransactions.length > 0) {
      // 2a. Exact normalized description match from past records
      for (const t of pastTransactions) {
        if (t.categoryItem && t.categoryItem !== 'Uncategorized') {
          const pastRaw = (t.description || '').toLowerCase();
          const pastNorm = this.normalizeMerchant(t.description || '');

          if (pastNorm && normDesc && (pastNorm === normDesc || rawLower === pastRaw)) {
            return {
              group: t.categoryGroup,
              item: t.categoryItem,
              defaultSplit: t.splitType || 'SPLIT',
              defaultOwner: t.paidBy
            };
          }
        }
      }

      // 2b. Strong merchant token prefix / keyword match in history (tokens >= 4 chars)
      const currentTokens = normDesc.split(/\s+/).filter((t) => t.length >= 4);
      if (currentTokens.length > 0) {
        for (const t of pastTransactions) {
          if (t.categoryItem && t.categoryItem !== 'Uncategorized') {
            const pastNorm = this.normalizeMerchant(t.description || '');
            const matchingToken = currentTokens.find((tok) => pastNorm.includes(tok));
            if (matchingToken) {
              return {
                group: t.categoryGroup,
                item: t.categoryItem,
                defaultSplit: t.splitType || 'SPLIT',
                defaultOwner: t.paidBy
              };
            }
          }
        }
      }
    }

    // =========================================================================
    // LAYER 3: Comprehensive Built-in Local Offline Dictionary
    // =========================================================================
    const d = rawLower + ' ' + normDesc;

    // 1. Groceries (Housing -> Groceries, Split 50/50)
    if (
      /\b(rewe|edeka|aldi|lidl|kaufland|penny|netto|alnatura|denns|tegut|trader\s*joe|hit\s*markt|supermarkt|lebensmittel|biomarkt|asia\s*markt|nahkauf|norma|willy\s*s)\b/i.test(d)
    ) {
      return { group: 'Housing', item: 'Groceries', defaultSplit: 'SPLIT' };
    }

    // 2. Food and Chill / Dining / Bakeries / Takeaway (Food -> Food and Chill, Split 50/50)
    if (
      /\b(backwerk|mcdonald|burger\s*king|subway|starbucks|kfc|pizza|pizzeria|sushi|bäckerei|baeckerei|bakery|restaurant|ristorante|bistro|cafe|café|bar|espresso|döner|doener|kebab|lieferando|uber\s*eats|wolt|domino|vapiano|dean\s*&\s*david|cinemaxx|kino|hans\s*im\s*glueck|five\s*guys|l_osteria|osteria)\b/i.test(d)
    ) {
      return { group: 'Food', item: 'Food and Chill', defaultSplit: 'SPLIT' };
    }

    // 3. Parking and Tolls (Car and Transportation -> Parking and Tolls, Split 50/50)
    if (
      /\b(paybyphone|easypark|parken|parkhaus|parkplatz|apcoa|contipark|q-park|ampido|parkopedia|maut|vignette|asfinag)\b/i.test(d)
    ) {
      return { group: 'Car and Transportation', item: 'Parking and Tolls', defaultSplit: 'SPLIT' };
    }

    // 4. EV Charging (Car and Transportation -> Charging, Split 50/50)
    if (
      /\b(ionity|enbw\s*mobility|supercharger|tesla\s*charging|fastned|allego|chargemap|e-charge|e\s*charge|ladestation|mobilityplus|maingau)\b/i.test(d)
    ) {
      return { group: 'Car and Transportation', item: 'Charging', defaultSplit: 'SPLIT' };
    }

    // 5. Fuel & Car Maintenance (Car and Transportation -> Maintenance, Split 50/50)
    if (
      /\b(shell|aral|esso|total\s*energies|total\s*tankstelle|jet\s*tankstelle|omv|avia|hem\s*tankstelle|tankstelle|tüv|dekra|autowerkstatt|atu|pitstop|carglass)\b/i.test(d)
    ) {
      return { group: 'Car and Transportation', item: 'Maintenance', defaultSplit: 'SPLIT' };
    }

    // 6. Attire and Personal Care (Lifestyle -> Attire and Personal Care, Default Owner / Self)
    if (
      /\b(dm-drogerie|dm\s*drogerie|rossmann|müller\s*drogerie|mueller\s*drogerie|sephora|douglas|zara|h&m|h\s*m|uniqlo|zalando|asos|c&a|peek\s*&\s*cloppenburg|breuninger|snipes|foot\s*locker|friseur|barber|hair|kosmetik|parfuemerie)\b/i.test(d)
    ) {
      return { group: 'Lifestyle', item: 'Attire and Personal Care', defaultSplit: 'SELF' };
    }

    // 7. Trips & Travel (Lifestyle -> Trips & Travel, Split 50/50)
    if (
      /\b(deutsche\s*bahn|db\s*fahrkarten|bahn\.de|lufthansa|ryanair|easyjet|eurowings|booking\.com|airbnb|flixbus|uber\s*trip|bolt\.eu|free\s*now|taxi|hotel|hostel|expedia|agoda|ferry)\b/i.test(d)
    ) {
      return { group: 'Lifestyle', item: 'Trips & Travel', defaultSplit: 'SPLIT' };
    }

    // 8. Rent & Utilities (Housing -> Rent and Utilities, Split 50/50)
    if (
      /\b(miete|rent|stadtwerke|vattenfall|eon|e\.on|strom|gas|wasser|fernwaerme|rundfunk|gezon|beitragsservice|telekom|vodafone|o2|1&1|unitymedia)\b/i.test(d)
    ) {
      return { group: 'Housing', item: 'Rent and Utilities', defaultSplit: 'SPLIT' };
    }

    // 9. Gadgets and Tech Tools (Lifestyle -> Gadgets and Tech Tools, Self)
    if (
      /\b(apple\.com|apple\s*store|itunes|google\s*play|google\s*storage|google\s*workspace|microsoft|saturn|mediamarkt|cyberport|notebooksbilliger|github|chatgpt|openai|anthropic|claude|cursor\.com|jetbrains|adobe|steam|playstation|nintendo)\b/i.test(d)
    ) {
      return { group: 'Lifestyle', item: 'Gadgets and Tech Tools', defaultSplit: 'SELF' };
    }

    // 10. Home Items & DIY (Housing -> Home Items, Split 50/50)
    if (
      /\b(ikea|bauhaus|hornbach|obi|toom|leroy\s*merlin|möbel|moebel|xxxlutz|poco|action|tedi|butlers|zarahome|depot|h&m\s*home|maisons\s*du\s*monde)\b/i.test(d)
    ) {
      return { group: 'Housing', item: 'Home Items', defaultSplit: 'SPLIT' };
    }

    // 11. Medical & Pharmacy (Medical -> Medical, Self)
    if (
      /\b(apotheke|pharmacy|docmorris|shop-apotheke|arzt|doctor|zahnarzt|dentist|praxis|doctolib|klinikum|hospital|labor|optiker|fielmann|misterspex)\b/i.test(d)
    ) {
      return { group: 'Medical', item: 'Medical', defaultSplit: 'SELF' };
    }

    // 12. Gym & Health Apps (Lifestyle -> Gym / Sports & Health Apps, Self)
    if (
      /\b(fitx|mcfit|fitness\s*first|clever\s*fit|john\s*reed|urban\s*sports|gym|fitnessstudio|strava|garmin|whoop|zwift|komoot|headspace|calm)\b/i.test(d)
    ) {
      return { group: 'Lifestyle', item: 'Gym', defaultSplit: 'SELF' };
    }

    // 13. Mobile Phone Plans (Lifestyle -> Mobile Phone Plans, Self)
    if (
      /\b(fraenk|congstar|alditalk|aldi\s*talk|winsim|simon\s*mobile|freenet|klarmobil|drillisch|lebara|lycamobile)\b/i.test(d)
    ) {
      return { group: 'Lifestyle', item: 'Mobile Phone Plans', defaultSplit: 'SELF' };
    }

    // 14. Reimbursements / Expensed Items / Loans (Lifestyle -> Reimbursements, Self)
    if (
      /\b(auslage|auslagen|spesen|spesenabrechnung|reimbursement|reimbursable|erstattung|rueckerstattung|rückerstattung)\b/i.test(d)
    ) {
      return { group: 'Lifestyle', item: 'Reimbursements', defaultSplit: 'SELF' };
    }

    // 15. Salary / Income (Income -> Salary)
    if (
      /\b(enpal|bosch|gehalt|salary|lohn|bezüge|bezuege|arbeitsentgelt|gutschrift\s*arbeitgeber)\b/i.test(d)
    ) {
      const p1 = this.service.personOne().name;
      const p2 = this.service.personTwo().name;
      const defaultOwner = d.includes('bosch') ? p2 : p1;
      return { group: 'Income', item: 'Salary', defaultSplit: 'SELF', defaultOwner };
    }

    // =========================================================================
    // LAYER 4: Match against existing configured Category Item names
    // =========================================================================
    for (const grp of this.service.categoryGroups()) {
      for (const item of grp.items) {
        const iname = item.name.toLowerCase();
        const cleanItemName = iname.replace(/\[.*?\]/g, '').trim();

        if (cleanItemName && cleanItemName.length > 3 && d.includes(cleanItemName)) {
          let defaultSplit: SplitType = 'SELF';
          if (
            grp.name === 'Housing' ||
            grp.name === 'Car and Transportation' ||
            grp.name === 'Food' ||
            iname.includes('split') ||
            iname.includes('groceries') ||
            iname.includes('utilities') ||
            iname.includes('rent') ||
            iname.includes('parking')
          ) {
            defaultSplit = 'SPLIT';
          }
          return {
            group: grp.name,
            item: item.name,
            defaultSplit,
            defaultOwner: item.defaultOwner
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
