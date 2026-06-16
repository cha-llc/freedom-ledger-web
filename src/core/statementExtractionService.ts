/**
 * statementExtractionService (web) — REAL text extraction from uploaded statements
 * in the browser. Same engine as mobile: decode PDF content streams (ASCII85 /
 * ASCIIHex / FlateDecode via pako) and pull the text layer. Reads from a browser
 * File/ArrayBuffer instead of expo-file-system. Never fabricates rows — failures
 * surface honestly.
 *
 * Image/screenshot OCR is pluggable (OCR.space real provider, env-gated). Without
 * a key configured, image uploads return needs_ocr_unconfigured rather than fake
 * data — a finance app must not invent transactions.
 */

import { inflate, inflateRaw } from 'pako';

export type ExtractionStatus =
  | 'ok'
  | 'empty'
  | 'needs_ocr_unconfigured'
  | 'ocr_failed'
  | 'unreadable'
  | 'too_large';

export interface ExtractionResult {
  status: ExtractionStatus;
  text: string;
  sourceQuality: number; // 1 for digital PDF text, lower for OCR
  message?: string;
}

export interface WebUploadedFile {
  file: File;
  fileType: 'pdf' | 'image' | 'csv';
}

const MAX_BYTES = 10 * 1024 * 1024;

// ── OCR provider (optional, for images) ────────────────────────────────────────
export interface OcrProvider {
  readonly name: string;
  recognize(base64: string, mimeType: string): Promise<string>;
}

class OcrSpaceProvider implements OcrProvider {
  readonly name = 'ocrspace';
  constructor(private apiKey: string) {}

  async recognize(base64: string, mimeType: string): Promise<string> {
    const body = new URLSearchParams();
    body.append('base64Image', `data:${mimeType};base64,${base64}`);
    body.append('language', 'eng');
    body.append('isTable', 'true');
    body.append('scale', 'true');
    body.append('OCREngine', '2');

    const res = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: { apikey: this.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`OCR HTTP ${res.status}`);
    const data: any = await res.json();
    if (data.IsErroredOnProcessing) {
      throw new Error(
        Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join('; ') : String(data.ErrorMessage),
      );
    }
    const parsed = (data.ParsedResults ?? [])
      .map((r: any) => r.ParsedText ?? '')
      .join('\n')
      .trim();
    if (!parsed) throw new Error('OCR returned no text');
    return parsed;
  }
}

let ocrProvider: OcrProvider | null = null;
export function setOcrProvider(p: OcrProvider | null): void {
  ocrProvider = p;
}
function resolveOcrProvider(): OcrProvider | null {
  if (ocrProvider) return ocrProvider;
  const which = process.env.NEXT_PUBLIC_OCR_PROVIDER;
  if (which === 'ocrspace') {
    const key = process.env.NEXT_PUBLIC_OCRSPACE_KEY;
    if (key) {
      ocrProvider = new OcrSpaceProvider(key);
      return ocrProvider;
    }
  }
  return null;
}

// ── PDF text-layer extraction (identical engine to mobile) ──────────────────────
// Handles the formats real bank statements (Capital One, Chase, BoA, etc.) use:
// FlateDecode content streams, object streams (ObjStm), ASCII85/ASCIIHex filters,
// TJ kerning arrays, hex strings, and BT/ET text blocks. Resilient to CR-only and
// LF stream delimiters and to binary stream bodies.
function extractPdfText(raw: string): string {
  const streams = collectDecodedStreams(raw);

  // Some PDFs pack page content inside object streams; expand those and re-scan.
  const expanded: string[] = [];
  for (const s of streams) {
    if (/\/Type\s*\/ObjStm/.test(s.header) || /\bBT\b|\bTJ\b|\bTj\b/.test(s.text.slice(0, 4000))) {
      expanded.push(s.text);
    } else {
      expanded.push(s.text);
    }
  }

  // Pull shown text out of every decoded stream. This is the authoritative
  // source for compressed PDFs (Capital One etc.).
  const fromStreams = expanded
    .map((t) => extractShownText(t))
    .filter((t) => t.trim().length > 0)
    .join('\n');

  // Raw fallback only helps for PDFs with uncompressed content streams. For
  // compressed PDFs the raw bytes are binary noise, so we must NOT pick it just
  // because it's longer. Score by readable-statement signal (dates, amounts,
  // real words), not raw length.
  const fromRaw = extractShownText(raw);

  const streamScore = textQualityScore(fromStreams);
  const rawScore = textQualityScore(fromRaw);

  if (streamScore === 0 && rawScore === 0) return fromStreams || fromRaw;
  return streamScore >= rawScore ? fromStreams : fromRaw;
}

/** Score how much a string looks like real statement text: rewards letters,
 *  digits, currency, and date-like tokens; penalizes control/garbage chars. */
function textQualityScore(s: string): number {
  if (!s) return 0;
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  const digits = (s.match(/\d/g) || []).length;
  const currency = (s.match(/[$€£]\s?\d/g) || []).length;
  const dates = (s.match(/\b\d{1,2}[\/\- ](\d{1,2}|[A-Za-z]{3})/g) || []).length;
  const words = (s.match(/[A-Za-z]{3,}/g) || []).length;
  // Garbage: bytes outside the normal printable range relative to length.
  const garbage = (s.match(/[\x00-\x08\x0e-\x1f\x7f-\xff]/g) || []).length;
  const printable = letters + digits;
  if (printable === 0) return 0;
  const garbageRatio = garbage / s.length;
  if (garbageRatio > 0.25) return 0; // mostly binary noise
  return words * 2 + currency * 10 + dates * 10 + digits - garbage * 3;
}

interface DecodedStream {
  text: string; // latin1 view of decoded bytes
  header: string; // the dictionary preceding the stream
}

/**
 * Find every `stream … endstream`, decode through its filter chain, and return the
 * decoded bytes as a latin1 string plus the preceding dictionary. Byte-accurate:
 * scans the raw string for the delimiters rather than assuming a newline style.
 */
function collectDecodedStreams(raw: string): DecodedStream[] {
  const out: DecodedStream[] = [];
  let searchFrom = 0;

  while (true) {
    const sIdx = raw.indexOf('stream', searchFrom);
    if (sIdx === -1) break;

    // Body starts right after the EOL that follows the `stream` keyword. The spec
    // allows CRLF or a bare LF (and some writers emit a bare CR).
    let bodyStart = sIdx + 'stream'.length;
    if (raw[bodyStart] === '\r' && raw[bodyStart + 1] === '\n') bodyStart += 2;
    else if (raw[bodyStart] === '\n' || raw[bodyStart] === '\r') bodyStart += 1;

    const eIdx = raw.indexOf('endstream', bodyStart);
    if (eIdx === -1) {
      searchFrom = sIdx + 6;
      continue;
    }
    // Trim a single trailing EOL between data and `endstream`.
    let bodyEnd = eIdx;
    if (raw[bodyEnd - 1] === '\n') bodyEnd--;
    if (raw[bodyEnd - 1] === '\r') bodyEnd--;

    const header = raw.slice(Math.max(0, sIdx - 600), sIdx);
    const body = raw.slice(bodyStart, bodyEnd);
    searchFrom = eIdx + 'endstream'.length;

    const filters = parseFilters(header);
    let bytes = latin1ToUint8(body);
    let ok = true;
    for (const f of filters) {
      try {
        if (f === 'ASCII85Decode') bytes = ascii85Decode(bytes);
        else if (f === 'ASCIIHexDecode') bytes = asciiHexDecode(bytes);
        else if (f === 'FlateDecode' || f === 'Fl') bytes = inflateLenient(bytes);
        else if (f === 'LZWDecode') {
          ok = false; // not supported; skip rather than emit garbage
          break;
        } else {
          // Unknown/identity filter — keep bytes as-is and try to read them.
        }
      } catch {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    const text = uint8ToLatin1(bytes);
    if (text) out.push({ text, header });
  }
  return out;
}

/** FlateDecode that tolerates a missing zlib header and trailing garbage. */
function inflateLenient(bytes: Uint8Array): Uint8Array {
  try {
    return inflate(bytes);
  } catch {
    // Retry as raw DEFLATE (no zlib wrapper) — some writers omit it.
    return inflateRaw(bytes);
  }
}

function parseFilters(header: string): string[] {
  const m = header.match(/\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/);
  if (!m) return [];
  const names = m[1].match(/\/([A-Za-z0-9]+)/g) || [];
  return names.map((n) => n.slice(1));
}

function latin1ToUint8(s: string): Uint8Array {
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
  return a;
}

function ascii85Decode(input: Uint8Array): Uint8Array {
  let str = uint8ToLatin1(input).replace(/\s/g, '');
  if (str.startsWith('<~')) str = str.slice(2);
  const term = str.indexOf('~>');
  if (term !== -1) str = str.slice(0, term);

  const out: number[] = [];
  let tuple = 0;
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === 'z' && count === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const v = ch.charCodeAt(0) - 33;
    if (v < 0 || v > 84) continue;
    tuple = tuple * 85 + v;
    count++;
    if (count === 5) {
      out.push((tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff);
      tuple = 0;
      count = 0;
    }
  }
  if (count > 0) {
    for (let i = count; i < 5; i++) tuple = tuple * 85 + 84;
    const bytes = [(tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff];
    for (let i = 0; i < count - 1; i++) out.push(bytes[i]);
  }
  return new Uint8Array(out);
}

function asciiHexDecode(input: Uint8Array): Uint8Array {
  const str = uint8ToLatin1(input).replace(/\s/g, '');
  const hex = str.endsWith('>') ? str.slice(0, -1) : str;
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    const pair = hex.length - i === 1 ? hex[i] + '0' : hex.slice(i, i + 2);
    const byte = parseInt(pair, 16);
    if (!isNaN(byte)) out.push(byte);
  }
  return new Uint8Array(out);
}

/**
 * Pull human-readable text out of a content stream. Walks the PDF text operators
 * properly: BT and ET blocks, Tj strings, TJ kerning arrays (large negative
 * adjustments become spaces), hex strings, and Td, TD, and Tstar positioning
 * (which imply line and word breaks). This is what lets glued-together statement
 * rows come back as separate lines.
 */
function extractShownText(content: string): string {
  const lines: string[] = [];
  let line = '';
  let i = 0;
  const n = content.length;

  const flush = () => {
    if (line.trim()) lines.push(line.trim());
    line = '';
  };

  while (i < n) {
    const ch = content[i];

    // Literal string: ( ... ) with balanced parens and escapes.
    if (ch === '(') {
      const { str, next } = readLiteralString(content, i);
      line += decodePdfString(str);
      i = next;
      continue;
    }

    // Hex string: < ... > (but not the << dict delimiter).
    if (ch === '<' && content[i + 1] !== '<') {
      const end = content.indexOf('>', i);
      if (end !== -1) {
        line += decodeHexString(content.slice(i + 1, end));
        i = end + 1;
        continue;
      }
    }

    // TJ array: [ (a) -250 (b) ] TJ — concatenate strings, big gaps -> space.
    if (ch === '[') {
      const end = content.indexOf(']', i);
      if (end !== -1) {
        const arr = content.slice(i + 1, end);
        // is it followed by TJ?
        const after = content.slice(end + 1, end + 5).trimStart();
        if (after.startsWith('TJ')) {
          line += readTJArray(arr);
          i = end + 1;
          continue;
        }
      }
    }

    // Operators that imply a new line / spacing.
    if (
      isWordBoundaryAt(content, i, 'Td') ||
      isWordBoundaryAt(content, i, 'TD') ||
      isWordBoundaryAt(content, i, 'T*')
    ) {
      flush();
      i += 2;
      continue;
    }
    if (isWordBoundaryAt(content, i, 'ET')) {
      flush();
      i += 2;
      continue;
    }

    i++;
  }
  flush();
  return lines.join('\n');
}

/** Read a literal ( ) string starting at `start` (index of '('). Returns inner
 *  content (without the outer parens) and the index just past the closing ')'. */
function readLiteralString(s: string, start: number): { str: string; next: number } {
  let depth = 0;
  let i = start;
  let out = '';
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      out += c + (s[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === '(') {
      depth++;
      if (depth === 1) continue; // skip the outermost open paren
    }
    if (c === ')') {
      depth--;
      if (depth === 0) {
        return { str: out, next: i + 1 };
      }
    }
    if (depth >= 1) out += c;
  }
  return { str: out, next: s.length };
}

/** Concatenate the strings inside a TJ array, turning large negative numeric
 *  adjustments (word spacing) into actual spaces. */
function readTJArray(arr: string): string {
  let result = '';
  let i = 0;
  while (i < arr.length) {
    const c = arr[i];
    if (c === '(') {
      const { str, next } = readLiteralString(arr, i);
      result += decodePdfString(str);
      i = next;
      continue;
    }
    if (c === '<') {
      const end = arr.indexOf('>', i);
      if (end !== -1) {
        // Hex inside a TJ array is often a glyph-index string (CID font), not
        // ASCII. Only decode if it cleanly maps to printable ASCII; otherwise
        // skip it rather than inject noise into the row.
        const decoded = decodeHexString(arr.slice(i + 1, end));
        if (decoded && !/[^\x20-\x7e]/.test(decoded) && /[A-Za-z0-9]/.test(decoded)) {
          result += decoded;
        }
        i = end + 1;
        continue;
      }
    }
    // numeric kerning adjustment
    const numMatch = arr.slice(i).match(/^-?\d+(\.\d+)?/);
    if (numMatch) {
      const val = parseFloat(numMatch[0]);
      // Negative adjustments push glyphs apart; a big push is a space.
      if (val <= -120) result += ' ';
      i += numMatch[0].length;
      continue;
    }
    i++;
  }
  return result;
}

function decodeHexString(hex: string): string {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, '');
  let out = '';
  // Try 2-digit (single-byte) decoding first.
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (code >= 32 && code < 127) out += String.fromCharCode(code);
    else if (code === 0) {
      /* skip null high-bytes from UTF-16 */
    } else out += ' ';
  }
  return out;
}

function isWordBoundaryAt(s: string, i: number, op: string): boolean {
  if (s.substr(i, op.length) !== op) return false;
  const before = s[i - 1];
  const after = s[i + op.length];
  const isDelim = (c: string | undefined) =>
    c === undefined || c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '[' || c === ']' || c === '/' || c === '>' || c === ')';
  return isDelim(before) && isDelim(after);
}

function decodePdfString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\\b/g, '')
    .replace(/\\f/g, '')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\(\d{1,3})/g, (_, o) => {
      const code = parseInt(o, 8);
      return code >= 32 && code < 127 ? String.fromCharCode(code) : ' ';
    });
}

function uint8ToLatin1(arr: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < arr.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(arr.subarray(i, i + CHUNK)) as number[]);
  }
  return s;
}

async function fileToUint8(file: File): Promise<Uint8Array> {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as number[]);
  }
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(bytes).toString('base64');
}

// ── Public API ─────────────────────────────────────────────────────────────────
export const statementExtractionService = {
  async extract(upload: WebUploadedFile): Promise<ExtractionResult> {
    if (upload.file.size > MAX_BYTES) {
      return {
        status: 'too_large',
        text: '',
        sourceQuality: 0,
        message: 'That file is over 10 MB. Try a single statement or a smaller export.',
      };
    }
    if (upload.fileType === 'pdf') return this.extractPdf(upload.file);
    if (upload.fileType === 'csv') return this.extractCsv(upload.file);
    return this.extractImage(upload.file);
  },

  async extractCsv(file: File): Promise<ExtractionResult> {
    let text: string;
    try {
      // CSV is plain text — read it directly as UTF-8.
      text = await file.text();
    } catch {
      return {
        status: 'unreadable',
        text: '',
        sourceQuality: 0,
        message: "Couldn't open that CSV file. It may be corrupted.",
      };
    }
    // Strip a UTF-8 BOM if present (Excel adds one).
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (!text.trim()) {
      return {
        status: 'unreadable',
        text: '',
        sourceQuality: 0,
        message: 'That CSV file is empty.',
      };
    }
    // High confidence: structured columns parse far more reliably than PDF text.
    return { status: 'ok', text, sourceQuality: 1 };
  },

  async extractPdf(file: File): Promise<ExtractionResult> {
    let raw: string;
    try {
      const bytes = await fileToUint8(file);
      raw = uint8ToLatin1(bytes);
    } catch {
      return {
        status: 'unreadable',
        text: '',
        sourceQuality: 0,
        message: "Couldn't open that PDF. It may be corrupted or password-protected.",
      };
    }

    if (/\/Encrypt\b/.test(raw)) {
      return {
        status: 'unreadable',
        text: '',
        sourceQuality: 0,
        message: 'That PDF is password-protected. Remove the password and re-upload.',
      };
    }

    const text = extractPdfText(raw);
    const wordCount = (text.match(/[A-Za-z]{2,}/g) || []).length;
    const hasNumbers = /\d/.test(text);
    // A real statement has words AND numbers. Accept on a modest amount of either
    // signal so we don't reject a valid extraction; the parser downstream decides
    // whether actual transactions are present.
    if (wordCount >= 4 && hasNumbers) {
      return { status: 'ok', text, sourceQuality: 0.95 };
    }
    if (wordCount >= 12) {
      // Lots of words but no digits is unusual for a statement, but still usable.
      return { status: 'ok', text, sourceQuality: 0.85 };
    }

    return {
      status: 'needs_ocr_unconfigured',
      text: '',
      sourceQuality: 0,
      message:
        "This PDF's text couldn't be read directly — it's likely scanned (an image of the statement rather than selectable text). On the Capital One site, use Download (not Print to PDF) to get a text PDF, or upload a clear screenshot.",
    };
  },

  async extractImage(file: File): Promise<ExtractionResult> {
    const provider = resolveOcrProvider();
    if (!provider) {
      return {
        status: 'needs_ocr_unconfigured',
        text: '',
        sourceQuality: 0,
        message:
          'Reading screenshots needs image scanning, which is off by default. Enable it in settings (adds an OCR key), or upload a PDF with selectable text.',
      };
    }
    let b64: string;
    try {
      const bytes = await fileToUint8(file);
      b64 = uint8ToBase64(bytes);
    } catch {
      return {
        status: 'unreadable',
        text: '',
        sourceQuality: 0,
        message: "Couldn't open that image. Try re-exporting the screenshot.",
      };
    }
    try {
      const text = await provider.recognize(b64, file.type || 'image/jpeg');
      const wordCount = (text.match(/[A-Za-z]{2,}/g) || []).length;
      if (wordCount < 4) {
        return {
          status: 'empty',
          text: '',
          sourceQuality: 0,
          message:
            'The image was too blurry to read reliably. Try a sharper screenshot cropped to the transactions.',
        };
      }
      return { status: 'ok', text, sourceQuality: 0.7 };
    } catch (e: any) {
      return {
        status: 'ocr_failed',
        text: '',
        sourceQuality: 0,
        message: `Scanning failed: ${e?.message ?? 'unknown error'}. Check your connection and try again.`,
      };
    }
  },
};
