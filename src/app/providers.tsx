'use client';

import React, { useEffect } from 'react';
import { StoreProvider, useStore } from '@/core/useStore';
import { AppShell } from '@/components/AppShell';
import {
  setCJBotProvider,
  LlamaCJBotProvider,
  CJ_BOT_DEFAULT_ENDPOINT,
} from '@/core/cjBotService';

let cjStarted = false;
function initCJBot() {
  if (cjStarted) return;
  cjStarted = true;
  const live = process.env.NEXT_PUBLIC_CJBOT_LIVE === '1';
  if (!live) return;
  const endpoint = process.env.NEXT_PUBLIC_CJBOT_ENDPOINT || CJ_BOT_DEFAULT_ENDPOINT;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined;
  setCJBotProvider(new LlamaCJBotProvider(endpoint, anonKey));
}

function Gate({ children }: { children: React.ReactNode }) {
  const store = useStore();
  if (!store.ready) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
        }}
      >
        Loading your ledger…
      </div>
    );
  }
  return <AppShell>{children}</AppShell>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initCJBot();
  }, []);
  return (
    <StoreProvider>
      <Gate>{children}</Gate>
    </StoreProvider>
  );
}
