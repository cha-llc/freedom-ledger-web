'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileText, Image as ImageIcon, Loader2, AlertCircle } from 'lucide-react';
import { useStore } from '@/core/useStore';
import { uid, todayISO, formatDate } from '@/core/format';
import {
  statementParserService,
  StatementParseError,
} from '@/core/statementParserService';
import type { WebUploadedFile } from '@/core/statementExtractionService';
import type { ImportBatch } from '@/core/models';
import { Card, SectionLabel, Pill, EmptyState } from '@/components/ui';

export default function UploadPage() {
  const store = useStore();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function runImport(upload: WebUploadedFile) {
    setBusy(true);
    setError(null);
    try {
      const parsed = await statementParserService.parseStatementFile(upload);
      const existing = store.transactions;
      const dups = statementParserService.detectDuplicates(parsed, existing);
      const batchId = uid('batch_');
      const staged = statementParserService.toStagedTransactions(parsed, batchId, dups);
      const lowConf = parsed.filter((p) => statementParserService.isLowConfidence(p)).length;

      const batch: ImportBatch = {
        id: batchId,
        sourceFileName: upload.file.name,
        fileType: upload.fileType,
        uploadDate: todayISO(),
        status: 'pending_review',
        transactionCount: staged.length,
        lowConfidenceCount: lowConf,
        duplicateCandidateCount: dups.length,
      };

      store.stageImport(batch, staged);
      router.push(`/import-review/${batchId}`);
    } catch (e) {
      const msg =
        e instanceof StatementParseError
          ? e.message
          : "Couldn't read that file. Try another statement or screenshot.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    runImport({ file, fileType: isPdf ? 'pdf' : 'image' });
  }

  const batches = store.importBatches;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Import Statement</div>
          <div className="page-subtitle">
            Upload a bank statement PDF or a screenshot. CJ-Bot reads it line by line — nothing
            is saved until you review and approve.
          </div>
        </div>
      </div>

      {/* Drop zone */}
      <div
        className="card"
        style={{
          borderStyle: 'dashed',
          borderColor: dragOver ? 'var(--accent)' : 'var(--border)',
          textAlign: 'center',
          padding: '44px 20px',
          background: dragOver ? 'var(--accent-soft)' : 'var(--card)',
          cursor: busy ? 'default' : 'pointer',
          transition: 'all 0.15s',
        }}
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!busy) handleFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          style={{ display: 'none' }}
          onChange={(e) => handleFiles(e.target.files)}
        />
        {busy ? (
          <>
            <Loader2
              size={36}
              style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }}
            />
            <div style={{ fontWeight: 700, marginTop: 14 }}>Reading your statement…</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>
              Extracting and parsing transactions
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}
            >
              <Upload size={26} />
            </div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>Drop a statement here</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>
              or click to choose a PDF or screenshot
            </div>
            <div
              style={{
                display: 'flex',
                gap: 16,
                justifyContent: 'center',
                marginTop: 18,
                color: 'var(--text-faint)',
                fontSize: 13,
              }}
            >
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <FileText size={15} /> PDF (read on-device)
              </span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <ImageIcon size={15} /> Screenshot (needs OCR key)
              </span>
            </div>
          </>
        )}
      </div>

      {error && (
        <div
          className="card"
          style={{
            marginTop: 16,
            borderColor: 'var(--danger)',
            background: 'var(--danger-soft)',
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <AlertCircle size={20} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 700, color: 'var(--danger)' }}>Couldn&apos;t import statement</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 3 }}>{error}</div>
          </div>
        </div>
      )}

      <div className="disclaimer">
        PDFs with selectable text are read entirely in your browser — nothing is uploaded.
        Screenshots use optical character recognition, which is off unless an OCR key is set in
        settings. CJ-Bot flags low-confidence rows as &quot;Needs Review&quot; rather than guessing.
      </div>

      {/* Import history */}
      <SectionLabel>Import history</SectionLabel>
      <Card>
        {batches.length === 0 ? (
          <EmptyState title="No imports yet" hint="Your uploaded statements will appear here." />
        ) : (
          batches.map((b) => {
            const pending = store.pendingImports[b.id];
            return (
              <div className="row" key={b.id}>
                <div className="row-main">
                  <div className="row-title">{b.sourceFileName}</div>
                  <div className="row-sub">
                    {formatDate(b.uploadDate)} · {b.transactionCount} transactions
                    {b.lowConfidenceCount > 0 ? ` · ${b.lowConfidenceCount} to review` : ''}
                  </div>
                </div>
                {b.status === 'pending_review' && pending ? (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => router.push(`/import-review/${b.id}`)}
                  >
                    Review
                  </button>
                ) : (
                  <Pill
                    label={b.status === 'approved' ? 'Approved' : b.status}
                    color={b.status === 'approved' ? 'var(--success)' : 'var(--text-faint)'}
                  />
                )}
              </div>
            );
          })
        )}
      </Card>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
