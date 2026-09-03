'use client';

import { startTransition, useActionState, useState } from 'react';
import { wateringHistoryAction } from '../watering-actions';
import { initialHistoryActionState } from '../watering-form-state';
import { nurseryDateTimeInputValue, sqlToDate } from '../../../lib/calendar-date';
import styles from './plant-watering.module.css';
import type { WateringHistoryEvent } from '../watering-event-queries';
import type { PlantWateringDetail } from '../watering-schedule-queries';

type HistoryFormProps = {
  plantId: string;
  kind: 'event' | 'schedule';
  mode: 'correct' | 'void';
  itemId: string;
  token: string;
  defaults: {
    wateredAt?: string;
    intervalDays?: number;
    effectiveFrom?: string;
    effectiveTo?: string;
    notes?: string;
  };
  onClose: () => void;
};

function HistoryForm({ plantId, kind, mode, itemId, token, defaults, onClose }: HistoryFormProps) {
  const [state, action, pending] = useActionState(
    wateringHistoryAction.bind(null, plantId, { kind, mode, itemId, token }),
    initialHistoryActionState,
  );
  const [confirm, setConfirm] = useState(false);
  const isVoid = mode === 'void';
  return (
    <form
      className={styles.inlineForm}
      action={action}
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(() => action(new FormData(event.currentTarget)));
      }}
    >
      {!isVoid && kind === 'event' && (
        <div className={styles.field}>
          <label htmlFor={`history-${itemId}-wateredAt`}>Watered at</label>
          <input
            id={`history-${itemId}-wateredAt`}
            name="wateredAt"
            type="datetime-local"
            step="60"
            defaultValue={defaults.wateredAt}
          />
        </div>
      )}
      {!isVoid && kind === 'schedule' && (
        <>
          <div className={styles.field}>
            <label htmlFor={`history-${itemId}-intervalDays`}>Interval (days)</label>
            <input
              id={`history-${itemId}-intervalDays`}
              name="intervalDays"
              type="number"
              min="1"
              max="365"
              step="1"
              defaultValue={defaults.intervalDays}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={`history-${itemId}-effectiveFrom`}>Effective from</label>
            <input
              id={`history-${itemId}-effectiveFrom`}
              name="effectiveFrom"
              type="date"
              defaultValue={defaults.effectiveFrom}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={`history-${itemId}-effectiveTo`}>Effective to (exclusive)</label>
            <input
              id={`history-${itemId}-effectiveTo`}
              name="effectiveTo"
              type="date"
              defaultValue={defaults.effectiveTo}
            />
          </div>
        </>
      )}
      {!isVoid && (
        <div className={styles.field}>
          <label htmlFor={`history-${itemId}-notes`}>Notes</label>
          <textarea
            id={`history-${itemId}-notes`}
            name="notes"
            rows={2}
            defaultValue={defaults.notes}
          />
        </div>
      )}
      <div className={styles.field}>
        <label htmlFor={`history-${itemId}-reason`}>Correction reason</label>
        <textarea
          id={`history-${itemId}-reason`}
          name="correctionReason"
          rows={2}
          required
          placeholder="This reason is retained with the record."
        />
      </div>
      {isVoid && (
        <p className={styles.hint}>
          Voiding retains this schedule period in history, removes it from watering calculations,
          and may intentionally leave a gap. Neighbouring periods are not extended automatically.
        </p>
      )}
      {isVoid && (
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />{' '}
          I understand this record remains in history but is excluded from calculations.
        </label>
      )}
      {state.message && (
        <div className={styles.errorSummary} role={state.success ? 'status' : 'alert'}>
          <p>{state.message}</p>
          {Object.entries(state.fieldErrors).map(([field, message]) => (
            <p key={field} className={styles.fieldError}>
              {message}
            </p>
          ))}
        </div>
      )}
      <div className={styles.actions}>
        <button
          className={styles.primaryButton}
          type="submit"
          disabled={pending || (isVoid && !confirm)}
        >
          {pending ? 'Saving…' : isVoid ? 'Confirm void' : 'Save correction'}
        </button>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={pending}
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function EventHistoryRow({
  plantId,
  event,
}: {
  plantId: string;
  event: WateringHistoryEvent;
}) {
  const [mode, setMode] = useState<'correct' | 'void' | null>(null);
  if (event.voidedAt) return null;
  return (
    <>
      {mode && (
        <HistoryForm
          plantId={plantId}
          kind="event"
          mode={mode}
          itemId={event.id}
          token={event.updatedAt.toISOString()}
          defaults={{
            wateredAt: nurseryDateTimeInputValue(event.wateredAt),
            notes: event.notes ?? '',
          }}
          onClose={() => setMode(null)}
        />
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.secondaryButton} onClick={() => setMode('correct')}>
          Correct
        </button>
        <button type="button" className={styles.secondaryButton} onClick={() => setMode('void')}>
          Void watering record
        </button>
      </div>
    </>
  );
}

export function ScheduleHistoryRow({
  plantId,
  period,
}: {
  plantId: string;
  period: PlantWateringDetail['periods'][number];
}) {
  const [mode, setMode] = useState<'correct' | 'void' | null>(null);
  if (period.voidedAt) return null;
  return (
    <>
      {mode && (
        <HistoryForm
          plantId={plantId}
          kind="schedule"
          mode={mode}
          itemId={period.id}
          token={period.updatedAt.toISOString()}
          defaults={{
            intervalDays: period.intervalDays,
            effectiveFrom: sqlToDate(period.effectiveFrom),
            effectiveTo: period.effectiveTo ? sqlToDate(period.effectiveTo) : '',
            notes: period.notes ?? '',
          }}
          onClose={() => setMode(null)}
        />
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.secondaryButton} onClick={() => setMode('correct')}>
          Correct schedule period
        </button>
        <button type="button" className={styles.secondaryButton} onClick={() => setMode('void')}>
          Void schedule period
        </button>
      </div>
    </>
  );
}
