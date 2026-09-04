import type { ReactNode } from 'react';
import styles from './ui.module.css';

type ActionBarProps = Readonly<{ children: ReactNode; className?: string }>;
export function ActionBar({ children, className }: ActionBarProps) {
  return <div className={[styles.actionBar, className].filter(Boolean).join(' ')}>{children}</div>;
}
