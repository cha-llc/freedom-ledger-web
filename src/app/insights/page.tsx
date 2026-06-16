'use client';

import React, { useMemo } from 'react';
import { useStore } from '@/core/useStore';
import { formatMoney } from '@/core/format';
import {
  buildTemporalSnapshot,
  projectGoals,
  type TrendDirection,
} from '@/core/temporal';
import { Card, SectionLabel, Pill, EmptyState, CJDisclaimer } from '@/components/ui';
import { TrendingUp, TrendingDown, Minus, Calendar, Target } from 'lucide-react';

function trendIcon(t: TrendDirection) {
  if (t === 'rising') return <TrendingUp size={15} style={{ color: 'var(--danger)' }} />;
  if (t === 'falling') return <TrendingDown size={15} style={{ color: 'var(--success)' }} />;
  if (t === 'stable') return <Minus size={15} style={{ color: 'var(--text-muted)' }} />;
  return null;
}

export default function InsightsPage() {
  const store = useStore();
  const cur = store.settings.currency;
  const fmt = (n: number) => formatMoney(n, cur);

  const snap = useMemo(() => buildTemporalSnapshot(store.transactions), [store.transactions]);
  const goalProj = useMemo(
    () => projectGoals(store.goals, store.transactions),
    [store.goals, store.transactions],
  );

  // Empty / not-enough-history state — honest, never fabricated.
  if (snap.series.length === 0) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="page-title">Trends &amp; Projections</div>
            <div className="page-subtitle">History and forecasts from your real transactions</div>
          </div>
        </div>
        <Card>
          <EmptyState
            title="No history to analyze yet"
            hint="Import a few statements or add transactions across a couple of months, and your spending trends, projections, and fund timelines will appear here."
          />
        </Card>
      </>
    );
  }

  const maxBar = Math.max(...snap.series.map((p) => Math.max(p.spending, p.income)), 1);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Trends &amp; Projections</div>
          <div className="page-subtitle">
            {snap.monthsOfHistory > 0
              ? `Based on ${snap.monthsOfHistory} month${snap.monthsOfHistory === 1 ? '' : 's'} of your history`
              : 'Building from this month'}
          </div>
        </div>
        {snap.forecast.confidence !== 'none' && (
          <Pill
            label={`${snap.forecast.confidence} confidence`}
            color={
              snap.forecast.confidence === 'high'
                ? 'var(--success)'
                : snap.forecast.confidence === 'medium'
                ? 'var(--accent)'
                : 'var(--warning)'
            }
          />
        )}
      </div>

      {!snap.hasEnoughHistory && (
        <div className="disclaimer" style={{ marginTop: 0, marginBottom: 16 }}>
          You have less than two complete months of history, so projections below are early
          estimates. They sharpen with every month of real data.
        </div>
      )}

      {/* This month pacing */}
      <SectionLabel>This month so far</SectionLabel>
      <div className="grid grid-3">
        <Card>
          <div className="stat-label">Spent month-to-date</div>
          <div className="stat-value" style={{ marginTop: 4 }}>{fmt(snap.pace.monthToDateSpending)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
            day {snap.pace.daysElapsed} of {snap.pace.daysInMonth}
          </div>
        </Card>
        <Card>
          <div className="stat-label">Projected month-end</div>
          <div className="stat-value" style={{ marginTop: 4 }}>{fmt(snap.pace.projectedMonthEnd)}</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            {snap.pace.pace === 'no_baseline' ? (
              <span style={{ color: 'var(--text-faint)' }}>no baseline yet</span>
            ) : (
              <span
                style={{
                  color:
                    snap.pace.pace === 'ahead'
                      ? 'var(--danger)'
                      : snap.pace.pace === 'behind'
                      ? 'var(--success)'
                      : 'var(--text-muted)',
                }}
              >
                {snap.pace.vsAveragePct > 0 ? '+' : ''}
                {snap.pace.vsAveragePct}% vs average
              </span>
            )}
          </div>
        </Card>
        <Card>
          <div className="stat-label">Projected next month</div>
          <div className="stat-value" style={{ marginTop: 4 }}>{fmt(snap.forecast.projectedTotal)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
            from category trends
          </div>
        </Card>
      </div>

      {/* Month-by-month history chart */}
      <SectionLabel>Income vs spending by month</SectionLabel>
      <Card>
        <div style={{ display: 'flex', gap: 16, marginBottom: 14, fontSize: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: 'var(--success)' }} /> Income
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: 'var(--accent)' }} /> Spending
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', height: 180, overflowX: 'auto', paddingBottom: 4 }}>
          {snap.series.map((p) => (
            <div key={p.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 54, flex: 1 }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 140 }}>
                <div
                  title={`Income ${fmt(p.income)}`}
                  style={{
                    width: 16,
                    height: `${(p.income / maxBar) * 140}px`,
                    background: 'var(--success)',
                    borderRadius: '4px 4px 0 0',
                    minHeight: p.income > 0 ? 3 : 0,
                  }}
                />
                <div
                  title={`Spending ${fmt(p.spending)}`}
                  style={{
                    width: 16,
                    height: `${(p.spending / maxBar) * 140}px`,
                    background: 'var(--accent)',
                    borderRadius: '4px 4px 0 0',
                    minHeight: p.spending > 0 ? 3 : 0,
                  }}
                />
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                {p.label.replace(' ', "\u00A0")}
              </div>
            </div>
          ))}
        </div>
        {snap.hasEnoughHistory && (
          <div style={{ display: 'flex', gap: 20, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--divider)' }}>
            <div>
              <div className="stat-label">Avg monthly income</div>
              <div style={{ fontWeight: 800, fontSize: 17 }}>{fmt(snap.averageMonthlyIncome)}</div>
            </div>
            <div>
              <div className="stat-label">Avg monthly spending</div>
              <div style={{ fontWeight: 800, fontSize: 17 }}>{fmt(snap.averageMonthlySpending)}</div>
            </div>
            <div>
              <div className="stat-label">Avg monthly net</div>
              <div style={{ fontWeight: 800, fontSize: 17, color: snap.averageMonthlyIncome - snap.averageMonthlySpending >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {fmt(snap.averageMonthlyIncome - snap.averageMonthlySpending)}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Category trends + projection */}
      <SectionLabel>Spending by category — trend &amp; next-month projection</SectionLabel>
      <Card style={{ padding: 0 }}>
        {snap.topCategories.length === 0 ? (
          <div style={{ padding: 20 }}>
            <EmptyState title="No category history yet" hint="Categorized spending will show trends here." />
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', padding: '12px 18px', fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--divider)' }}>
              <div style={{ flex: 1 }}>Category</div>
              <div style={{ width: 110, textAlign: 'right' }}>Avg / mo</div>
              <div style={{ width: 90, textAlign: 'center' }}>Trend</div>
              <div style={{ width: 120, textAlign: 'right' }}>Next month</div>
            </div>
            {snap.topCategories.map((c) => {
              const proj = snap.forecast.byCategory.find((x) => x.category === c.category);
              return (
                <div key={c.category} style={{ display: 'flex', padding: '13px 18px', alignItems: 'center', borderBottom: '1px solid var(--divider)' }}>
                  <div style={{ flex: 1, fontWeight: 600 }}>{c.category}</div>
                  <div style={{ width: 110, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(c.average)}</div>
                  <div style={{ width: 90, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4 }}>
                    {trendIcon(c.trend)}
                    {c.trend !== 'insufficient' && c.trend !== 'stable' && (
                      <span style={{ fontSize: 11, color: c.trend === 'rising' ? 'var(--danger)' : 'var(--success)' }}>
                        {c.trendPctPerMonth > 0 ? '+' : ''}{c.trendPctPerMonth}%
                      </span>
                    )}
                  </div>
                  <div style={{ width: 120, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {proj ? fmt(proj.projectedNextMonth) : '—'}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </Card>

      {/* Goal projections */}
      <SectionLabel>When your funds reach their targets</SectionLabel>
      <div className="grid grid-3">
        {goalProj.map((g) => {
          const reached = g.monthsToTarget === 0;
          return (
            <Card key={g.goalId}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Target size={16} style={{ color: 'var(--foundation)' }} />
                <span style={{ fontWeight: 700 }}>{g.name}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
                {fmt(g.current)} / {fmt(g.target)}
              </div>
              {reached ? (
                <Pill label="Target reached" color="var(--success)" />
              ) : g.monthsToTarget != null ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Calendar size={15} style={{ color: 'var(--accent)' }} />
                  <span style={{ fontWeight: 700 }}>
                    {g.monthsToTarget < 12
                      ? `~${g.monthsToTarget} month${g.monthsToTarget === 1 ? '' : 's'}`
                      : `~${(g.monthsToTarget / 12).toFixed(1)} years`}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                    at {fmt(g.monthlyContribution)}/mo
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
                  Set a monthly amount to see a timeline.
                </div>
              )}
              {g.basis === 'observed' && g.monthsToTarget != null && !reached && (
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8 }}>
                  Based on your actual savings pace
                </div>
              )}
              {g.basis === 'target' && (
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8 }}>
                  Based on your monthly target
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Recurring charges */}
      {snap.recurring.length > 0 && (
        <>
          <SectionLabel>Recurring charges detected</SectionLabel>
          <Card>
            {snap.recurring.slice(0, 8).map((r, i) => (
              <div className="row" key={i}>
                <div className="row-main">
                  <div className="row-title">{r.label}</div>
                  <div className="row-sub">
                    {r.category} · seen in {r.monthsSeen} months · {r.occurrences} charges
                  </div>
                </div>
                <div className="row-amount">{fmt(r.typicalAmount)}</div>
              </div>
            ))}
          </Card>
        </>
      )}

      <CJDisclaimer />
    </>
  );
}
