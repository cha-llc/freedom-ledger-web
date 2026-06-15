import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Freedom Ledger — Personal Financial Command Center',
  description:
    'A local-first personal finance app with CJ-Bot, a CPA-style assistant that reads your statements, protects your cash flow, and builds your safety funds.',
};

export const viewport: Viewport = {
  themeColor: '#12141C',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
