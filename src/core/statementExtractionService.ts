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

import { inflate } from 'pako';

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
  fileType: 'pdf' | 'image';
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
function extractPdfText(raw: string): string {
  const decompressed = collectStreamText(raw);
  const inline = extractShownText(raw);
  return decompressed.length >= inline.length ? decompressed : inline;
}

function collectStreamText(raw: string): string {
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    const endIdx = raw.indexOf('endstream', start);
    if (endIdx === -1) continue;
    let body = raw.slice(start, endIdx).replace(/\r?\n$/, '');

    const header = raw.slice(Math.max(0, m.index - 300), m.index);
    const filters = parseFilters(header);

    let bytes = latin1ToUint8(body);
    let ok = true;
    for (const f of filters) {
      try {
        if (f === 'ASCII85Decode') bytes = ascii85Decode(bytes);
        else if (f === 'ASCIIHexDecode') bytes = asciiHexDecode(bytes);
        else if (f === 'FlateDecode') bytes = inflate(bytes);
        else {
          ok = false;
          break;
        }
      } catch {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    const shown = extractShownText(uint8ToLatin1(bytes));
    if (shown.trim()) out.push(shown);
  }
  return out.join('\n');
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

function extractShownText(content: string): string {
  const chunks: string[] = [];
  let line = '';
  const tokenRe = /\((?:\\.|[^()\\])*\)|\bTd\b|\bTD\b|\bT\*\b|\bTj\b|\bTJ\b/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(content)) !== null) {
    const tok = m[0];
    if (tok.startsWith('(')) {
      line += decodePdfString(tok.slice(1, -1));
    } else if (tok === 'Td' || tok === 'TD' || tok === 'T*') {
      if (line.trim()) {
        chunks.push(line.trim());
        line = '';
      }
    }
  }
  if (line.trim()) chunks.push(line.trim());
  return chunks.join('\n');
}

function decodePdfString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
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
    return this.extractImage(upload.file);
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
    if (wordCount >= 8) {
      return { status: 'ok', text, sourceQuality: 0.95 };
    }

    return {
      status: 'needs_ocr_unconfigured',
      text: '',
      sourceQuality: 0,
      message:
        'This PDF has no readable text layer (it looks scanned). Upload a screenshot of the statement instead, or a PDF with selectable text.',
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
