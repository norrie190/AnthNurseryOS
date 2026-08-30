import { Bell, Search, Sun } from 'lucide-react';
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

          <div className={styles.utilityBar}>
            <label className={styles.search} title="Search will be added in a later stage">
              <span className="visually-hidden">Search the nursery</span>
              <Search aria-hidden="true" size={18} strokeWidth={1.8} />
              <input type="search" placeholder="Search plants, notes and records..." disabled />
            </label>

            <button
              className={styles.utilityButton}
              type="button"
              aria-label="Notifications are not available yet"
              title="Notifications will be added later"
              disabled
            >
              <Bell aria-hidden="true" size={20} strokeWidth={1.7} />
            </button>
            <button
              className={styles.utilityButton}
              type="button"
              aria-label="Theme controls are not available yet"
              title="Theme controls will be added later"
              disabled
            >
              <Sun aria-hidden="true" size={21} strokeWidth={1.7} />
            </button>
          </div>
        </header>

        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
