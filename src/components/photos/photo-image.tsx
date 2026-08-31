'use client';

import { useState } from 'react';
import { ImageIcon } from 'lucide-react';
import styles from './photo-image.module.css';

export function PhotoImage({
  src,
  alt,
  prominent = false,
}: {
  src?: string;
  alt: string;
  prominent?: boolean;
}) {
  const [failedSource, setFailedSource] = useState<string>();
  if (!src || failedSource === src)
    return (
      <span
        className={styles.placeholder}
        role="img"
        aria-label={src ? `Photo unavailable: ${alt}` : 'No photo'}
      >
        <ImageIcon aria-hidden="true" size={24} />
        <span>{src ? 'Photo unavailable' : 'No photo'}</span>
      </span>
    );
  return (
    // Derivatives are already sized. Do not put private signed images through
    // Next's shared optimisation cache; onError also handles R2 delivery failures.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={styles.image}
      src={src}
      alt={alt}
      loading={prominent ? 'eager' : 'lazy'}
      referrerPolicy="no-referrer"
      onError={() => setFailedSource(src)}
    />
  );
}
