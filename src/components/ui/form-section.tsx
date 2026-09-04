import type { ReactNode } from 'react';
import styles from './ui.module.css';

type FormSectionProps = Readonly<{
  title: string;
  description?: ReactNode;
  supporting?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}>;

export function FormSection({
  title,
  description,
  supporting,
  children,
  disabled,
  className,
}: FormSectionProps) {
  return (
    <fieldset
      className={[styles.formSection, className].filter(Boolean).join(' ')}
      disabled={disabled}
    >
      <legend>{title}</legend>
      {description ? <div className={styles.formSectionDescription}>{description}</div> : null}
      {children}
      {supporting ? <div className={styles.formSectionSupporting}>{supporting}</div> : null}
    </fieldset>
  );
}
