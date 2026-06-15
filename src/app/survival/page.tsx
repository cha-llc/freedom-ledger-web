'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '@/core/useStore';
import { formatMoney } from '@/core/format';
import { calcSurvival } from '@/core/finance';
import { cjBotService } from '@/core/cjBotService';
import type { CJBotResponse } from '@/core/cjBotTypes';
import { Card, SectionLabel, CJBotInsightCard, CJDisclaimer, Pill } from '@/components/ui';

export default function SurvivalPage() {
  const store = useStore();
  const cur = store.settings.currency;
  const fmt = (n: number) => formatMoney(n, cur);
  const ctx = useMemo(() => store.buildFinanceContext(), [store]);

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

  const [insight, setInsight] = useState<CJBotResponse | null>(null);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    cjBotService.calculateSurvivalGuidance(ctx).then((r) => alive && setInsight(r)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.cashAvailable]);

  const statusColor =
    survival.status === 'safe' ? 'var(--success)' : survival.status === 'tight' ? 'var(--warning)' : 'var(--danger)';

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Survival</div>
          <div className="page-subtitle">How many days your cash lasts before the next income</div>
        </div>
      </div>

      <div className="hero" style={{ borderColor: statusColor }}>
        <div className="hero-label">RUNWAY</div>
        <div className="hero-amount" style={{ color: statusColor }}>
          {survival.runwayDays} <span style={{ fontSize: 24 }}>days</span>
        </div>
        <div className="hero-sub">
          Daily limit {fmt(survival.dailyLimit)} · {fmt(survival.upcomingBillsTotal)} in bills before income
        </div>
        <div style={{ marginTop: 16 }}>
          <Pill label={survival.status.toUpperCase()} color={statusColor} />
        </div>
      </div>

      <CJBotInsightCard response={insight} loading={loading} role="Survival Analyst" />
      <CJDisclaimer />

      <SectionLabel>The math</SectionLabel>
      <div className="grid grid-2">
        <Card>
          <div className="row"><div className="row-main"><div className="row-title">Minimum cash needed</div></div><div className="row-amount">{fmt(survival.minimumRequiredCash)}</div></div>
          <div className="row"><div className="row-main"><div className="row-title">Upcoming bills</div></div><div className="row-amount">{fmt(survival.upcomingBillsTotal)}</div></div>
        </Card>
        <Card>
          <div className="row"><div className="row-main"><div className="row-title">Cash available</div></div><div className="row-amount">{fmt(store.cashAvailable)}</div></div>
          <div className="row"><div className="row-main"><div className="row-title">Emergency gap</div></div><div className="row-amount" style={{ color: survival.emergencyGap > 0 ? 'var(--danger)' : 'var(--success)' }}>{fmt(survival.emergencyGap)}</div></div>
        </Card>
      </div>
    </>
  );
}
