import type { ReactNode } from 'react';

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
          <p className={styles.context}>Nursery operations</p>
        </header>

        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
