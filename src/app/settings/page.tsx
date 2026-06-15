'use client';

import React, { useRef, useState } from 'react';
import { useStore } from '@/core/useStore';
import { storage } from '@/core/storage';
import { formatMoney } from '@/core/format';
import { Card, SectionLabel, Field } from '@/components/ui';
import { Download, Upload, RotateCcw, Trash2 } from 'lucide-react';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CRC', 'COP'];

export default function SettingsPage() {
  const store = useStore();
  const s = store.settings;
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function num(v: string) {
    return Math.max(0, parseFloat(v) || 0);
  }

  function exportData() {
    const raw = storage.exportJSON();
    if (!raw) {
      setMsg('Nothing to export yet.');
      return;
    }
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `freedom-ledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg('Backup downloaded.');
  }

  async function importData(file: File) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object' || !data.settings) {
        throw new Error('not a valid backup');
      }
      await storage.save(data);
      setMsg('Backup restored. Reloading…');
      setTimeout(() => window.location.reload(), 700);
    } catch {
      setMsg("That file isn't a valid Freedom Ledger backup.");
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">Your numbers, your data — all stored in this browser</div>
        </div>
      </div>

      <SectionLabel>Money basics</SectionLabel>
      <Card>
        <Field label="Currency">
          <select
            className="select"
            value={s.currency}
            onChange={(e) => store.updateSettings({ currency: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Starting cash balance">
          <input
            className="input"
            type="number"
            value={s.startingCashBalance}
            onChange={(e) => store.updateSettings({ startingCashBalance: num(e.target.value) })}
          />
        </Field>
        <Field label="Next income date">
          <input
            className="input"
            type="date"
            value={s.nextIncomeDate}
            onChange={(e) => store.updateSettings({ nextIncomeDate: e.target.value })}
          />
        </Field>
        <Field label="Income frequency">
          <select
            className="select"
            value={s.incomeFrequency}
            onChange={(e) => store.updateSettings({ incomeFrequency: e.target.value as any })}
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
            <option value="one_time">One time</option>
          </select>
        </Field>
        <Field label="Monthly survival expense (food, transport, essentials)">
          <input
            className="input"
            type="number"
            value={s.survivalMonthlyExpense}
            onChange={(e) => store.updateSettings({ survivalMonthlyExpense: num(e.target.value) })}
          />
        </Field>
      </Card>

      <SectionLabel>Foundation targets</SectionLabel>
      <Card>
        <Field label="Rainy Day target">
          <input className="input" type="number" value={s.rainyDayTarget} onChange={(e) => store.updateSettings({ rainyDayTarget: num(e.target.value) })} />
        </Field>
        <Field label="Emergency fund target">
          <input className="input" type="number" value={s.emergencyFundTarget} onChange={(e) => store.updateSettings({ emergencyFundTarget: num(e.target.value) })} />
        </Field>
        <Field label="Retirement contribution target">
          <input className="input" type="number" value={s.retirementContributionTarget} onChange={(e) => store.updateSettings({ retirementContributionTarget: num(e.target.value) })} />
        </Field>
      </Card>

      <SectionLabel>Statement scanning</SectionLabel>
      <Card>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          PDF statements with selectable text are read entirely in your browser — no key needed.
          To read screenshots and image-only statements, an OCR provider key is required. Set{' '}
          <code style={{ background: 'var(--bg)', padding: '1px 6px', borderRadius: 5 }}>NEXT_PUBLIC_OCR_PROVIDER=ocrspace</code>{' '}
          and{' '}
          <code style={{ background: 'var(--bg)', padding: '1px 6px', borderRadius: 5 }}>NEXT_PUBLIC_OCRSPACE_KEY</code>{' '}
          in your deployment environment (a free key is available at ocr.space).
        </div>
      </Card>

      <SectionLabel>Backup &amp; restore</SectionLabel>
      <Card>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 14 }}>
          Your data lives only in this browser. Download a backup to keep it safe, or restore from a
          previous backup file.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={exportData}>
            <Download size={16} /> Download backup
          </button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> Restore from file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])}
          />
        </div>
        {msg && <div style={{ marginTop: 12, fontSize: 13, color: 'var(--accent)' }}>{msg}</div>}
      </Card>

      <SectionLabel>Data</SectionLabel>
      <Card>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (confirm('Reload the demo data? This replaces your current data.')) {
                store.resetToSeed();
                setMsg('Demo data loaded.');
              }
            }}
          >
            <RotateCcw size={16} /> Load demo data
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              if (confirm('Erase ALL data in this browser? This cannot be undone.')) {
                store.clearAllData();
                setMsg('All data cleared.');
              }
            }}
          >
            <Trash2 size={16} /> Clear all data
          </button>
        </div>
      </Card>

      <div className="disclaimer">
        Freedom Ledger is for personal finances only and stores everything locally in your browser.
        CJ-Bot provides CPA-style guidance but is not a licensed CPA, attorney, or financial adviser.
      </div>
    </>
  );
}
