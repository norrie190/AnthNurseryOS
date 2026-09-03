'use client';

import { startTransition, useActionState, useEffect, useRef } from 'react';
import { changeWateringScheduleAction, recordWateringAction } from '../watering-actions';
import {
  initialRecordWateringState,
  initialScheduleState,
  type WateringFormState,
} from '../watering-form-state';
import styles from './plant-watering.module.css';

function Feedback<Fields extends string>({
  state,
  title,
  labels,
  feedbackRef,
  idPrefix = 'watering',
}: {
  state: WateringFormState<Fields>;
  title: string;
  labels: Record<Fields, string>;
  feedbackRef: React.RefObject<HTMLDivElement | null>;
  idPrefix?: string;
}) {
  if (!state.message) return null;
  return (
    <div
      ref={feedbackRef}
      tabIndex={-1}
      role={state.success ? 'status' : 'alert'}
      className={state.success ? styles.success : styles.errorSummary}
    >
      <p className={styles.feedbackTitle}>{state.success ? state.message : title}</p>
      {!state.success && <p>{state.message}</p>}
      {Object.keys(state.fieldErrors).length > 0 && (
        <ul>
          {(Object.entries(state.fieldErrors) as [Fields, string][]).map(([field, message]) => (
            <li key={field}>
              <a href={`#${idPrefix}-${field}`}>
                {labels[field]}: {message}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RecordWateringForm({
  plantId,
  defaultWateredAt,
}: {
  plantId: string;
  defaultWateredAt: string;
}) {
  const action = recordWateringAction.bind(null, plantId);
  const [state, formAction, pending] = useActionState(action, initialRecordWateringState);
  const submitting = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pending) {
      submitting.current = false;
      if (state.message) feedback.current?.focus();
    }
  }, [pending, state]);

  return (
    <form
      className={styles.form}
      action={formAction}
      noValidate
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || submitting.current) return;
        submitting.current = true;
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <h3>Record watering</h3>
      <p className={styles.hint}>
        Use the current time or enter an earlier watering. Times use Europe/London.
      </p>
      <Feedback
        state={state}
        title="Watering was not recorded"
        labels={{ wateredAt: 'Watered at', notes: 'Notes' }}
        feedbackRef={feedback}
      />
      <fieldset disabled={pending}>
        <legend className={styles.srOnly}>New watering details</legend>
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label htmlFor="watering-wateredAt">Watered at</label>
            <input
              id="watering-wateredAt"
              name="wateredAt"
              type="datetime-local"
              step="60"
              required
              defaultValue={defaultWateredAt}
              aria-invalid={!!state.fieldErrors.wateredAt}
              aria-describedby={
                state.fieldErrors.wateredAt ? 'watering-wateredAt-error' : 'watering-time-help'
              }
            />
            <p id="watering-time-help" className={styles.hint}>
              Future waterings cannot be recorded.
            </p>
            {state.fieldErrors.wateredAt && (
              <p id="watering-wateredAt-error" className={styles.fieldError}>
                {state.fieldErrors.wateredAt}
              </p>
            )}
          </div>
          <div className={styles.field}>
            <label htmlFor="watering-notes">
              Notes <span>(optional)</span>
            </label>
            <textarea
              id="watering-notes"
              name="notes"
              rows={3}
              aria-invalid={!!state.fieldErrors.notes}
              aria-describedby={state.fieldErrors.notes ? 'watering-notes-error' : undefined}
            />
            {state.fieldErrors.notes && (
              <p id="watering-notes-error" className={styles.fieldError}>
                {state.fieldErrors.notes}
              </p>
            )}
          </div>
        </div>
        <button className={styles.primaryButton} type="submit" disabled={pending}>
          {pending ? 'Recording…' : 'Record watering'}
        </button>
      </fieldset>
    </form>
  );
}

export function WateringScheduleForm({
  plantId,
  nurseryDate,
  currentIntervalDays,
}: {
  plantId: string;
  nurseryDate: string;
  currentIntervalDays: number | null;
}) {
  const action = changeWateringScheduleAction.bind(null, plantId);
  const [state, formAction, pending] = useActionState(action, initialScheduleState);
  const submitting = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pending) {
      submitting.current = false;
      if (state.message) feedback.current?.focus();
    }
  }, [pending, state]);

  return (
    <form
      className={styles.form}
      action={formAction}
      noValidate
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || submitting.current) return;
        submitting.current = true;
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <h3>{currentIntervalDays === null ? 'Configure watering' : 'Change watering schedule'}</h3>
      <p className={styles.hint}>
        A change preserves earlier schedule periods and any later scheduled successor.
      </p>
      <Feedback
        state={state}
        title="Schedule was not saved"
        labels={{ intervalDays: 'Interval', effectiveFrom: 'Effective from', notes: 'Notes' }}
        feedbackRef={feedback}
        idPrefix="watering-schedule"
      />
      <fieldset disabled={pending}>
        <legend className={styles.srOnly}>Watering schedule change details</legend>
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label htmlFor="watering-schedule-intervalDays">Interval (days)</label>
            <input
              id="watering-schedule-intervalDays"
              name="intervalDays"
              type="number"
              inputMode="numeric"
              min="1"
              max="365"
              step="1"
              required
              defaultValue={currentIntervalDays ?? ''}
              aria-invalid={!!state.fieldErrors.intervalDays}
              aria-describedby={
                state.fieldErrors.intervalDays ? 'watering-schedule-intervalDays-error' : undefined
              }
            />
            {state.fieldErrors.intervalDays && (
              <p id="watering-schedule-intervalDays-error" className={styles.fieldError}>
                {state.fieldErrors.intervalDays}
              </p>
            )}
          </div>
          <div className={styles.field}>
            <label htmlFor="watering-schedule-effectiveFrom">Effective from</label>
            <input
              id="watering-schedule-effectiveFrom"
              name="effectiveFrom"
              type="date"
              required
              defaultValue={nurseryDate}
              aria-invalid={!!state.fieldErrors.effectiveFrom}
              aria-describedby={
                state.fieldErrors.effectiveFrom
                  ? 'watering-schedule-effectiveFrom-error'
                  : 'watering-effective-help'
              }
            />
            <p id="watering-effective-help" className={styles.hint}>
              Defaults to today in Europe/London. A period already beginning on this date requires
              correction, which is not available here yet.
            </p>
            {state.fieldErrors.effectiveFrom && (
              <p id="watering-schedule-effectiveFrom-error" className={styles.fieldError}>
                {state.fieldErrors.effectiveFrom}
              </p>
            )}
          </div>
          <div className={`${styles.field} ${styles.fullWidth}`}>
            <label htmlFor="watering-schedule-notes">
              Notes <span>(optional)</span>
            </label>
            <textarea
              id="watering-schedule-notes"
              name="notes"
              rows={3}
              aria-invalid={!!state.fieldErrors.notes}
              aria-describedby={
                state.fieldErrors.notes ? 'watering-schedule-notes-error' : undefined
              }
            />
            {state.fieldErrors.notes && (
              <p id="watering-schedule-notes-error" className={styles.fieldError}>
                {state.fieldErrors.notes}
              </p>
            )}
          </div>
        </div>
        <button className={styles.primaryButton} type="submit" disabled={pending}>
          {pending
            ? 'Saving…'
            : currentIntervalDays === null
              ? 'Configure watering'
              : 'Save schedule change'}
        </button>
      </fieldset>
    </form>
  );
}
