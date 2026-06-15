'use client';

import React, { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Check, X, Trash2, AlertTriangle, Copy } from 'lucide-react';
import { useStore } from '@/core/useStore';
import { formatMoney, formatDate } from '@/core/format';
import { cjBotService } from '@/core/cjBotService';
import type { CJBotResponse } from '@/core/cjBotTypes';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type TransactionType,
} from '@/core/models';
import { Card, CJBotInsightCard, Pill, EmptyState } from '@/components/ui';
import { useEffect } from 'react';

const TYPES: TransactionType[] = [
  'income',
  'expense',
  'transfer',
  'refund',
  'reimbursement',
  'debt_payment',
  'bill_payment',
  'ignore',
];

export default function ImportReviewPage() {
  const store = useStore();
  const router = useRouter();
  const params = useParams();
  const batchId = String(params.batchId);

  const batch = store.importBatches.find((b) => b.id === batchId);
  const pending = store.pendingImports[batchId] ?? [];
  const cur = store.settings.currency;
  const fmt = (n: number) => formatMoney(n, cur);

  const [insight, setInsight] = useState<CJBotResponse | null>(null);
  const ctx = useMemo(() => store.buildFinanceContext(), [store]);

  useEffect(() => {
    let alive = true;
    if (pending.length > 0) {
      cjBotService
        .analyzeImportedTransactions(pending, ctx)
        .then((r) => alive && setInsight(r));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  if (!batch) {
    return (
      <>
        <div className="page-header">
          <div className="page-title">Import Review</div>
        </div>
        <EmptyState title="Batch not found" hint="It may have been approved or removed." />
        <button className="btn btn-ghost" onClick={() => router.push('/upload')}>
          Back to import
        </button>
      </>
    );
  }

  const lowConf = pending.filter(
    (t) => (t.parsingConfidence ?? 1) < 0.6 || t.category === 'Needs Review',
  ).length;
  const dups = pending.filter((t) => t.isDuplicateCandidate).length;

  function approve() {
    store.approveImport(batchId);
    router.push('/transactions');
  }
  function reject() {
    store.rejectImport(batchId);
    router.push('/upload');
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Review Import</div>
          <div className="page-subtitle">
            {batch.sourceFileName} · {pending.length} transaction
            {pending.length === 1 ? '' : 's'} · nothing is saved until you approve
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={reject}>
            <X size={16} /> Discard
          </button>
          <button className="btn btn-success" onClick={approve} disabled={pending.length === 0}>
            <Check size={16} /> Approve {pending.length}
          </button>
        </div>
      </div>

      {(lowConf > 0 || dups > 0) && (
        <div
          className="card"
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            borderColor: 'var(--warning)',
            background: 'var(--warning-soft)',
            marginBottom: 16,
          }}
        >
          <AlertTriangle size={20} style={{ color: 'var(--warning)' }} />
          <div style={{ fontSize: 14 }}>
            {lowConf > 0 && (
              <span>
                <strong>{lowConf}</strong> row{lowConf === 1 ? '' : 's'} need review.{' '}
              </span>
            )}
            {dups > 0 && (
              <span>
                <strong>{dups}</strong> possible duplicate{dups === 1 ? '' : 's'} flagged.
              </span>
            )}
          </div>
        </div>
      )}

      {insight && <CJBotInsightCard response={insight} role="Statement Reader" />}

      <div style={{ height: 16 }} />

      {pending.length === 0 ? (
        <EmptyState title="No rows left" hint="All rows were removed. Discard this batch." />
      ) : (
        <Card style={{ padding: 0 }}>
          {pending.map((t) => {
            const cats = t.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
            const needsReview = t.category === 'Needs Review' || (t.parsingConfidence ?? 1) < 0.6;
            return (
              <div
                key={t.id}
                style={{
                  padding: '14px 18px',
                  borderBottom: '1px solid var(--divider)',
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  background: needsReview ? 'var(--warning-soft)' : 'transparent',
                }}
              >
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <input
                    className="input"
                    value={t.description}
                    onChange={(e) =>
                      store.updatePendingTransaction(batchId, t.id, {
                        description: e.target.value,
                      })
                    }
                    style={{ fontWeight: 600 }}
                  />
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      marginTop: 6,
                      fontSize: 12,
                      color: 'var(--text-faint)',
                      alignItems: 'center',
                    }}
                  >
                    <span>{formatDate(t.date)}</span>
                    {t.isDuplicateCandidate && (
                      <Pill label="Possible dup" color="var(--warning)" />
                    )}
                    {needsReview && <Pill label="Needs review" color="var(--warning)" />}
                    {typeof t.parsingConfidence === 'number' && (
                      <span>· {Math.round(t.parsingConfidence * 100)}% conf</span>
                    )}
                  </div>
                </div>

                <select
                  className="select"
                  style={{ width: 130 }}
                  value={t.type}
                  onChange={(e) =>
                    store.updatePendingTransaction(batchId, t.id, {
                      type: e.target.value as TransactionType,
                    })
                  }
                >
                  {TYPES.map((ty) => (
                    <option key={ty} value={ty}>
                      {ty.replace('_', ' ')}
                    </option>
                  ))}
                </select>

                <select
                  className="select"
                  style={{ width: 170 }}
                  value={t.category}
                  onChange={(e) =>
                    store.updatePendingTransaction(batchId, t.id, { category: e.target.value })
                  }
                >
                  {!(cats as string[]).includes(t.category) && (
                    <option value={t.category}>{t.category}</option>
                  )}
                  {cats.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <input
                  className="input"
                  type="number"
                  value={t.amount}
                  onChange={(e) =>
                    store.updatePendingTransaction(batchId, t.id, {
                      amount: parseFloat(e.target.value) || 0,
                    })
                  }
                  style={{ width: 110, textAlign: 'right', fontWeight: 700 }}
                />

                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => store.removePendingTransaction(batchId, t.id)}
                  title="Remove row"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </Card>
      )}

      <div className="disclaimer">
        Approving adds these transactions to your ledger. Rows marked &quot;ignore&quot; are skipped.
        You can edit any field before approving — CJ-Bot never overwrites your ledger on its own.
      </div>
    </>
  );
}
