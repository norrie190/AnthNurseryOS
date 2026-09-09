import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import Link from 'next/link';

import { DesktopNavigation, MobileNavigation } from './navigation';
import styles from './app-shell.module.css';

type AppShellProps = Readonly<{
  children: ReactNode;
}>;

export function AppShell({ children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <DesktopNavigation />

      <div className={styles.workspace}>
        <header className={styles.topBar}>
          <MobileNavigation />
          <div className={styles.desktopTopBar}>
            <p className={styles.context}>
              <span aria-hidden="true" />
              Your nursery workspace
            </p>
            <Link href="/plants/new" className={styles.quickAdd}>
              <Plus aria-hidden="true" size={18} />
              Add Plant
            </Link>
          </div>
        </header>

        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
