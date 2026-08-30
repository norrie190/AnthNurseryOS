import { ArrowRight } from 'lucide-react';

import styles from './page-placeholder.module.css';

type PagePlaceholderProps = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  nextStep: string;
}>;

export function PagePlaceholder({ eyebrow, title, description, nextStep }: PagePlaceholderProps) {
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <p>{eyebrow}</p>
        <h1>{title}</h1>
        <span>{description}</span>
      </header>

      <section className={styles.placeholder} aria-labelledby={`${title.toLowerCase()}-next-step`}>
        <span className={styles.placeholderIcon} aria-hidden="true">
          <ArrowRight size={22} strokeWidth={1.7} />
        </span>
        <div>
          <h2 id={`${title.toLowerCase()}-next-step`}>Ready for its feature stage</h2>
          <p>{nextStep}</p>
        </div>
      </section>
    </div>
  );
}
