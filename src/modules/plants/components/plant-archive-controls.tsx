'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  archivePlantAction,
  restorePlantAction,
  type PlantArchiveActionResult,
} from '../plant-archive-actions';
import styles from './plant-management.module.css';

type PlantArchiveControlsProps = {
  plantId: string;
  reference: string;
  archived: boolean;
  expectedUpdatedAt: string;
};

export function PlantArchiveControls({
  plantId,
  reference,
  archived,
  expectedUpdatedAt,
}: PlantArchiveControlsProps) {
  const router = useRouter();
  const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
  const [result, setResult] = useState<PlantArchiveActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const confirmationWasOpen = useRef(false);
  const archiveButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const feedback = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (confirmationToken) cancelButton.current?.focus();
    else if (confirmationWasOpen.current) archiveButton.current?.focus();
    confirmationWasOpen.current = confirmationToken !== null;
  }, [confirmationToken]);
  useEffect(() => {
    if (result && !pending) feedback.current?.focus();
  }, [result, pending]);

  function submit(restore: boolean, data: FormData) {
    if (pending || submitting.current || (!restore && !confirmationToken)) return;
    submitting.current = true;
    setResult(null);
    // Capture the version shown when the archive confirmation opened. A background
    // refresh must not silently authorise an archive of a newer Plant version.
    const token = restore ? expectedUpdatedAt : confirmationToken!;
    startTransition(async () => {
      try {
        const response = await (restore ? restorePlantAction : archivePlantAction)(
          plantId,
          token,
          data,
        );
        setResult(response);
        if (response.success) {
          setConfirmationToken(null);
          startTransition(() => router.refresh());
        }
      } catch {
        // Also handle a failed transport before an action response reaches the browser.
        setResult({
          success: false,
          message:
            'We could not confirm the archive state was changed. Reload the Plant details to check before trying again.',
        });
      } finally {
        submitting.current = false;
      }
    });
  }

  return (
    <section className={styles.card} aria-labelledby="plant-archive-heading" aria-busy={pending}>
      <h2 id="plant-archive-heading">Collection visibility</h2>
      <p className={styles.sectionIntro}>
        {archived
          ? 'This Plant is archived. Its details and historical relationships remain available.'
          : 'Archiving removes this Plant from the active collection without changing its status.'}
      </p>
      {result && (
        <div
          ref={feedback}
          tabIndex={-1}
          role={result.success ? 'status' : 'alert'}
          className={result.success ? styles.archiveFeedback : styles.errorSummary}
        >
          <p>{result.message}</p>
          {result.stale && (
            <p>
              <a href={`/plants/${plantId}`}>Reload Plant details</a>
            </p>
          )}
        </div>
      )}
      {archived ? (
        <button
          type="button"
          className={styles.primaryButton}
          disabled={pending}
          onClick={() => submit(true, new FormData())}
        >
          {pending ? 'Restoring Plant…' : 'Restore Plant'}
        </button>
      ) : confirmationToken ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(false, new FormData(event.currentTarget));
          }}
        >
          <fieldset className={styles.archiveConfirmation} disabled={pending}>
            <legend>Archive {reference}?</legend>
            <p>
              This does not delete the Plant. Its historical data stays intact, its status stays the
              same, and you can restore it later.
            </p>
            <input type="hidden" name="confirmation" value="archive" />
            <div className={styles.actions}>
              <button
                ref={cancelButton}
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  setConfirmationToken(null);
                  setResult(null);
                }}
              >
                Cancel
              </button>
              <button type="submit" className={styles.primaryButton} disabled={pending}>
                {pending ? 'Archiving Plant…' : 'Confirm Archive'}
              </button>
            </div>
          </fieldset>
        </form>
      ) : (
        <button
          ref={archiveButton}
          type="button"
          className={styles.secondaryButton}
          disabled={pending}
          onClick={() => {
            setResult(null);
            setConfirmationToken(expectedUpdatedAt);
          }}
        >
          Archive Plant
        </button>
      )}
    </section>
  );
}
