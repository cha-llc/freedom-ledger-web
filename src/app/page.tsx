'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Wallet,
  Receipt,
  TrendingDown,
  CreditCard,
  ArrowRight,
  Upload,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useStore } from '@/core/useStore';
import { formatMoney, formatMoneyShort, formatDate } from '@/core/format';
import { calcSafeToSpend, calcSurvival } from '@/core/finance';
import { cjBotService } from '@/core/cjBotService';
import type { CJBotResponse } from '@/core/cjBotTypes';
import {
  Card,
  StatTile,
  ProgressCard,
  CJBotInsightCard,
  CJDisclaimer,
  SectionLabel,
  Pill,
} from '@/components/ui';

export default function DashboardPage() {
  const store = useStore();
  const router = useRouter();
  const [insight, setInsight] = useState<CJBotResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const ctx = useMemo(() => store.buildFinanceContext(), [store]);
  const cur = store.settings.currency;
  const fmt = (n: number) => formatMoney(n, cur);

  const safe = useMemo(
    () =>
      calcSafeToSpend({
        cashAvailable: store.cashAvailable,
        bills: store.bills,
        debts: store.debts,
        settings: store.settings,
        goals: store.goals,
      }),
    [store.cashAvailable, store.bills, store.debts, store.settings, store.goals],
  );

  const survival = useMemo(
    () =>
      calcSurvival({
        cashAvailable: store.cashAvailable,
        bills: store.bills,
        debts: store.debts,
        settings: store.settings,
        goals: store.goals,
      }),
    [store.cashAvailable, store.bills, store.debts, store.settings, store.goals],
  );

  // The app is "empty" until the user enters their own numbers or imports a
  // statement. We show a get-started panel rather than a wall of zeros, and we
  // don't ask CJ-Bot to analyze nonexistent data.
  const hasData =
    store.transactions.length > 0 ||
    store.bills.length > 0 ||
    store.debts.length > 0 ||
    store.settings.startingCashBalance > 0;

  useEffect(() => {
    if (!hasData) {
      setLoading(false);
      setInsight(null);
      return;
    }
    let alive = true;
    setLoading(true);
    cjBotService
      .getDailyDashboardInsight(ctx)
      .then((r) => alive && setInsight(r))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.cashAvailable, hasData]);

  const rainy = store.goals.find((g) => g.type === 'rainy_day');
  const emergency = store.goals.find((g) => g.type === 'emergency');
  const retirement = store.goals.find((g) => g.type === 'retirement');

  const safeColor =
    safe.safeToSpend <= 0
      ? 'var(--danger)'
      : safe.safeToSpend < 60
      ? 'var(--warning)'
      : 'var(--success)';

  const recent = store.transactions.slice(0, 6);

  if (!hasData) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="page-title">Welcome to Freedom Ledger</div>
            <div className="page-subtitle">
              Your personal financial command center — empty and ready for your real numbers
            </div>
          </div>
          <Pill label={cur} />
        </div>

        <Card style={{ textAlign: 'center', padding: '40px 24px' }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 18,
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 18px',
            }}
          >
            <Wallet size={28} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>Nothing here yet — and that&apos;s on purpose</div>
          <div
            style={{
              color: 'var(--text-muted)',
              fontSize: 15,
              maxWidth: 460,
              margin: '8px auto 0',
              lineHeight: 1.5,
            }}
          >
            Freedom Ledger only ever shows your real money. Start by importing a bank statement, or
            enter your starting balance and income in Settings. CJ-Bot begins giving you guidance the
            moment it has real numbers to work with.
          </div>

          <div
            style={{
              display: 'flex',
              gap: 12,
              justifyContent: 'center',
              marginTop: 24,
              flexWrap: 'wrap',
            }}
          >
            <button className="btn btn-primary" onClick={() => router.push('/upload')}>
              <Upload size={16} /> Import a statement
            </button>
            <button className="btn btn-ghost" onClick={() => router.push('/settings')}>
              <SettingsIcon size={16} /> Enter my numbers
            </button>
          </div>
        </Card>

        <SectionLabel>What you&apos;ll track</SectionLabel>
        <div className="grid grid-3">
          <StatTile icon={<Wallet size={18} />} value="Safe to spend" label="What's truly yours today" tint="var(--accent)" />
          <StatTile icon={<Receipt size={18} />} value="Bills & runway" label="How long your cash lasts" tint="var(--warning)" />
          <StatTile icon={<TrendingDown size={18} />} value="The 3 funds" label="Rainy day, emergency, retirement" tint="var(--foundation)" />
        </div>

        <div className="disclaimer">
          Freedom Ledger is for personal finances only and stores everything locally in your browser.
          It shows only data you enter or import — never sample or placeholder numbers. CJ-Bot gives
          CPA-style guidance but is not a licensed CPA, attorney, or financial adviser.
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">Personal financial command center</div>
        </div>
        <Pill label={cur} />
      </div>

      {/* Hero — Safe to Spend */}
      <div className="hero">
        <div className="hero-label">SAFE TO SPEND TODAY</div>
        <div className="hero-amount" style={{ color: safeColor }}>
          {fmt(safe.safeToSpend)}
        </div>
        <div className="hero-sub">
          {fmt(safe.perDay)}/day for {safe.daysUntilIncome} day
          {safe.daysUntilIncome === 1 ? '' : 's'} until income · {fmt(store.cashAvailable)} on hand
        </div>
        <div className="hero-breakdown">
          <div className="hero-chip">
            <div className="v">{formatMoneyShort(safe.reservedForBills, cur)}</div>
            <div className="l">Bills held</div>
          </div>
          <div className="hero-chip">
            <div className="v">{formatMoneyShort(safe.reservedForFood, cur)}</div>
            <div className="l">Food reserve</div>
          </div>
          <div className="hero-chip">
            <div className="v">{formatMoneyShort(safe.reservedForDebt, cur)}</div>
            <div className="l">Debt mins</div>
          </div>
          <div className="hero-chip">
            <div className="v">{formatMoneyShort(safe.emergencyBuffer, cur)}</div>
            <div className="l">Buffer</div>
          </div>
        </div>
      </div>

      {/* CJ-Bot daily insight */}
      <CJBotInsightCard response={insight} loading={loading} role="CPA Analyst" />
      <CJDisclaimer />

      {/* Key stats */}
      <SectionLabel>Snapshot</SectionLabel>
      <div className="grid grid-4">
        <StatTile
          icon={<Wallet size={18} />}
          value={fmt(store.cashAvailable)}
          label="Cash available"
          tint="var(--accent)"
        />
        <StatTile
          icon={<Receipt size={18} />}
          value={fmt(ctx.upcomingBillsTotal)}
          label="Bills before income"
          tint="var(--warning)"
        />
        <StatTile
          icon={<TrendingDown size={18} />}
          value={fmt(ctx.monthlySpending)}
          label="Spent this month"
          tint="var(--danger)"
        />
        <StatTile
          icon={<CreditCard size={18} />}
          value={fmt(ctx.totalDebt)}
          label="Total debt"
          tint="var(--foundation)"
        />
      </div>

      {/* Survival runway */}
      <SectionLabel>Survival runway</SectionLabel>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800 }}>
              {survival.runwayDays} day{survival.runwayDays === 1 ? '' : 's'}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 2 }}>
              of runway · next income in {safe.daysUntilIncome} day
              {safe.daysUntilIncome === 1 ? '' : 's'}
            </div>
          </div>
          <Pill
            label={survival.status.toUpperCase()}
            color={
              survival.status === 'safe'
                ? 'var(--success)'
                : survival.status === 'tight'
                ? 'var(--warning)'
                : 'var(--danger)'
            }
          />
        </div>
      </Card>

      {/* Foundation funds */}
      <SectionLabel>The three funds</SectionLabel>
      <div className="grid grid-3">
        <ProgressCard
          title="Rainy Day"
          current={rainy?.currentAmount ?? 0}
          target={rainy?.targetAmount ?? 500}
          currencyFmt={fmt}
          tint="var(--success)"
        />
        <ProgressCard
          title="Emergency"
          current={emergency?.currentAmount ?? 0}
          target={emergency?.targetAmount ?? 1950}
          currencyFmt={fmt}
          tint="var(--accent)"
        />
        <ProgressCard
          title="Retirement"
          current={retirement?.currentAmount ?? 0}
          target={retirement?.targetAmount ?? 1000}
          currencyFmt={fmt}
          tint="var(--foundation)"
        />
      </div>

      {/* Recent transactions */}
      <SectionLabel>Recent activity</SectionLabel>
      <Card>
        {recent.length === 0 ? (
          <div className="empty">
            <div className="big">No transactions yet</div>
            <div>Import a statement to get started.</div>
          </div>
        ) : (
          recent.map((t) => {
            const isIn = t.type === 'income' || t.type === 'refund' || t.type === 'reimbursement';
            return (
              <div className="row" key={t.id}>
                <div className="row-main">
                  <div className="row-title">{t.description}</div>
                  <div className="row-sub">
                    {formatDate(t.date)} · {t.category}
                  </div>
                </div>
                <div
                  className="row-amount"
                  style={{ color: isIn ? 'var(--success)' : 'var(--text)' }}
                >
                  {isIn ? '+' : '−'}
                  {fmt(t.amount).replace('-', '')}
                </div>
              </div>
            );
          })
        )}
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 14 }}
          onClick={() => router.push('/transactions')}
        >
          View all transactions <ArrowRight size={15} />
        </button>
      </Card>
    </>
  );
}
