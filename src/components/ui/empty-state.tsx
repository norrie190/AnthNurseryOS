import type { ReactNode } from 'react';

import styles from './empty-state.module.css';

type EmptyStateProps = Readonly<{
  title: string;
  description?: string;
  action?: ReactNode;
}>;

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <section className={styles.empty} aria-labelledby="empty-state-title">
      <h2 id="empty-state-title">{title}</h2>
      {description ? <p>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </section>
  );
}
