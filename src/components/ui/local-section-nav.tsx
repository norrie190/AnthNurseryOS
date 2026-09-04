import type { ReactNode } from 'react';
import styles from './ui.module.css';

export type LocalSectionNavItem = Readonly<{
  href: string;
  label: ReactNode;
}>;

type LocalSectionNavProps = Readonly<{
  items: readonly LocalSectionNavItem[];
  ariaLabel: string;
  className?: string;
}>;

export function LocalSectionNav({ items, ariaLabel, className }: LocalSectionNavProps) {
  return (
    <nav
      className={[styles.localSectionNav, className].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
    >
      <ul>
        {items.map((item) => (
          <li key={item.href}>
            <a href={item.href}>{item.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
