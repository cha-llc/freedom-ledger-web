'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '@/core/useStore';
import { formatMoney, formatDate } from '@/core/format';
import { cjBotService } from '@/core/cjBotService';
import type { CJBotResponse } from '@/core/cjBotTypes';
import type { Priority, DebtStatus } from '@/core/models';
import { Card, SectionLabel, CJBotInsightCard, CJDisclaimer, Pill, EmptyState, Modal, Field } from '@/components/ui';
import { Plus, Trash2 } from 'lucide-react';

export default function DebtPage() {
  const store = useStore();
  const cur = store.settings.currency;
  const fmt = (n: number) => formatMoney(n, cur);
  const ctx = useMemo(() => store.buildFinanceContext(), [store]);
  const [insight, setInsight] = useState<CJBotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    cjBotService.prioritizeDebtPayments(ctx).then((r) => alive && setInsight(r)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.debts.length]);

  const total = store.debts.reduce((s, d) => s + d.balance, 0);
  const mins = store.debts.reduce((s, d) => s + d.minimumPayment, 0);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Debt</div>
          <div className="page-subtitle">{fmt(total)} total · {fmt(mins)} in minimums</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={16} /> Add debt
        </button>
      </div>

      <CJBotInsightCard response={insight} loading={loading} role="Debt Prioritizer" />
      <CJDisclaimer />

      <SectionLabel>Balances</SectionLabel>
      <Card>
        {store.debts.length === 0 ? (
          <EmptyState title="No debts tracked" hint="Add a balance to get a payoff order from CJ-Bot." />
        ) : (
          store.debts.map((d) => (
            <div className="row" key={d.id}>
              <div className="row-main">
                <div className="row-title">{d.creditor}</div>
                <div className="row-sub">
                  Min {fmt(d.minimumPayment)} · due {formatDate(d.dueDate)}
                  {d.interestRate ? ` · ${d.interestRate}% APR` : ' · no interest'}
                </div>
              </div>
              <Pill
                label={d.status}
                color={d.status === 'current' ? 'var(--success)' : d.status === 'late' ? 'var(--warning)' : 'var(--danger)'}
              />
              <div className="row-amount">{fmt(d.balance)}</div>
              <button className="btn btn-danger btn-sm" onClick={() => store.deleteDebt(d.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </Card>

      {showAdd && <AddDebtModal onClose={() => setShowAdd(false)} />}
    </>
  );
}

function AddDebtModal({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [creditor, setCreditor] = useState('');
  const [balance, setBalance] = useState('');
  const [minimumPayment, setMin] = useState('');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [interestRate, setRate] = useState('');
  const [priority, setPriority] = useState<Priority>('high');

  function save() {
    if (!creditor || !balance) return;
    store.addDebt({
      creditor,
      balance: Math.abs(parseFloat(balance)) || 0,
      minimumPayment: Math.abs(parseFloat(minimumPayment)) || 0,
      dueDate,
      interestRate: interestRate ? parseFloat(interestRate) : undefined,
      status: 'current' as DebtStatus,
      priority,
    });
    onClose();
  }

  return (
    <Modal title="Add debt" onClose={onClose}>
      <Field label="Creditor"><input className="input" value={creditor} onChange={(e) => setCreditor(e.target.value)} /></Field>
      <Field label="Balance"><input className="input" type="number" value={balance} onChange={(e) => setBalance(e.target.value)} /></Field>
      <Field label="Minimum payment"><input className="input" type="number" value={minimumPayment} onChange={(e) => setMin(e.target.value)} /></Field>
      <Field label="Due date"><input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
      <Field label="Interest rate % (optional)"><input className="input" type="number" value={interestRate} onChange={(e) => setRate(e.target.value)} /></Field>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={save}>Add debt</button>
      </div>
    </Modal>
  );
}
