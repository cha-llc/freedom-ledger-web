'use client';

import React, { useState } from 'react';
import { useStore } from '@/core/useStore';
import { formatMoney, formatDate, daysUntil } from '@/core/format';
import type { BillFrequency, Priority } from '@/core/models';
import { Card, Pill, EmptyState, Modal, Field } from '@/components/ui';
import { Plus, Check, Trash2 } from 'lucide-react';

const PRIORITY_COLOR: Record<Priority, string> = {
  critical: 'var(--danger)',
  high: 'var(--warning)',
  medium: 'var(--accent)',
  low: 'var(--text-faint)',
};

export default function BillsPage() {
  const store = useStore();
  const cur = store.settings.currency;
  const fmt = (n: number) => formatMoney(n, cur);
  const [showAdd, setShowAdd] = useState(false);

  const sorted = [...store.bills].sort((a, b) => daysUntil(a.dueDate) - daysUntil(b.dueDate));
  const unpaidTotal = store.bills.filter((b) => !b.paid).reduce((s, b) => s + b.amount, 0);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Bills</div>
          <div className="page-subtitle">{fmt(unpaidTotal)} unpaid across {store.bills.filter(b=>!b.paid).length} bill(s)</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={16} /> Add bill
        </button>
      </div>

      <Card>
        {sorted.length === 0 ? (
          <EmptyState title="No bills yet" hint="Add your recurring bills to track due dates." />
        ) : (
          sorted.map((b) => {
            const due = daysUntil(b.dueDate);
            return (
              <div className="row" key={b.id}>
                <button
                  onClick={() => store.toggleBillPaid(b.id)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 7,
                    border: `2px solid ${b.paid ? 'var(--success)' : 'var(--border)'}`,
                    background: b.paid ? 'var(--success)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {b.paid && <Check size={14} color="#07140c" />}
                </button>
                <div className="row-main">
                  <div className="row-title" style={{ textDecoration: b.paid ? 'line-through' : 'none', opacity: b.paid ? 0.6 : 1 }}>
                    {b.name}
                  </div>
                  <div className="row-sub">
                    Due {formatDate(b.dueDate)}
                    {!b.paid && (due < 0 ? ' · overdue' : due === 0 ? ' · today' : ` · in ${due}d`)}
                    {b.autopay ? ' · autopay' : ''}
                  </div>
                </div>
                <Pill label={b.priority} color={PRIORITY_COLOR[b.priority]} />
                <div className="row-amount">{fmt(b.amount)}</div>
                <button className="btn btn-danger btn-sm" onClick={() => store.deleteBill(b.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })
        )}
      </Card>

      {showAdd && <AddBillModal onClose={() => setShowAdd(false)} />}
    </>
  );
}

function AddBillModal({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [priority, setPriority] = useState<Priority>('high');
  const [frequency, setFrequency] = useState<BillFrequency>('monthly');

  function save() {
    if (!name || !amount) return;
    store.addBill({
      name,
      amount: Math.abs(parseFloat(amount)) || 0,
      currency: store.settings.currency,
      dueDate,
      frequency,
      autopay: false,
      paid: false,
      priority,
    });
    onClose();
  }

  return (
    <Modal title="Add bill" onClose={onClose}>
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Amount">
        <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Due date">
        <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </Field>
      <Field label="Priority">
        <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </Field>
      <Field label="Frequency">
        <select className="select" value={frequency} onChange={(e) => setFrequency(e.target.value as BillFrequency)}>
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Biweekly</option>
          <option value="yearly">Yearly</option>
          <option value="one_time">One time</option>
        </select>
      </Field>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={save}>Add bill</button>
      </div>
    </Modal>
  );
}
