import type { ReactNode } from 'react';

import styles from './status-badge.module.css';

export type StatusBadgeVariant = 'neutral' | 'success' | 'attention' | 'danger' | 'info';

type StatusBadgeProps = Readonly<{
  children: ReactNode;
  variant?: StatusBadgeVariant;
}>;

export function StatusBadge({ children, variant = 'neutral' }: StatusBadgeProps) {
  return <span className={`${styles.badge} ${styles[variant]}`}>{children}</span>;
}
