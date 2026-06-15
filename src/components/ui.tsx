'use client';

import React from 'react';
import type { CJBotResponse, RiskLevel } from '@/core/cjBotTypes';

const RISK_COLORS: Record<RiskLevel, string> = {
  safe: 'var(--risk-safe)',
  caution: 'var(--risk-caution)',
  risky: 'var(--risk-risky)',
  urgent: 'var(--risk-urgent)',
};

export function riskColor(level: RiskLevel): string {
  return RISK_COLORS[level];
}

export function Pill({
  label,
  color = 'var(--accent)',
}: {
  label: string;
  color?: string;
}) {
  return (
    <span
      className="pill"
      style={{ background: `${color}22`, color }}
    >
      {label}
    </span>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="section-label">{children}</div>;
}

export function Card({
  children,
  style,
  className,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div className={`card ${className ?? ''}`} style={style}>
      {children}
    </div>
  );
}

export function StatTile({
  icon,
  value,
  label,
  tint = 'var(--accent)',
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  tint?: string;
}) {
  return (
    <div className="stat-tile">
      <div className="icon" style={{ background: `${tint}22`, color: tint }}>
        {icon}
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function ProgressCard({
  title,
  current,
  target,
  currencyFmt,
  tint = 'var(--success)',
}: {
  title: string;
  current: number;
  target: number;
  currencyFmt: (n: number) => string;
  tint?: string;
}) {
  const pctVal = target > 0 ? Math.max(0, Math.min(1, current / target)) : 0;
  return (
    <div className="stat-tile">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
          {Math.round(pctVal * 100)}%
        </span>
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 6 }}>
        {currencyFmt(current)}{' '}
        <span style={{ fontSize: 13, color: 'var(--text-faint)', fontWeight: 600 }}>
          / {currencyFmt(target)}
        </span>
      </div>
      <div className="progress">
        <span style={{ width: `${pctVal * 100}%`, background: tint }} />
      </div>
    </div>
  );
}

const RISK_LABELS: Record<RiskLevel, string> = {
  safe: 'Safe',
  caution: 'Caution',
  risky: 'Risky',
  urgent: 'Urgent',
};

export function CJBotInsightCard({
  response,
  loading,
  role = 'CPA Analyst',
}: {
  response: CJBotResponse | null;
  loading?: boolean;
  role?: string;
}) {
  const tint = response ? riskColor(response.riskLevel) : 'var(--accent)';
  return (
    <div
      className="cj-card"
      style={{
        background: `${tint}12`,
        borderColor: `${tint}44`,
      }}
    >
      <div className="cj-head">
        <div className="cj-badge">CJ</div>
        <div className="cj-name">CJ-Bot · {role}</div>
        {response && (
          <span
            className="cj-risk"
            style={{ background: `${tint}26`, color: tint }}
          >
            {RISK_LABELS[response.riskLevel]}
          </span>
        )}
      </div>

      {loading || !response ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: '6px 0' }}>
          CJ-Bot is reading your numbers…
        </div>
      ) : (
        <>
          <div className="cj-summary">{response.summary}</div>
          <div className="cj-reco">{response.recommendation}</div>
          {response.actionItems.length > 0 && (
            <div className="cj-actions">
              {response.actionItems.map((a, i) => (
                <div className="cj-action" key={i}>
                  <span className="dot">→</span>
                  <span>{a}</span>
                </div>
              ))}
            </div>
          )}
          {response.explanation && <div className="cj-explain">{response.explanation}</div>}
        </>
      )}
    </div>
  );
}

export function CJDisclaimer() {
  return (
    <div className="disclaimer">
      CJ-Bot is an automated assistant that gives CPA-style guidance based on the numbers you
      enter. It is not a licensed CPA, attorney, tax preparer, or investment adviser, and it does
      not file taxes or give legal advice. Use its guidance to inform your own decisions.
    </div>
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="empty">
      <div className="big">{title}</div>
      {hint && <div>{hint}</div>}
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}
