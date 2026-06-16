'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '@/core/useStore';
import { formatMoney } from '@/core/format';
import { cjBotService } from '@/core/cjBotService';
import type { CJBotResponse } from '@/core/cjBotTypes';
import type { BudgetCategory } from '@/core/models';
import { Card, Pill, EmptyState, CJBotInsightCard, Modal } from '@/components/ui';
import { Lock, Unlock, Sparkles } from 'lucide-react';

export default function BudgetPage() {
  const store = useStore();
  const cur = store.settings.currency;
  const fmt = (n: number) => formatMoney(n, cur);
  const ctx = useMemo(() => store.buildFinanceContext(), [store]);

  const [selected, setSelected] = useState<BudgetCategory | null>(null);
  const [insight, setInsight] = useState<CJBotResponse | null>(null);
  const [loadingRec, setLoadingRec] = useState(false);

  async function askCJBot(cat: BudgetCategory) {
    setSelected(cat);
    setInsight(null);
    setLoadingRec(true);
    const r = await cjBotService.generateBudgetRecommendations(cat.month, ctx, cat);
    setInsight(r);
    setLoadingRec(false);
    if (r.suggestedBudgetAmount != null) {
      store.updateBudgetCategory(cat.id, {
        recommendedAmount: r.suggestedBudgetAmount,
        recommendationReason: r.recommendation,
      });
    }
  }

  const totalBudget = store.budget.reduce((s, b) => s + b.budgetAmount, 0);
  const totalActual = store.budget.reduce((s, b) => s + b.actualAmount, 0);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Budget</div>
          <div className="page-subtitle">
            {fmt(totalActual)} spent of {fmt(totalBudget)} budgeted this month
          </div>
        </div>
      </div>

      {store.budget.length === 0 ? (
        <Card>
          <EmptyState
            title="No budget categories yet"
            hint="Categories appear as you import and categorize transactions."
          />
        </Card>
      ) : (
        <div className="grid grid-2">
          {store.budget.map((b) => {
            const over = b.actualAmount > b.budgetAmount;
            const ratio = b.budgetAmount > 0 ? b.actualAmount / b.budgetAmount : 0;
            return (
              <Card key={b.id}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{b.category}</div>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => store.updateBudgetCategory(b.id, { locked: !b.locked })}
                    title={b.locked ? 'Unlock' : 'Lock'}
                    style={{ padding: 6 }}
                  >
                    {b.locked ? <Lock size={14} /> : <Unlock size={14} />}
                  </button>
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>
                  {fmt(b.actualAmount)}{' '}
                  <span style={{ fontSize: 13, color: 'var(--text-faint)', fontWeight: 600 }}>
                    / {fmt(b.budgetAmount)}
                  </span>
                </div>
                <div className="progress">
                  <span
                    style={{
                      width: `${Math.min(ratio, 1) * 100}%`,
                      background: over ? 'var(--danger)' : 'var(--success)',
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 12,
                  }}
                >
                  {over ? (
                    <Pill label={`Over by ${fmt(b.actualAmount - b.budgetAmount)}`} color="var(--danger)" />
                  ) : (
                    <Pill label="On track" color="var(--success)" />
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => askCJBot(b)}>
                    <Sparkles size={14} /> Ask CJ-Bot
                  </button>
                </div>

                {b.recommendedAmount != null && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 10,
                      background: 'var(--accent-soft)',
                      border: '1px solid var(--accent)',
                    }}
                  >
                    <div style={{ fontSize: 13, marginBottom: 8 }}>
                      CJ-Bot suggests <strong>{fmt(b.recommendedAmount)}</strong>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-success btn-sm"
                        onClick={() => store.approveBudgetRecommendation(b.id)}
                        style={{ flex: 1 }}
                      >
                        Approve
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => store.rejectBudgetRecommendation(b.id)}
                        style={{ flex: 1 }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {selected && (
        <Modal title={`CJ-Bot · ${selected.category}`} onClose={() => setSelected(null)}>
          <CJBotInsightCard response={insight} loading={loadingRec} role="Budget Adjuster" />
          <button
            className="btn btn-ghost"
            style={{ marginTop: 14, width: '100%' }}
            onClick={() => setSelected(null)}
          >
            Close
          </button>
        </Modal>
      )}
    </>
  );
}
