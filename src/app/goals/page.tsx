'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '@/core/useStore';
import { formatMoney } from '@/core/format';
import { cjBotService } from '@/core/cjBotService';
import type { CJBotResponse } from '@/core/cjBotTypes';
import { Card, SectionLabel, CJBotInsightCard, CJDisclaimer, Field, Modal } from '@/components/ui';
import { Plus, PiggyBank } from 'lucide-react';

const FUND_TINT: Record<string, string> = {
  rainy_day: 'var(--success)',
  emergency: 'var(--accent)',
  retirement: 'var(--foundation)',
  travel: 'var(--warning)',
  debt: 'var(--danger)',
  custom: 'var(--text-muted)',
};

export default function GoalsPage() {
  const store = useStore();
  const cur = store.settings.currency;
  const fmt = (n: number) => formatMoney(n, cur);
  const ctx = useMemo(() => store.buildFinanceContext(), [store]);

  const [insight, setInsight] = useState<CJBotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [contributeFor, setContributeFor] = useState<string | null>(null);
  const [amount, setAmount] = useState('');

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    cjBotService
      .generateFoundationBuilderAdvice(ctx)
      .then((r) => alive && setInsight(r))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.transactions.length]);

  function contribute() {
    if (contributeFor && amount) {
      store.addContribution(contributeFor, Math.abs(parseFloat(amount)) || 0);
    }
    setContributeFor(null);
    setAmount('');
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Foundation</div>
          <div className="page-subtitle">Rainy Day, Emergency, and Retirement — built one move at a time</div>
        </div>
      </div>

      <CJBotInsightCard response={insight} loading={loading} role="Foundation Builder" />
      <CJDisclaimer />

      <SectionLabel>Your funds</SectionLabel>
      <div className="grid grid-2">
        {store.goals.map((g) => {
          const ratio = g.targetAmount > 0 ? Math.min(1, g.currentAmount / g.targetAmount) : 0;
          const tint = FUND_TINT[g.type] ?? 'var(--accent)';
          return (
            <Card key={g.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 9,
                    background: `${tint}22`,
                    color: tint,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <PiggyBank size={17} />
                </div>
                <div style={{ fontWeight: 700 }}>{g.name}</div>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-faint)' }}>
                  {Math.round(ratio * 100)}%
                </span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, marginTop: 12 }}>
                {fmt(g.currentAmount)}{' '}
                <span style={{ fontSize: 13, color: 'var(--text-faint)', fontWeight: 600 }}>
                  / {fmt(g.targetAmount)}
                </span>
              </div>
              <div className="progress">
                <span style={{ width: `${ratio * 100}%`, background: tint }} />
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 14 }}
                onClick={() => setContributeFor(g.id)}
              >
                <Plus size={14} /> Add contribution
              </button>
            </Card>
          );
        })}
      </div>

      {contributeFor && (
        <Modal title="Add contribution" onClose={() => setContributeFor(null)}>
          <Field label="Amount">
            <input
              className="input"
              type="number"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Even $5 counts"
            />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setContributeFor(null)}>
              Cancel
            </button>
            <button className="btn btn-success" style={{ flex: 1 }} onClick={contribute}>
              Add
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
