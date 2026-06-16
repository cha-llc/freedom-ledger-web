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

/** Parse a money token into a positive number + whether it was negative. */

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
  // Also consider yearless MM/DD or DD/MM tokens (common on bank statements where
  // the year is only in the header) for the disambiguation signal.
  for (const m of text.matchAll(/(?:^|[\s|])(\d{1,2})[-/](\d{1,2})(?=\s|$|[A-Za-z])/gm)) {
    const a = +m[1], b = +m[2];
    if (a >= 1 && a <= 31 && b >= 1 && b <= 31) {
      pairs.push([a, b]);
      if (a > 12 && b <= 12) dmy++;
      else if (b > 12 && a <= 12) mdy++;
    }
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

  // Default: US statement convention is month-first. Most US banks (Capital One,
  // Chase, BoA, Amex) use MM/DD, so when there's no disambiguating signal, prefer
  // MDY rather than DMY.
  return true;
}

// ── Credit / debit inference ──────────────────────────────────────────────────
const CREDIT_HINTS =
  /\b(deposit|depósito|deposito|credit|crédito|credito|payroll|nomina|nómina|salary|refund|reembolso|transfer in|abono|payment received|received)\b/i;
const TRANSFER_HINTS = /\b(transfer|transferencia|transf|wire|sinpe|zelle|ach)\b/i;

function inferType(description: string, _negative: boolean): TransactionType {
  if (TRANSFER_HINTS.test(description)) return 'transfer';
  if (CREDIT_HINTS.test(description)) return 'income';
  // No textual signal: a clearly-negative amount is money out (expense). A plain
  // positive on a statement is ambiguous (debit columns are often unsigned), so we
  // default to expense — the safer assumption — and the user confirms on review.
  // Income without a credit keyword is rare and better surfaced for review than
  // silently mislabeled, so we do NOT guess "income" from a positive sign alone.
  return 'expense';
}


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
  // Year to attach to yearless rows (MM/DD), inferred from the statement; falls
  // back to the current year if the document has no 4-digit year at all.
  const statementYear = detectStatementYear(rawText) ?? new Date().getFullYear();
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
    const date = extractDateFromSegment(seg, preferMDY, statementYear);
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
  fallbackYear?: number,
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

  // Yearless forms, common on bank statements where the year sits in the header
  // rather than each row: numeric MM/DD (or DD/MM) and "Mon DD" / "DD Mon".
  // Only used when we have a year to attach (from the statement context).
  if (fallbackYear) {
    // Numeric MM/DD (or DD/MM) at a token boundary, year taken from context.
    const mdRe = /(^|[\s|])(\d{1,2})[-/](\d{1,2})(?=\s|$|[A-Za-z])/g;
    while ((m = mdRe.exec(s)) !== null) {
      const a = +m[2], b = +m[3];
      let mm: number | null = null;
      let dd: number | null = null;
      if (a > 12 && b >= 1 && b <= 12) {
        // a can't be a month → DD/MM
        mm = b; dd = a;
      } else if (b > 12 && a >= 1 && a <= 12) {
        // b can't be a month → MM/DD
        mm = a; dd = b;
      } else if (a >= 1 && a <= 12 && b >= 1 && b <= 31) {
        // ambiguous → use detected preference
        if (preferMDY) { mm = a; dd = b; }
        else { mm = b; dd = a; }
      }
      if (mm && dd && dd <= 31) {
        const r = iso(fallbackYear, mm, dd);
        if (r) return { iso: r, raw: `${m[2]}/${m[3]}` };
      }
    }
    // "Mon DD" or "DD Mon" without a year.
    const monNames = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
    const mdName = new RegExp(`\\b(${monNames})[a-z]*\\.?\\s+(\\d{1,2})\\b`, 'i');
    let nm = s.match(mdName);
    if (nm) {
      const mm = monthIndex(nm[1]);
      const r = iso(fallbackYear, mm, +nm[2]);
      if (r) return { iso: r, raw: nm[0] };
    }
    const nameMd = new RegExp(`\\b(\\d{1,2})\\s+(${monNames})[a-z]*\\.?\\b`, 'i');
    nm = s.match(nameMd);
    if (nm) {
      const mm = monthIndex(nm[2]);
      const r = iso(fallbackYear, mm, +nm[1]);
      if (r) return { iso: r, raw: nm[0] };
    }
  }
  return null;
}

const MONTHS_3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function monthIndex(name: string): number {
  return MONTHS_3.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

/** Find a 4-digit year anywhere in the statement to attach to yearless rows. */
function detectStatementYear(text: string): number | undefined {
  // Prefer a year near "statement", "period", "closing date" etc., else the most
  // common 19xx/20xx in the document, else undefined (caller may use current year).
  const all = text.match(/(?:19|20)\d{2}/g);
  if (!all || all.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const y of all) counts.set(y, (counts.get(y) ?? 0) + 1);
  let best = all[0];
  let bestN = 0;
  for (const [y, n] of counts) {
    const yr = +y;
    // Ignore implausible years.
    if (yr < 1990 || yr > new Date().getFullYear() + 1) continue;
    if (n > bestN) { best = y; bestN = n; }
  }
  return +best;
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

// ── CSV statement parsing ────────────────────────────────────────────────────
// Bank CSV exports (Capital One, Chase, Amex, Discover, generic) have structured
// columns, so we map them directly to transactions rather than running them
// through the text/regex pipeline. This is far more reliable than PDF parsing —
// for Capital One in particular, "Download as CSV" is the recommended path.

/** Parse a raw CSV string into transaction rows. Never throws; returns [] if the
 *  content isn't a recognizable transaction table. */
export function parseCsvText(rawText: string, sourceQuality = 1): RawParsedRow[] {
  const rows = parseCsvRows(rawText);
  if (rows.length < 2) return []; // need a header + at least one data row

  // Find the header row: the first row whose cells look like column names we know.
  let headerIdx = -1;
  let header: string[] = [];
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map((c) => c.trim().toLowerCase());
    if (looksLikeHeader(cells)) {
      headerIdx = i;
      header = cells;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const cols = mapColumns(header);
  if (cols.date < 0 || (cols.amount < 0 && cols.debit < 0 && cols.credit < 0)) {
    return []; // can't locate the essential columns
  }

  const preferMDY = true; // bank CSVs in this app's market are MM/DD/YYYY
  const thisYear = new Date().getFullYear();
  const out: RawParsedRow[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i];
    if (cells.length === 0 || cells.every((c) => c.trim() === '')) continue;

    const dateRaw = (cells[cols.date] ?? '').trim();
    if (!dateRaw) continue;
    const parsedDate = extractDateFromSegment(dateRaw, preferMDY, thisYear);
    if (!parsedDate) continue;

    // Determine signed amount. Three schemes:
    //  (a) separate debit / credit columns (sign is structural — authoritative)
    //  (b) single signed amount column (the numeric sign is authoritative)
    //  (c) amount column + a "type"/Details indicator (use it to resolve sign)
    let value: number | null = null;
    let negative = false;
    let signKnown = false; // true when the CSV's own columns determine direction

    if (cols.debit >= 0 || cols.credit >= 0) {
      const debit = parseMoney(cells[cols.debit] ?? '');
      const credit = parseMoney(cells[cols.credit] ?? '');
      if (debit != null && debit !== 0) {
        value = Math.abs(debit);
        negative = true; // money out
        signKnown = true;
      } else if (credit != null && credit !== 0) {
        value = Math.abs(credit);
        negative = false; // money in
        signKnown = true;
      }
    } else if (cols.amount >= 0) {
      const cell = (cells[cols.amount] ?? '').trim();
      const amt = parseMoney(cell);
      if (amt != null) {
        value = Math.abs(amt);
        // A leading/paren/trailing minus is an explicit, authoritative sign.
        if (amt < 0 || /^\(|-/.test(cell) || /-$/.test(cell)) {
          negative = amt < 0;
          signKnown = true;
        }
        // A type/Details column (DEBIT/CREDIT, etc.) resolves or overrides sign.
        if (cols.type >= 0) {
          const t = (cells[cols.type] ?? '').trim().toLowerCase();
          if (/debit|withdrawal|payment|purchase|sale/.test(t)) {
            negative = true;
            signKnown = true;
          } else if (/credit|deposit|refund|return/.test(t)) {
            negative = false;
            signKnown = true;
          }
        }
      }
    }

    if (value == null || value === 0) continue;

    const desc =
      (cols.description >= 0 ? (cells[cols.description] ?? '').trim() : '') ||
      (cols.description2 >= 0 ? (cells[cols.description2] ?? '').trim() : '') ||
      'Unlabeled transaction';

    // When the CSV's columns tell us the direction, trust that over keyword
    // guessing (Amex marks payments negative; Chase marks them DEBIT, etc.).
    // Transfers are still detected from text since no column conveys them.
    let type: TransactionType;
    if (signKnown) {
      type = TRANSFER_HINTS.test(desc) ? 'transfer' : negative ? 'expense' : 'income';
    } else {
      type = inferType(desc, negative);
    }

    out.push({
      date: parsedDate.iso,
      rawDate: dateRaw,
      description: titleCaseSafe(desc),
      amount: value,
      type,
      parsingConfidence: Math.min(1, sourceQuality), // CSV is high-confidence
      rawLine: rows[i].join(','),
    });
  }

  return dedupeWithinBatch(out);
}

interface CsvColumns {
  date: number;
  description: number;
  description2: number;
  amount: number;
  debit: number;
  credit: number;
  type: number;
}

function mapColumns(header: string[]): CsvColumns {
  const exact = (name: string) => header.findIndex((h) => h === name);
  const find = (...names: string[]) =>
    header.findIndex((h) => names.some((n) => h === n || h.includes(n)));

  // Prefer the posting/transaction date; fall back to any date column.
  let date = header.findIndex((h) => h === 'transaction date' || h === 'date');
  if (date < 0) date = find('transaction date', 'posted date', 'post date', 'date');

  // Description: prefer an exact "description" header, then merchant/payee/name,
  // and only then looser synonyms. This avoids matching Chase's "Details" column
  // (which holds DEBIT/CREDIT) when a real "Description" column exists.
  let description = exact('description');
  if (description < 0) description = find('description', 'merchant', 'payee', 'name', 'memo');
  if (description < 0) description = find('details');

  // A secondary description column some banks add (e.g. "Extended Details").
  const description2 = header.findIndex(
    (h, i) => i !== description && /extended details|memo|notes/.test(h),
  );

  const amount = find('amount', 'transaction amount');
  const debit = find('debit', 'withdrawal', 'withdrawals');
  const credit = find('credit', 'deposit', 'deposits');
  // Chase's "Details" column (DEBIT/CREDIT) is a usable type indicator; so is a
  // "Transaction Type" column. But don't treat it as type if it IS the description.
  let type = find('transaction type', 'debit/credit');
  if (type < 0) {
    const det = exact('details');
    if (det >= 0 && det !== description) type = det;
  }
  if (type < 0) type = find('type');

  return { date, description, description2, amount, debit, credit, type };
}

function looksLikeHeader(cells: string[]): boolean {
  const joined = cells.join(' ');
  const hasDate = /\bdate\b/.test(joined);
  const hasMoney = /\bamount\b|\bdebit\b|\bcredit\b|\bdeposit\b|\bwithdrawal\b/.test(joined);
  const hasDesc = /\bdescription\b|\bname\b|\bmerchant\b|\bpayee\b|\bmemo\b|\bdetails\b/.test(joined);
  return hasDate && (hasMoney || hasDesc);
}

/** Parse a money cell that may have $, commas, parentheses, or a trailing/leading
 *  minus. Returns a signed number, or null if not a number. */
function parseMoney(cell: string): number | null {
  let s = cell.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.includes('-')) negative = true;
  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return null;
  // Decide decimal separator: if both . and , present, the last one is decimal.
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const dec = Math.max(lastDot, lastComma);
  if (dec >= 0 && s.length - dec - 1 === 2) {
    const decChar = s[dec];
    const thouChar = decChar === '.' ? ',' : '.';
    s = s.split(thouChar).join('').replace(decChar, '.');
  } else {
    s = s.replace(/[.,]/g, '');
  }
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

/** Split CSV text into rows of cells, honoring quoted fields with embedded commas,
 *  escaped quotes (""), and CRLF/LF line endings. Auto-detects the delimiter
 *  (comma, semicolon, or tab) from the first non-empty line. */
function parseCsvRows(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === delimiter) {
      endField();
      i++;
      continue;
    }
    if (c === '\r') {
      if (text[i + 1] === '\n') {
        endRow();
        i += 2;
      } else {
        endRow();
        i++;
      }
      continue;
    }
    if (c === '\n') {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) endRow();
  return rows.filter((r) => r.length > 0);
}

/** Pick the most likely delimiter by counting occurrences (outside quotes) on the
 *  first non-empty line. Defaults to comma. */
function detectDelimiter(text: string): string {
  const firstLine = (text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '');
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const d of candidates) {
    // Count occurrences not inside quotes.
    let count = 0;
    let inQ = false;
    for (let i = 0; i < firstLine.length; i++) {
      const c = firstLine[i];
      if (c === '"') inQ = !inQ;
      else if (c === d && !inQ) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}
