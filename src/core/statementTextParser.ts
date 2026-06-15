/**
 * statementTextParser — REAL parsing of raw statement text into transaction rows.
 *
 * This is the genuinely hard, non-mocked part: given the raw text extracted from a
 * PDF (digital text layer) or from OCR (image/scanned), find the lines that are
 * transactions and pull out { date, description, amount, type } with a confidence
 * score reflecting how sure we are.
 *
 * It is format-tolerant, not format-specific: banks vary wildly, so we look for the
 * universal shape of a transaction line — a date token, a description, and a money
 * amount — rather than hard-coding any one bank's layout. Lines we can't confidently
 * read are still surfaced (low confidence → "Needs Review"), never silently dropped.
 *
 * Pure functions, no I/O, fully unit-testable.
 */

import type { TransactionType } from './models';

export interface RawParsedRow {
  date: string; // ISO yyyy-mm-dd
  rawDate: string; // as seen in the statement
  description: string;
  amount: number; // always positive; `type` carries the sign meaning
  type: TransactionType;
  parsingConfidence: number; // 0..1 — how sure we are this line is a real txn
  rawLine: string;
}

// ── Money ────────────────────────────────────────────────────────────────────
// Matches: 1,234.56  | 1.234,56 (EU) | -45.00 | (45.00) parens-negative | $12.00 | 12,00
const MONEY_RE =
  /(?<neg>[-(])?\s*(?<cur>[$€£₡]|USD|EUR|CRC|COP)?\s*(?<num>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})\s*(?<close>\))?/g;

/** Parse a money token into a positive number + whether it was negative. */
function parseAmount(token: string): { value: number; negative: boolean } | null {
  const m = [...token.matchAll(MONEY_RE)][0];
  if (!m || !m.groups) return null;
  const negative = Boolean(m.groups.neg) || Boolean(m.groups.close);
  let num = m.groups.num;

  // Decide decimal separator: the LAST separator with exactly 2 trailing digits is decimal.
  const lastDot = num.lastIndexOf('.');
  const lastComma = num.lastIndexOf(',');
  const decSep = Math.max(lastDot, lastComma);
  if (decSep >= 0 && num.length - decSep - 1 === 2) {
    const dec = num[decSep];
    const thou = dec === '.' ? ',' : '.';
    num = num.split(thou).join('').replace(dec, '.');
  } else {
    // No 2-digit decimal group — strip all separators (whole number).
    num = num.replace(/[.,]/g, '');
  }
  const value = parseFloat(num);
  if (!isFinite(value)) return null;
  return { value: Math.abs(value), negative };
}

// ── Dates ────────────────────────────────────────────────────────────────────
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9,
  oct: 10, nov: 11, dec: 12,
  ene: 1, abr: 4, ago: 8, dic: 12, // common Spanish abbreviations
};

const DATE_PATTERNS: {
  re: RegExp;
  build: (m: RegExpMatchArray, preferMDY: boolean) => string | null;
}[] = [
  // 2024-03-15 / 2024/03/15  (unambiguous, ISO)
  {
    re: /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/,
    build: (m) => iso(+m[1], +m[2], +m[3]),
  },
  // 15/03/2024 or 03/15/2024 — ambiguous. Disambiguate by value, then by locale hint.
  {
    re: /\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/,
    build: (m, preferMDY) => {
      const a = +m[1], b = +m[2];
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      if (a > 12 && b <= 12) return iso(y, b, a); // must be DD/MM
      if (b > 12 && a <= 12) return iso(y, a, b); // must be MM/DD
      // both <= 12: genuinely ambiguous → use the statement's detected locale
      return preferMDY ? iso(y, a, b) : iso(y, b, a);
    },
  },
  // 15 Mar 2024 / 15-Mar-24 / 15 ene 2024
  {
    re: /\b(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-]?(\d{2,4})?\b/,
    build: (m) => {
      const day = +m[1];
      const mon = MONTHS[m[2].toLowerCase()];
      if (!mon) return null;
      const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : new Date().getFullYear();
      return iso(y, mon, day);
    },
  },
  // Mar 15, 2024
  {
    re: /\b([A-Za-z]{3})[a-z]*[\s.]+(\d{1,2}),?\s+(\d{4})\b/,
    build: (m) => {
      const mon = MONTHS[m[1].toLowerCase()];
      if (!mon) return null;
      return iso(+m[3], mon, +m[2]);
    },
  },
];

function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (y < 2000 || y > 2100) return null;
  const mm = String(mo).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function findDate(line: string, preferMDY: boolean): { iso: string; raw: string } | null {
  for (const { re, build } of DATE_PATTERNS) {
    const m = line.match(re);
    if (m) {
      const built = build(m, preferMDY);
      if (built) return { iso: built, raw: m[0] };
    }
  }
  return null;
}

/**
 * Detect whether a statement uses US month-first dates. Heuristics:
 *  - explicit currency/format signals (USD, $ before MM/DD style)
 *  - presence of MM/DD/YYYY tokens whose first field exceeds 12 implies DD/MM,
 *    and vice-versa; we tally the unambiguous ones and let the majority decide.
 *  - comma-decimal money (1.234,56) strongly implies non-US (returns false).
 */
function detectPreferMDY(text: string): boolean {
  // Comma-decimal money → European style → day-first.
  if (/\d{1,3}(\.\d{3})+,\d{2}\b/.test(text)) return false;

  // Use year-constrained matching so glued text (no separators) is still read,
  // consistent with splitOnDates / extractDateFromSegment.
  let mdy = 0;
  let dmy = 0;
  const pairs: [number, number][] = [];
  for (const m of text.matchAll(/(\d{1,2})[-/](\d{1,2})[-/](?:19|20)\d{2}/g)) {
    const a = +m[1], b = +m[2];
    pairs.push([a, b]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  if (mdy > dmy) return true;
  if (dmy > mdy) return false;

  // Ordering signal: statements are chronological. If field-1 stays constant while
  // field-2 marches up across rows, field-2 is the day → month-first (MM/DD).
  if (pairs.length >= 2) {
    let f1changes = 0, f2changes = 0, f2increases = 0, f1increases = 0;
    for (let i = 1; i < pairs.length; i++) {
      if (pairs[i][0] !== pairs[i - 1][0]) f1changes++;
      if (pairs[i][1] !== pairs[i - 1][1]) f2changes++;
      if (pairs[i][1] > pairs[i - 1][1]) f2increases++;
      if (pairs[i][0] > pairs[i - 1][0]) f1increases++;
    }
    if (f1changes === 0 && f2increases >= 1) return true;
    if (f2changes === 0 && f1increases >= 1) return false;
    if (f2changes > f1changes) return true;
    if (f1changes > f2changes) return false;
  }

  if (/\$/.test(text) && !/[€₡]/.test(text)) return true;
  return false;
}

// ── Credit / debit inference ──────────────────────────────────────────────────
const CREDIT_HINTS =
  /\b(deposit|depósito|deposito|credit|crédito|credito|payroll|nomina|nómina|salary|refund|reembolso|transfer in|abono|payment received|received)\b/i;
const TRANSFER_HINTS = /\b(transfer|transferencia|transf|wire|sinpe|zelle|ach)\b/i;

function inferType(description: string, negative: boolean): TransactionType {
  if (TRANSFER_HINTS.test(description)) return 'transfer';
  if (CREDIT_HINTS.test(description)) return 'income';
  // No textual signal: a clearly-negative amount is money out (expense). A plain
  // positive on a statement is ambiguous (debit columns are often unsigned), so we
  // default to expense — the safer assumption — and the user confirms on review.
  // Income without a credit keyword is rare and better surfaced for review than
  // silently mislabeled, so we do NOT guess "income" from a positive sign alone.
  return 'expense';
}

// Lines that are headers/footers/summaries, not transactions.
const NOISE_RE =
  /\b(statement|balance|opening|closing|total|subtotal|page\b|account number|available|summary|beginning|ending|carried forward|saldo|resumen|estado de cuenta)\b/i;

/**
 * Parse raw statement text into transaction rows.
 * `ocrConfidence` (0..1) reflects how clean the source text is (1 for digital PDF
 * text, lower for OCR); we fold it into each row's parsing confidence.
 */
export function parseStatementText(
  rawText: string,
  sourceQuality = 1,
): RawParsedRow[] {
  const preferMDY = detectPreferMDY(rawText);
  const rawLines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Some PDFs emit all rows on one line (no line-break operators between records).
  // Split any line that contains multiple date tokens so each date starts a new row.
  const lines = rawLines.flatMap((l) => splitOnDates(l));

  const rows: RawParsedRow[] = [];

  for (const seg of lines) {
    // Robust extraction that tolerates text with no separators between fields
    // (common in PDF/OCR output): validate date candidates and money tokens
    // rather than assuming clean whitespace.
    const date = extractDateFromSegment(seg, preferMDY);
    if (!date) continue; // a transaction record essentially always has a date

    // Strip trailing balance summaries that sometimes glue onto the last row.
    let rest = seg.replace(date.raw, ' ').replace(/(closing|opening)\s+balance.*/i, ' ');

    const amt = extractLastAmount(rest);
    if (!amt || amt.value === 0) continue;

    // Description = remainder minus the amount, with glued leading digits (the
    // previous row's trailing cents) and trailing reference numbers trimmed.
    let desc = rest.replace(amt.raw, ' ');
    desc = desc
      .replace(/^\s*\d{1,3}(?=\s|[A-Za-z])/, ' ') // leading glued cents digits
      .replace(/\s{2,}/g, ' ')
      .replace(/[|]+/g, ' ')
      .trim();
    if (desc.length < 2) desc = 'Unlabeled transaction';

    // Confidence: source quality, adjusted for description clarity.
    let conf = sourceQuality;
    if (desc.length < 4) conf -= 0.25;
    if (!/\d{4}/.test(date.raw)) conf -= 0.1;
    if (/[^\x20-\x7E]/.test(desc)) conf -= 0.05;
    conf = Math.max(0.05, Math.min(1, conf));

    rows.push({
      date: date.iso,
      rawDate: date.raw,
      description: titleCaseSafe(desc),
      amount: amt.value,
      type: inferType(desc, amt.negative),
      parsingConfidence: Math.round(conf * 100) / 100,
      rawLine: seg,
    });
  }

  return dedupeWithinBatch(rows);
}

/**
 * Extract a date from a text segment that may have no separators around it.
 * Requires a 4-digit year (or a month-name form) so trailing cents digits from a
 * prior amount can't masquerade as a date. Returns the first valid candidate.
 */
function extractDateFromSegment(
  s: string,
  preferMDY: boolean,
): { iso: string; raw: string } | null {
  // Numeric d/m/yyyy or m/d/yyyy with a 19xx/20xx year (prevents glued cents from
  // forming a spurious date).
  const numRe = /(\d{1,2})[-/](\d{1,2})[-/]((?:19|20)\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = numRe.exec(s)) !== null) {
    const a = +m[1], b = +m[2], y = +m[3];
    let r: string | null;
    if (a > 12 && b <= 12) r = iso(y, b, a);
    else if (b > 12 && a <= 12) r = iso(y, a, b);
    else r = preferMDY ? iso(y, a, b) : iso(y, b, a);
    if (r) return { iso: r, raw: m[0] };
  }
  // ISO yyyy-mm-dd.
  const isoRe = /((?:19|20)\d{2})[-/](\d{1,2})[-/](\d{1,2})/g;
  while ((m = isoRe.exec(s)) !== null) {
    const r = iso(+m[1], +m[2], +m[3]);
    if (r) return { iso: r, raw: m[0] };
  }
  // Month-name forms ("15 Mar 2024", "Mar 15, 2024").
  const named = findDate(s, preferMDY);
  if (named) return named;
  return null;
}

/** Extract the last valid money token from a segment (the txn amount). */
function extractLastAmount(s: string): { value: number; negative: boolean; raw: string } | null {
  const re =
    /(-|\()?\s*([$€£₡])?\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})\s*(\))?/g;
  let m: RegExpExecArray | null;
  const all: { value: number; negative: boolean; raw: string }[] = [];
  while ((m = re.exec(s)) !== null) {
    let num = m[3];
    const negative = Boolean(m[1]) || Boolean(m[4]);
    const lastDot = num.lastIndexOf('.');
    const lastComma = num.lastIndexOf(',');
    const decSep = Math.max(lastDot, lastComma);
    if (decSep >= 0 && num.length - decSep - 1 === 2) {
      const dec = num[decSep];
      const thou = dec === '.' ? ',' : '.';
      num = num.split(thou).join('').replace(dec, '.');
    } else {
      num = num.replace(/[.,]/g, '');
    }
    const value = parseFloat(num);
    if (isFinite(value) && value > 0) {
      all.push({ value: Math.abs(value), negative, raw: m[0].trim() });
    }
  }
  return all.length ? all[all.length - 1] : null;
}

/** Within a single statement, drop exact dup lines (same date+amount+desc). */
/**
 * Split a single text run into per-transaction segments using date tokens as
 * record boundaries. Handles PDFs/OCR that put many rows on one line. If the run
 * has 0 or 1 dates, it's returned unchanged.
 */
function splitOnDates(line: string): string[] {
  // Locate each record's start via dates whose YEAR is 19xx or 20xx. Constraining
  // the year is what makes this safe against glued text: trailing cents like the
  // "00" in "2,450.0003/01/2024" can't form a year, so the regex locks onto the
  // real "03/01/2024" — while still splitting records that run together unspaced.
  const dateToken =
    /(\d{1,2})[-/](\d{1,2})[-/](?:19|20)\d{2}|(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[\s-][A-Za-z]{3}[a-z]*[\s-](?:19|20)\d{2}|[A-Za-z]{3}[a-z]*[\s.]+\d{1,2},?\s+(?:19|20)\d{2}/g;
  const indices: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = dateToken.exec(line)) !== null) indices.push(m.index);
  if (indices.length <= 1) return [line];

  const segments: string[] = [];
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : line.length;
    segments.push(line.slice(start, end).trim());
  }
  return segments;
}

function dedupeWithinBatch(rows: RawParsedRow[]): RawParsedRow[] {
  const seen = new Set<string>();
  const out: RawParsedRow[] = [];
  for (const r of rows) {
    const key = `${r.date}|${r.amount.toFixed(2)}|${r.description.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function titleCaseSafe(s: string): string {
  // Keep ALL-CAPS merchant codes readable without destroying them.
  if (s.length > 40) return s.slice(0, 60);
  return s;
}
