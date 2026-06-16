'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Upload,
  Receipt,
  PieChart,
  Target,
  TrendingUp,
  CreditCard,
  ShieldAlert,
  Plane,
  Bot,
  Settings,
  ArrowDownToLine,
} from 'lucide-react';

const PRIMARY = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/upload', label: 'Import Statement', icon: Upload },
  { href: '/transactions', label: 'Transactions', icon: Receipt },
  { href: '/budget', label: 'Budget', icon: PieChart },
  { href: '/insights', label: 'Trends & Projections', icon: TrendingUp },
  { href: '/goals', label: 'Foundation', icon: Target },
];

const MANAGE = [
  { href: '/bills', label: 'Bills', icon: ArrowDownToLine },
  { href: '/debt', label: 'Debt', icon: CreditCard },
  { href: '/survival', label: 'Survival', icon: ShieldAlert },
  { href: '/travel', label: 'Travel', icon: Plane },
  { href: '/ai', label: 'CJ-Bot', icon: Bot },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const MOBILE_TABS = [
  { href: '/', label: 'Home', icon: LayoutDashboard },
  { href: '/insights', label: 'Trends', icon: TrendingUp },
  { href: '/budget', label: 'Budget', icon: PieChart },
  { href: '/goals', label: 'Funds', icon: Target },
  { href: '/ai', label: 'CJ-Bot', icon: Bot },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">Freedom Ledger</div>
          <div className="brand-sub">Personal command center</div>
        </div>

        {PRIMARY.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`nav-item ${isActive(href) ? 'active' : ''}`}
          >
            <Icon size={18} />
            {label}
          </Link>
        ))}

        <div className="nav-section">Manage</div>
        {MANAGE.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`nav-item ${isActive(href) ? 'active' : ''}`}
          >
            <Icon size={18} />
            {label}
          </Link>
        ))}

        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: 'var(--text-faint)', padding: '10px 12px' }}>
          Local-first · your data stays in this browser
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mobile-topbar">
          <div className="brand-name" style={{ fontSize: 17 }}>
            Freedom Ledger
          </div>
          <Link href="/settings" className="nav-item" style={{ padding: 6 }}>
            <Settings size={20} />
          </Link>
        </div>
        <main className="main">{children}</main>
      </div>

      <nav className="mobile-tabbar">
        {MOBILE_TABS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`mobile-tab ${isActive(href) ? 'active' : ''}`}
          >
            <Icon size={20} />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
