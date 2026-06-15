'use client';

import React, { useMemo, useRef, useState } from 'react';
import { useStore } from '@/core/useStore';
import { cjBotService } from '@/core/cjBotService';
import { CJ_BOT_ROLES, type CJBotRole, type CJBotResponse } from '@/core/cjBotTypes';
import { riskColor, CJDisclaimer } from '@/components/ui';
import { Send } from 'lucide-react';

interface ChatMsg {
  from: 'user' | 'cj';
  text: string;
  response?: CJBotResponse;
}

export default function AIPage() {
  const store = useStore();
  const ctx = useMemo(() => store.buildFinanceContext(), [store]);
  const [role, setRole] = useState<CJBotRole>('cpa_analyst');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      from: 'cj',
      text:
        "I'm CJ-Bot. I read your real numbers — cash, bills, debt, goals — and give you a straight CPA-style read. Ask me anything, like \"Can I afford a $90 trip expense?\" or pick a focus below.",
    },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send() {
    const msg = input.trim();
    if (!msg || busy) return;
    setInput('');
    setMessages((m) => [...m, { from: 'user', text: msg }]);
    setBusy(true);
    try {
      const r = await cjBotService.chatWithCJBot(role, msg, ctx);
      setMessages((m) => [...m, { from: 'cj', text: r.summary, response: r }]);
    } finally {
      setBusy(false);
      setTimeout(() => scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight), 50);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">CJ-Bot</div>
          <div className="page-subtitle">Your personal CPA-style financial brain</div>
        </div>
      </div>

      {/* Role selector */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {CJ_BOT_ROLES.map((r) => (
          <button
            key={r.role}
            className={`btn btn-sm ${role === r.role ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setRole(r.role)}
            title={r.blurb}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div
        ref={scrollRef}
        className="card"
        style={{ minHeight: 380, maxHeight: '56vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        {messages.map((m, i) =>
          m.from === 'user' ? (
            <div
              key={i}
              style={{
                alignSelf: 'flex-end',
                maxWidth: '78%',
                background: 'var(--accent)',
                color: '#0b1220',
                padding: '10px 14px',
                borderRadius: '14px 14px 4px 14px',
                fontWeight: 600,
              }}
            >
              {m.text}
            </div>
          ) : (
            <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '88%' }}>
              <div
                style={{
                  background: 'var(--card-alt)',
                  border: '1px solid var(--border)',
                  padding: '12px 14px',
                  borderRadius: '14px 14px 14px 4px',
                }}
              >
                {m.response ? (
                  <>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{m.response.summary}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: m.response.actionItems.length ? 10 : 0 }}>
                      {m.response.recommendation}
                    </div>
                    {m.response.actionItems.map((a, j) => (
                      <div key={j} style={{ display: 'flex', gap: 8, fontSize: 13, marginTop: 6 }}>
                        <span style={{ color: riskColor(m.response!.riskLevel), fontWeight: 800 }}>→</span>
                        <span>{a}</span>
                      </div>
                    ))}
                  </>
                ) : (
                  <span>{m.text}</span>
                )}
              </div>
            </div>
          ),
        )}
        {busy && (
          <div style={{ alignSelf: 'flex-start', color: 'var(--text-muted)', fontSize: 14 }}>
            CJ-Bot is thinking…
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <input
          className="input"
          placeholder="Ask CJ-Bot about your money…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button className="btn btn-primary" onClick={send} disabled={busy}>
          <Send size={16} />
        </button>
      </div>

      <CJDisclaimer />
    </>
  );
}
