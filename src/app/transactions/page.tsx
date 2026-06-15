'use client';

import React, { useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useStore } from '@/core/useStore';
import { formatMoney, formatDate } from '@/core/format';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type TransactionType,
} from '@/core/models';
import { Card, SectionLabel, Pill, EmptyState, Modal, Field } from '@/components/ui';

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

export default function TransactionsPage() {
  const store = useStore();
  const cur = store.settings.currency;
  const fmt = (n: number) => formatMoney(n, cur);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all');
  const [showAdd, setShowAdd] = useState(false);

  const filtered = useMemo(() => {
    return store.transactions.filter((t) => {
      const isIn = t.type === 'income' || t.type === 'refund' || t.type === 'reimbursement';
      if (filter === 'in' && !isIn) return false;
      if (filter === 'out' && isIn) return false;
      if (query && !`${t.description} ${t.category}`.toLowerCase().includes(query.toLowerCase()))
        return false;
      return true;
    });
  }, [store.transactions, query, filter]);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Transactions</div>
          <div className="page-subtitle">{store.transactions.length} total</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={16} /> Add transaction
        </button>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px', position: 'relative' }}>
            <Search
              size={16}
              style={{
                position: 'absolute',
                left: 12,
                top: 13,
                color: 'var(--text-faint)',
              }}
            />
            <input
              className="input"
              placeholder="Search transactions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ paddingLeft: 36 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['all', 'in', 'out'] as const).map((f) => (
              <button
                key={f}
                className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'in' ? 'Money in' : 'Money out'}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        {filtered.length === 0 ? (
          <EmptyState title="No transactions" hint="Import a statement or add one manually." />
        ) : (
          filtered.map((t) => {
            const isIn = t.type === 'income' || t.type === 'refund' || t.type === 'reimbursement';
            return (
              <div className="row" key={t.id}>
                <div className="row-main">
                  <div className="row-title">{t.description}</div>
                  <div className="row-sub">
                    {formatDate(t.date)} · {t.category}
                    {t.category === 'Needs Review' ? ' ⚠' : ''}
                  </div>
                </div>
                <div
                  className="row-amount"
                  style={{ color: isIn ? 'var(--success)' : 'var(--text)' }}
                >
                  {isIn ? '+' : '−'}
                  {fmt(t.amount).replace('-', '')}
                </div>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => store.deleteTransaction(t.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })
        )}
      </Card>

      {showAdd && <AddTransactionModal onClose={() => setShowAdd(false)} />}
    </>
  );
}

function AddTransactionModal({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('expense');
  const [category, setCategory] = useState('Other');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const cats = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  function save() {
    if (!desc || !amount) return;
    store.addTransaction({
      date,
      description: desc,
      amount: Math.abs(parseFloat(amount)) || 0,
      type,
      category,
      isDuplicateCandidate: false,
    });
    onClose();
  }

  return (
    <Modal title="Add transaction" onClose={onClose}>
      <Field label="Description">
        <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </Field>
      <Field label="Amount">
        <input
          className="input"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Field label="Date">
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Type">
        <select
          className="select"
          value={type}
          onChange={(e) => {
            setType(e.target.value as TransactionType);
            setCategory(e.target.value === 'income' ? 'Job Paycheck' : 'Other');
          }}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace('_', ' ')}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Category">
        <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
          {cats.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={save} style={{ flex: 1 }}>
          Add
        </button>
      </div>
    </Modal>
  );
}
