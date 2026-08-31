'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  archiveEquipmentAction,
  restoreEquipmentAction,
  type EquipmentArchiveActionResult,
} from '../equipment-archive-actions';
import styles from './equipment-management.module.css';

type EquipmentArchiveControlsProps = {
  equipmentId: string;
  reference: string;
  archived: boolean;
  expectedUpdatedAt: string;
  hasOngoingPowerPeriod?: boolean;
};

export function EquipmentArchiveControls({
  equipmentId,
  reference,
  archived,
  expectedUpdatedAt,
  hasOngoingPowerPeriod = false,
}: EquipmentArchiveControlsProps) {
  const router = useRouter();
  const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
  const [result, setResult] = useState<EquipmentArchiveActionResult | null>(null);
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
    // refresh must not silently authorise an archive of a newer Equipment version.
    const token = restore ? expectedUpdatedAt : confirmationToken!;
    startTransition(async () => {
      try {
        const response = await (restore ? restoreEquipmentAction : archiveEquipmentAction)(
          equipmentId,
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
            'We could not confirm the archive state was changed. Reload the Equipment details to check before trying again.',
        });
      } finally {
        submitting.current = false;
      }
    });
  }

  return (
    <section
      className={styles.card}
      aria-labelledby="equipment-archive-heading"
      aria-busy={pending}
    >
      <h2 id="equipment-archive-heading">Collection visibility</h2>
      <p className={styles.sectionIntro}>
        {archived
          ? 'This Equipment is archived. Its details and historical relationships remain available.'
          : 'Archiving removes this Equipment from the active collection without deleting its details.'}
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
              <a href={`/equipment/${equipmentId}`}>Reload Equipment details</a>
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
          {pending ? 'Restoring Equipment…' : 'Restore Equipment'}
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
              This does not delete the Equipment. Its historical data stays intact, you can restore
              it later.
            </p>
            <input type="hidden" name="confirmation" value="archive" />
            {hasOngoingPowerPeriod && (
              <p>
                Archiving hides this item from the active inventory. Its recorded power settings
                will continue until you change or end them.
              </p>
            )}
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
                {pending ? 'Archiving Equipment…' : 'Confirm Archive'}
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
          Archive Equipment
        </button>
      )}
    </section>
  );
}
