import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import styles from './ui.module.css';

export type InlineNoticeVariant = 'info' | 'success' | 'warning' | 'error';
type InlineNoticeProps = Readonly<{
  variant: InlineNoticeVariant;
  children: ReactNode;
  role?: HTMLAttributes<HTMLDivElement>['role'];
  tabIndex?: number;
  className?: string;
}>;

export const STALE_CONFLICT_MESSAGE =
  'This record changed since you opened it. Review the latest data before trying again.';

export const InlineNotice = forwardRef<HTMLDivElement, InlineNoticeProps>(function InlineNotice(
  { variant, children, role, tabIndex, className },
  ref,
) {
  const variantClass =
    `inlineNotice${variant[0].toUpperCase()}${variant.slice(1)}` as keyof typeof styles;
  return (
    <div
      ref={ref}
      className={[styles.inlineNotice, styles[variantClass], className].filter(Boolean).join(' ')}
      role={role}
      tabIndex={tabIndex}
    >
      {children}
    </div>
  );
});
