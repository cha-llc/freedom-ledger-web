/**
 * statementParserService (web) — turns an uploaded PDF/image into ParsedTransaction[].
 *
 * REAL pipeline (no mock), identical logic to mobile:
 *   parseStatementFile(upload)
 *     → statementExtractionService.extract()  [PDF text layer or OCR]
 *     → parseStatementText()                   [real line parsing]
 *     → map RawParsedRow → ParsedTransaction (confidence + category guess)
 *
 * Throws StatementParseError (status + user-facing message) on failure. Never
 * returns fabricated rows.
 */

import type { Transaction, TransactionType } from './models';
import { uid, todayISO } from './format';
import { parseStatementText, type RawParsedRow } from './statementTextParser';
import {
  statementExtractionService,
  type ExtractionStatus,
  type WebUploadedFile,
} from './statementExtractionService';

export class StatementParseError extends Error {
  constructor(public status: ExtractionStatus, message: string) {
    super(message);
    this.name = 'StatementParseError';
  }
}

export interface ParsedTransaction {
  id: string;
  date: string;
  description: string;
  merchant?: string;
  amount: number;
  type: TransactionType;
  category: string;
  ocrConfidence: number;
  parsingConfidence: number;
  isDuplicateCandidate: boolean;
  sourceFileName: string;
}

export interface DuplicateCandidate {
  parsedId: string;
  existingId: string;
  reason: string;
}

const LOW_CONF_THRESHOLD = 0.6;

function guessCategory(desc: string, type: TransactionType): string {
  if (type === 'income') return 'Job Paycheck';
  if (type === 'transfer') return 'Personal Transfer';
  const d = desc.toLowerCase();
  const rules: [RegExp, string][] = [
    [/super|market|grocer|mercado|whole foods|walmart|aldi|kroger|automercado|mercadona/, 'Food / Groceries'],
    [/uber|lyft|cabify|didi|rideshare|taxi/, 'Uber / Rideshare'],
    [/restaurant|cafe|coffee|starbucks|mcdonald|burger|pizza|soda|bar /, 'Restaurants / Eating Out'],
    [/netflix|spotify|hbo|disney|prime video|youtube premium|subscription|patreon/, 'Subscriptions'],
    [/pharmac|farmacia|cvs|walgreens|clinic|hospital|doctor|dental/, 'Medication / Health'],
    [/uber eats|rappi|doordash|grubhub|delivery/, 'Restaurants / Eating Out'],
    [/gas|fuel|shell|chevron|petro|combustible/, 'Transportation'],
    [/rent|alquiler|landlord|mortgage/, 'Rent / Housing'],
    [/phone|movil|claro|kolbi|at&t|verizon|t-mobile|internet|wifi|cable/, 'Phone / Internet'],
    [/airline|flight|vuelo|avianca|delta|united|copa|aero/, 'Flights / Travel'],
    [/baggage|equipaje|checked bag/, 'Baggage / Airline Fees'],
    [/atm|cash withdrawal|retiro|cajero/, 'Cash Withdrawal'],
    [/fee|comision|comisión|charge|cargo|service charge/, 'Bank Fees'],
    [/pet|vet|mascota|dog|cat/, 'Dogs / Pets'],
    [/salon|barber|spa|haircut|nails/, 'Personal Care'],
    [/laundry|lavanderia|cleaning|household/, 'Laundry / Household'],
  ];
  for (const [re, cat] of rules) if (re.test(d)) return cat;
  return 'Other';
}

function toParsedTransaction(row: RawParsedRow, fileName: string): ParsedTransaction {
  const category = guessCategory(row.description, row.type);
  return {
    id: uid('parsed_'),
    date: row.date,
    description: row.description,
    merchant: undefined,
    amount: row.amount,
    type: row.type,
    category,
    ocrConfidence: row.parsingConfidence,
    parsingConfidence: row.parsingConfidence,
    isDuplicateCandidate: false,
    sourceFileName: fileName,
  };
}

export const statementParserService = {
  async parseStatementFile(upload: WebUploadedFile): Promise<ParsedTransaction[]> {
    const extraction = await statementExtractionService.extract(upload);

    if (extraction.status !== 'ok') {
      throw new StatementParseError(
        extraction.status,
        extraction.message ?? "Couldn't read that statement.",
      );
    }

    const rows = parseStatementText(extraction.text, extraction.sourceQuality);
    if (rows.length === 0) {
      throw new StatementParseError(
        'empty',
        "We read the file but couldn't find any transactions in it. Make sure it's a statement with a list of dated transactions.",
      );
    }
    return rows.map((r) => toParsedTransaction(r, upload.file.name));
  },

  detectDuplicates(
    parsed: ParsedTransaction[],
    existing: Transaction[],
  ): DuplicateCandidate[] {
    const candidates: DuplicateCandidate[] = [];
    for (const p of parsed) {
      for (const e of existing) {
        const amtClose = Math.abs(Math.abs(p.amount) - Math.abs(e.amount)) <= 0.02;
        const dayClose = Math.abs(daysApart(p.date, e.date)) <= 3;
        const descClose =
          normalize(p.description).includes(normalize(e.description).slice(0, 6)) ||
          normalize(e.description).includes(normalize(p.description).slice(0, 6));
        if (amtClose && dayClose && descClose) {
          candidates.push({
            parsedId: p.id,
            existingId: e.id,
            reason: `Matches ${e.description} (${e.date})`,
          });
          break;
        }
      }
    }
    return candidates;
  },

  calculateConfidence(p: ParsedTransaction): number {
    return Math.round(((p.ocrConfidence + p.parsingConfidence) / 2) * 100) / 100;
  },

  isLowConfidence(p: ParsedTransaction): boolean {
    return this.calculateConfidence(p) < LOW_CONF_THRESHOLD;
  },

  toStagedTransactions(
    parsed: ParsedTransaction[],
    batchId: string,
    duplicates: DuplicateCandidate[],
  ): Transaction[] {
    const dupIds = new Set(duplicates.map((d) => d.parsedId));
    const now = todayISO();
    return parsed.map((p) => {
      const conf = this.calculateConfidence(p);
      const low = conf < LOW_CONF_THRESHOLD;
      return {
        id: uid('txn_'),
        date: p.date,
        description: p.description,
        merchant: p.merchant,
        amount: p.amount,
        type: p.type,
        category: low ? 'Needs Review' : p.category,
        sourceFileName: p.sourceFileName,
        importBatchId: batchId,
        ocrConfidence: p.ocrConfidence,
        parsingConfidence: p.parsingConfidence,
        isDuplicateCandidate: dupIds.has(p.id),
        createdAt: now,
        updatedAt: now,
      };
    });
  },
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function daysApart(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00').getTime();
  const db = new Date(b + 'T00:00:00').getTime();
  return Math.round((da - db) / (1000 * 60 * 60 * 24));
}
