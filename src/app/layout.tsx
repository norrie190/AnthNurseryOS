import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/app-shell/app-shell';

import './globals.css';

export const metadata: Metadata = {
  title: 'Anth Nursery OS',
  description: 'Plant nursery breeding and management system',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
