'use client';

import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { formatBreedingCross } from '../breeding-provenance';
import { formatGerminationProgress, formatSeedCount } from '../seed-batch-display';
import {
  changeInflorescenceStatusAction,
  changePollinationAttemptStatusAction,
  closeSeedBatchAction,
  correctInflorescenceAction,
  correctPollinationAttemptAction,
  correctSeedBatchAction,
  createInflorescenceAction,
  createPollinationAttemptAction,
  initialBreedingActionState,
  recordSeedBatchGerminationAction,
  recordSeedBatchHarvestAction,
  recordSeedBatchSowingAction,
  promoteSeedBatchPlantsAction,
  voidInflorescenceAction,
  voidPollinationAttemptAction,
  voidSeedBatchAction,
  type BreedingActionState,
} from '../breeding-actions';
import type { PlantBreedingDetail } from '../breeding-queries';
import styles from './plant-breeding.module.css';

const inflorescenceLabels = {
  OBSERVED: 'Observed',
  OPEN: 'Open',
  FINISHED: 'Finished',
  ABORTED: 'Aborted',
} as const;
const attemptLabels = {
  PENDING: 'Pending',
  DEVELOPING: 'Developing',
  FAILED: 'Failed',
  HARVESTED: 'Harvested',
} as const;
const batchLabels = {
  HARVESTED: 'Harvested',
  AWAITING_GERMINATION: 'Awaiting germination',
  GERMINATING: 'Germinating',
  EXHAUSTED: 'Exhausted',
  FAILED: 'Failed',
} as const;
const calendar = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' });
const dateValue = (date: Date | null) => date?.toISOString().slice(0, 10) ?? '';
const dateLabel = (date: Date | null) => (date ? calendar.format(date) : 'Not recorded');
const activePlant = (plant: { status: string; archivedAt: Date | null }) =>
  plant.archivedAt === null && (plant.status === 'GROWING' || plant.status === 'QUARANTINE');

type Action = (previous: BreedingActionState, formData: FormData) => Promise<BreedingActionState>;
function Feedback({ state }: { state: BreedingActionState }) {
  if (!state.message) return null;
  return (
    <div
      className={`${styles.feedback} ${state.success ? styles.success : styles.error}`}
      role={state.success ? 'status' : 'alert'}
    >
      <p>{state.message}</p>
      {Object.entries(state.fieldErrors).map(([field, message]) => (
        <p className={styles.errorText} key={field}>
          {field}: {message}
        </p>
      ))}
      {state.stale && <p>Reload the Plant details to review the current record.</p>}
    </div>
  );
}
function MutationForm({
  action,
  children,
  className = styles.form,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialBreedingActionState);
  const submitted = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pending) {
      submitted.current = false;
      if (state.message) feedback.current?.focus();
    }
  }, [pending, state]);
  return (
    <form
      className={className}
      action={formAction}
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || submitted.current) return;
        submitted.current = true;
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <div ref={feedback} tabIndex={-1}>
        <Feedback state={state} />
      </div>
      <fieldset disabled={pending}>{children}</fieldset>
    </form>
  );
}
function Field({
  id,
  label,
  children,
  hint,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}
function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}

function InflorescenceCreate({ plantId }: { plantId: string }) {
  return (
    <MutationForm action={createInflorescenceAction.bind(null, plantId)}>
      <h3>Record an inflorescence</h3>
      <p className={styles.hint}>
        Dates are observations in the nursery calendar. Future dates are not accepted.
      </p>
      <div className={styles.grid}>
        <Field id="breeding-emergedOn" label="Emerged on (optional)">
          <input id="breeding-emergedOn" name="emergedOn" type="date" />
        </Field>
        <Field id="breeding-openedOn" label="Opened on (optional)">
          <input id="breeding-openedOn" name="openedOn" type="date" />
        </Field>
        <Field id="breeding-inflorescence-notes" label="Notes (optional)">
          <textarea id="breeding-inflorescence-notes" name="notes" rows={2} />
        </Field>
      </div>
      <button className={styles.primary} type="submit">
        Record inflorescence
      </button>
    </MutationForm>
  );
}

function InflorescenceStatus({
  plantId,
  row,
}: {
  plantId: string;
  row: PlantBreedingDetail['inflorescences'][number];
}) {
  const options =
    row.status === 'OBSERVED'
      ? [
          ['OPEN', 'Mark open'],
          ['ABORTED', 'Mark aborted'],
        ]
      : row.status === 'OPEN'
        ? [
            ['FINISHED', 'Mark finished'],
            ['ABORTED', 'Mark aborted'],
          ]
        : [];
  return (
    <div className={styles.actions}>
      {options.map(([status, label]) => (
        <MutationForm
          key={status}
          action={changeInflorescenceStatusAction.bind(null, plantId, row.id)}
          className={styles.actions}
        >
          <Hidden name="status" value={status} />
          <Hidden name="expectedUpdatedAt" value={row.updatedAt.toISOString()} />
          <button className={styles.secondary} type="submit">
            {label}
          </button>
        </MutationForm>
      ))}
    </div>
  );
}

function InflorescenceMaintenance({
  plantId,
  row,
}: {
  plantId: string;
  row: PlantBreedingDetail['inflorescences'][number];
}) {
  const [open, setOpen] = useState(false);
  if (row.voidedAt) return null;
  const hasLiveAttempt = row.pollinationAttempts.some((attempt) => !attempt.voidedAt);
  return (
    <div className={styles.actions}>
      <button className={styles.secondary} type="button" onClick={() => setOpen(!open)}>
        {open ? 'Close correction' : 'Correct'}
      </button>
      {hasLiveAttempt ? (
        <p className={styles.hint}>
          This inflorescence has an active pollination record and cannot be voided.
        </p>
      ) : (
        <MutationForm
          action={voidInflorescenceAction.bind(null, plantId, row.id)}
          className={styles.actions}
        >
          <Hidden name="expectedUpdatedAt" value={row.updatedAt.toISOString()} />
          <input
            name="correctionReason"
            aria-label="Inflorescence void reason"
            placeholder="Reason retained with record"
            required
          />
          <button className={styles.secondary} type="submit">
            Void inflorescence
          </button>
        </MutationForm>
      )}
      {open && (
        <MutationForm action={correctInflorescenceAction.bind(null, plantId, row.id)}>
          <div className={styles.grid}>
            <Field id={`emerged-${row.id}`} label="Emerged on">
              <input
                id={`emerged-${row.id}`}
                name="emergedOn"
                type="date"
                defaultValue={dateValue(row.emergedOn)}
              />
            </Field>
            <Field id={`opened-${row.id}`} label="Opened on">
              <input
                id={`opened-${row.id}`}
                name="openedOn"
                type="date"
                defaultValue={dateValue(row.openedOn)}
              />
            </Field>
            <Field id={`status-${row.id}`} label="Historical status">
              <select id={`status-${row.id}`} name="status" defaultValue={row.status}>
                <option value="OBSERVED">Observed</option>
                <option value="OPEN">Open</option>
                <option value="FINISHED">Finished</option>
                <option value="ABORTED">Aborted</option>
              </select>
            </Field>
            <Field id={`notes-${row.id}`} label="Notes">
              <textarea
                id={`notes-${row.id}`}
                name="notes"
                rows={2}
                defaultValue={row.notes ?? ''}
              />
            </Field>
            <Field id={`reason-${row.id}`} label="Correction reason">
              <textarea
                id={`reason-${row.id}`}
                name="correctionReason"
                rows={2}
                required
                placeholder="This explanation is retained with the record."
              />
            </Field>
          </div>
          <Hidden name="expectedUpdatedAt" value={row.updatedAt.toISOString()} />
          <button className={styles.primary} type="submit">
            Save correction
          </button>
        </MutationForm>
      )}
    </div>
  );
}

function PollinationCreate({
  plantId,
  inflorescenceId,
  pollenPlants,
}: {
  plantId: string;
  inflorescenceId: string;
  pollenPlants: PlantBreedingDetail['pollenPlants'];
}) {
  const [mode, setMode] = useState('INTERNAL');
  return (
    <MutationForm action={createPollinationAttemptAction.bind(null, plantId, inflorescenceId)}>
      <h4>Record pollination</h4>
      <div className={styles.grid}>
        <Field id={`pollinated-${inflorescenceId}`} label="Pollinated on">
          <input id={`pollinated-${inflorescenceId}`} name="pollinatedOn" type="date" required />
        </Field>
        <Field id={`mode-${inflorescenceId}`} label="Pollen source">
          <select
            id={`mode-${inflorescenceId}`}
            name="pollenSourceMode"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            <option value="INTERNAL">Existing Plant</option>
            <option value="EXTERNAL">External parent</option>
            <option value="UNKNOWN">Unknown pollen</option>
          </select>
        </Field>
        {mode === 'INTERNAL' && (
          <Field id={`pollenPlant-${inflorescenceId}`} label="Pollen Plant">
            <select
              id={`pollenPlant-${inflorescenceId}`}
              name="pollenParentPlantId"
              required
              defaultValue={plantId}
            >
              <option value="">Choose a Plant</option>
              {pollenPlants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.reference} — {p.name || 'Unnamed Plant'}
                  {p.id === plantId ? ' (selfing)' : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
        {mode === 'EXTERNAL' && (
          <>
            <Field id={`pollenName-${inflorescenceId}`} label="External parent name/label">
              <input id={`pollenName-${inflorescenceId}`} name="pollenParentName" required />
            </Field>
            <Field id={`breeder-${inflorescenceId}`} label="Breeder/source (optional)">
              <input id={`breeder-${inflorescenceId}`} name="pollenBreeder" />
            </Field>
            <Field id={`cultivar-${inflorescenceId}`} label="Cultivar/clone (optional)">
              <input id={`cultivar-${inflorescenceId}`} name="pollenCultivar" />
            </Field>
          </>
        )}
        <Field id={`pollination-notes-${inflorescenceId}`} label="Notes (optional)">
          <textarea id={`pollination-notes-${inflorescenceId}`} name="notes" rows={2} />
        </Field>
      </div>
      <p className={styles.hint}>
        The owning Plant is always the seed parent. Selfing is valid; the owning Plant remains
        selectable as pollen.
      </p>
      <button className={styles.primary} type="submit">
        Record pollination
      </button>
    </MutationForm>
  );
}

function AttemptStatus({
  plantId,
  attempt,
}: {
  plantId: string;
  attempt: NonNullable<
    PlantBreedingDetail['inflorescences'][number]['pollinationAttempts'][number]
  >;
}) {
  const options =
    attempt.status === 'PENDING'
      ? [
          ['DEVELOPING', 'Mark developing'],
          ['FAILED', 'Mark failed'],
        ]
      : attempt.status === 'DEVELOPING'
        ? [['FAILED', 'Mark failed']]
        : [];
  return (
    <div className={styles.actions}>
      {options.map(([status, label]) => (
        <MutationForm
          key={status}
          action={changePollinationAttemptStatusAction.bind(null, plantId, attempt.id)}
          className={styles.actions}
        >
          <Hidden name="status" value={status} />
          <Hidden name="expectedUpdatedAt" value={attempt.updatedAt.toISOString()} />
          <button className={styles.secondary} type="submit">
            {label}
          </button>
        </MutationForm>
      ))}
    </div>
  );
}

function AttemptMaintenance({
  plantId,
  attempt,
}: {
  plantId: string;
  attempt: NonNullable<
    PlantBreedingDetail['inflorescences'][number]['pollinationAttempts'][number]
  >;
}) {
  const [open, setOpen] = useState(false);
  if (attempt.voidedAt) return null;
  const hasLiveBatch = attempt.seedBatches.some((batch) => !batch.voidedAt);
  const currentMode = attempt.pollenSourceMode;
  return (
    <div className={styles.actions}>
      <button className={styles.secondary} type="button" onClick={() => setOpen(!open)}>
        {open ? 'Close correction' : 'Correct'}
      </button>
      {hasLiveBatch ? (
        <p className={styles.hint}>
          Pollen provenance cannot be changed while this pollination has active seed batches.
        </p>
      ) : (
        <MutationForm
          action={voidPollinationAttemptAction.bind(null, plantId, attempt.id)}
          className={styles.actions}
        >
          <Hidden name="expectedUpdatedAt" value={attempt.updatedAt.toISOString()} />
          <input
            name="correctionReason"
            aria-label="Pollination void reason"
            placeholder="Reason retained with record"
            required
          />
          <button className={styles.secondary} type="submit">
            Void pollination
          </button>
        </MutationForm>
      )}
      {open && (
        <MutationForm action={correctPollinationAttemptAction.bind(null, plantId, attempt.id)}>
          <div className={styles.grid}>
            <Field id={`attempt-date-${attempt.id}`} label="Pollinated on">
              <input
                id={`attempt-date-${attempt.id}`}
                name="pollinatedOn"
                type="date"
                defaultValue={dateValue(attempt.pollinatedOn)}
              />
            </Field>
            <Field id={`attempt-status-${attempt.id}`} label="Historical status">
              <select
                id={`attempt-status-${attempt.id}`}
                name="status"
                defaultValue={attempt.status}
              >
                <option value="PENDING">Pending</option>
                <option value="DEVELOPING">Developing</option>
                <option value="FAILED">Failed</option>
                <option value="HARVESTED">Harvested</option>
              </select>
            </Field>
            {!hasLiveBatch && (
              <>
                <Field id={`attempt-mode-${attempt.id}`} label="Pollen source">
                  <select
                    id={`attempt-mode-${attempt.id}`}
                    name="pollenSourceMode"
                    defaultValue={currentMode}
                  >
                    <option value="INTERNAL">Existing Plant</option>
                    <option value="EXTERNAL">External parent</option>
                    <option value="UNKNOWN">Unknown pollen</option>
                  </select>
                </Field>
                <Field id={`attempt-name-${attempt.id}`} label="External parent label">
                  <input
                    id={`attempt-name-${attempt.id}`}
                    name="pollenParentName"
                    defaultValue={attempt.pollenParentName ?? ''}
                  />
                </Field>
              </>
            )}
            <Field id={`attempt-notes-${attempt.id}`} label="Notes">
              <textarea
                id={`attempt-notes-${attempt.id}`}
                name="notes"
                rows={2}
                defaultValue={attempt.notes ?? ''}
              />
            </Field>
            <Field id={`attempt-reason-${attempt.id}`} label="Correction reason">
              <textarea
                id={`attempt-reason-${attempt.id}`}
                name="correctionReason"
                rows={2}
                required
              />
            </Field>
          </div>
          <Hidden name="expectedUpdatedAt" value={attempt.updatedAt.toISOString()} />
          <button className={styles.primary} type="submit">
            Save correction
          </button>
        </MutationForm>
      )}
    </div>
  );
}

function SeedBatchControls({
  plantId,
  batch,
}: {
  plantId: string;
  batch: NonNullable<
    PlantBreedingDetail['inflorescences'][number]['pollinationAttempts'][number]
  >['seedBatches'][number];
}) {
  return (
    <div className={styles.actions}>
      {batch.status === 'HARVESTED' && !batch.voidedAt && (
        <MutationForm
          action={recordSeedBatchSowingAction.bind(null, plantId, batch.id)}
          className={styles.actions}
        >
          <Hidden name="expectedUpdatedAt" value={batch.updatedAt.toISOString()} />
          <input name="sownOn" type="date" aria-label="Sown on" required />
          <button className={styles.secondary} type="submit">
            Record sowing
          </button>
        </MutationForm>
      )}
      {(batch.status === 'AWAITING_GERMINATION' || batch.status === 'GERMINATING') &&
        !batch.voidedAt && (
          <MutationForm
            action={recordSeedBatchGerminationAction.bind(null, plantId, batch.id)}
            className={styles.actions}
          >
            <Hidden name="expectedUpdatedAt" value={batch.updatedAt.toISOString()} />
            <input
              name="germinatedCount"
              type="number"
              min="0"
              step="1"
              aria-label="Total germinated count"
              placeholder="Total germinated"
              required
            />
            <button className={styles.secondary} type="submit">
              Update germination
            </button>
          </MutationForm>
        )}
      {!batch.voidedAt && batch.status !== 'EXHAUSTED' && batch.status !== 'FAILED' && (
        <>
          <MutationForm
            action={closeSeedBatchAction.bind(null, plantId, batch.id)}
            className={styles.actions}
          >
            <Hidden name="expectedUpdatedAt" value={batch.updatedAt.toISOString()} />
            <Hidden name="status" value="EXHAUSTED" />
            <button className={styles.secondary} type="submit">
              Mark exhausted
            </button>
          </MutationForm>
          <MutationForm
            action={closeSeedBatchAction.bind(null, plantId, batch.id)}
            className={styles.actions}
          >
            <Hidden name="expectedUpdatedAt" value={batch.updatedAt.toISOString()} />
            <Hidden name="status" value="FAILED" />
            <button className={styles.secondary} type="submit">
              Mark failed
            </button>
          </MutationForm>
        </>
      )}
      {!batch.voidedAt && batch.promotion.promotedCount === 0 ? (
        <MutationForm
          action={voidSeedBatchAction.bind(null, plantId, batch.id)}
          className={styles.actions}
        >
          <Hidden name="expectedUpdatedAt" value={batch.updatedAt.toISOString()} />
          <input
            name="correctionReason"
            aria-label="SeedBatch void reason"
            placeholder="Reason retained with record"
            required
          />
          <button className={styles.secondary} type="submit">
            Void SeedBatch
          </button>
        </MutationForm>
      ) : !batch.voidedAt ? (
        <p className={styles.hint}>
          This SeedBatch has promoted Plant descendants and cannot be voided; provenance must be
          retained.
        </p>
      ) : null}
    </div>
  );
}

function SeedBatchCorrection({
  plantId,
  batch,
}: {
  plantId: string;
  batch: NonNullable<
    PlantBreedingDetail['inflorescences'][number]['pollinationAttempts'][number]
  >['seedBatches'][number];
}) {
  const [open, setOpen] = useState(false);
  if (batch.voidedAt) return null;
  return (
    <>
      <button className={styles.secondary} type="button" onClick={() => setOpen(!open)}>
        {open ? 'Close correction' : 'Correct SeedBatch'}
      </button>
      {open && (
        <MutationForm action={correctSeedBatchAction.bind(null, plantId, batch.id)}>
          <div className={styles.grid}>
            <Field id={`batch-harvested-${batch.id}`} label="Harvested on">
              <input
                id={`batch-harvested-${batch.id}`}
                name="harvestedOn"
                type="date"
                defaultValue={dateValue(batch.harvestedOn)}
              />
            </Field>
            <Field id={`batch-sown-${batch.id}`} label="Sown on">
              <input
                id={`batch-sown-${batch.id}`}
                name="sownOn"
                type="date"
                defaultValue={dateValue(batch.sownOn)}
              />
            </Field>
            <Field id={`batch-seed-count-${batch.id}`} label="Seed count">
              <input
                id={`batch-seed-count-${batch.id}`}
                name="seedCount"
                type="number"
                min="0"
                step="1"
                defaultValue={batch.seedCount ?? ''}
              />
            </Field>
            <Field id={`batch-germinated-${batch.id}`} label="Germinated count">
              <input
                id={`batch-germinated-${batch.id}`}
                name="germinatedCount"
                type="number"
                min="0"
                step="1"
                defaultValue={batch.germinatedCount ?? ''}
              />
            </Field>
            <Field id={`batch-status-${batch.id}`} label="Historical status">
              <select id={`batch-status-${batch.id}`} name="status" defaultValue={batch.status}>
                {Object.entries(batchLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`batch-notes-${batch.id}`} label="Notes">
              <textarea
                id={`batch-notes-${batch.id}`}
                name="notes"
                rows={2}
                defaultValue={batch.notes ?? ''}
              />
            </Field>
            <Field id={`batch-reason-${batch.id}`} label="Correction reason">
              <textarea id={`batch-reason-${batch.id}`} name="correctionReason" rows={2} required />
            </Field>
          </div>
          <Hidden name="expectedUpdatedAt" value={batch.updatedAt.toISOString()} />
          <button className={styles.primary} type="submit">
            Save correction
          </button>
        </MutationForm>
      )}
    </>
  );
}

function HarvestForm({
  plantId,
  attempt,
}: {
  plantId: string;
  attempt: NonNullable<
    PlantBreedingDetail['inflorescences'][number]['pollinationAttempts'][number]
  >;
}) {
  return (
    <MutationForm action={recordSeedBatchHarvestAction.bind(null, plantId, attempt.id)}>
      <h4>Record seed harvest</h4>
      <div className={styles.grid}>
        <Field id={`harvest-date-${attempt.id}`} label="Harvested on">
          <input id={`harvest-date-${attempt.id}`} name="harvestedOn" type="date" required />
        </Field>
        <Field
          id={`seed-count-${attempt.id}`}
          label="Seed count (optional)"
          hint="Leave blank when unknown; enter 0 only when explicitly counted."
        >
          <input id={`seed-count-${attempt.id}`} name="seedCount" type="number" min="0" step="1" />
        </Field>
        <Field id={`harvest-notes-${attempt.id}`} label="Notes (optional)">
          <textarea id={`harvest-notes-${attempt.id}`} name="notes" rows={2} />
        </Field>
      </div>
      <Hidden name="expectedPollinationUpdatedAt" value={attempt.updatedAt.toISOString()} />
      <button className={styles.primary} type="submit">
        Record seed harvest
      </button>
    </MutationForm>
  );
}

function Attempt({
  plantId,
  owner,
  attempt,
  locations,
}: {
  plantId: string;
  owner: { reference: string };
  attempt: NonNullable<
    PlantBreedingDetail['inflorescences'][number]['pollinationAttempts'][number]
  >;
  locations: PlantBreedingDetail['locations'];
}) {
  return (
    <div className={styles.subrecord}>
      <div className={styles.recordHeader}>
        <strong>Pollination</strong>
        <span className={styles.badge}>
          {attempt.voidedAt ? 'Voided' : attemptLabels[attempt.status]}
        </span>
      </div>
      <dl className={styles.details}>
        <div>
          <dt>Pollinated</dt>
          <dd>{dateLabel(attempt.pollinatedOn)}</dd>
        </div>
        <div className={styles.full}>
          <dt>Cross</dt>
          <dd className={styles.source}>
            {formatBreedingCross(owner, {
              pollenSourceMode: attempt.pollenSourceMode,
              pollenParent: attempt.pollenParent,
              pollenParentName: attempt.pollenParentName,
            })}
          </dd>
        </div>
        {attempt.pollenBreeder && (
          <div>
            <dt>Breeder/source</dt>
            <dd>{attempt.pollenBreeder}</dd>
          </div>
        )}
        {attempt.pollenCultivar && (
          <div>
            <dt>Cultivar/clone</dt>
            <dd>{attempt.pollenCultivar}</dd>
          </div>
        )}
        <div className={styles.full}>
          <dt>Notes</dt>
          <dd>{attempt.notes || 'Not recorded'}</dd>
        </div>
      </dl>
      {attempt.voidedAt ? (
        <p className={styles.reason}>Void reason: {attempt.correctionReason}</p>
      ) : (
        <>
          <AttemptStatus plantId={plantId} attempt={attempt} />
          <AttemptMaintenance plantId={plantId} attempt={attempt} />
          {attempt.status !== 'FAILED' && <HarvestForm plantId={plantId} attempt={attempt} />}
        </>
      )}
      {attempt.seedBatches.length ? (
        <div className={styles.history}>
          <h4>Seed batches</h4>
          {attempt.seedBatches.map((batch) => (
            <SeedBatch key={batch.id} plantId={plantId} batch={batch} locations={locations} />
          ))}
        </div>
      ) : (
        <p className={styles.empty}>No seed harvest recorded.</p>
      )}
    </div>
  );
}
function PromotionForm({
  plantId,
  batch,
  locations,
}: {
  plantId: string;
  batch: NonNullable<
    PlantBreedingDetail['inflorescences'][number]['pollinationAttempts'][number]
  >['seedBatches'][number];
  locations: PlantBreedingDetail['locations'];
}) {
  if (batch.promotion.eligibility !== 'ELIGIBLE') return null;
  return (
    <MutationForm action={promoteSeedBatchPlantsAction.bind(null, plantId, batch.id)}>
      <h4>Promote seedlings to Plants</h4>
      <p className={styles.hint}>
        {batch.promotion.remainingCapacity} seedlings remain available. Each Plant receives its own
        ANT reference and derived Parentage. This atomic operation does not mark the batch
        exhausted.
      </p>
      <div className={styles.grid}>
        <Field id={`promotion-quantity-${batch.id}`} label="Quantity">
          <input
            id={`promotion-quantity-${batch.id}`}
            name="quantity"
            type="number"
            min="1"
            max={batch.promotion.remainingCapacity ?? undefined}
            step="1"
            required
          />
        </Field>
        <Field id={`promotion-status-${batch.id}`} label="Initial status">
          <select id={`promotion-status-${batch.id}`} name="status" defaultValue="GROWING">
            <option value="GROWING">Growing</option>
            <option value="QUARANTINE">Quarantine</option>
          </select>
        </Field>
        <Field id={`promotion-location-${batch.id}`} label="Location (optional)">
          <select id={`promotion-location-${batch.id}`} name="locationId" defaultValue="">
            <option value="">No Location</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`promotion-notes-${batch.id}`} label="Notes (optional)">
          <textarea id={`promotion-notes-${batch.id}`} name="notes" rows={2} />
        </Field>
      </div>
      <Hidden name="expectedUpdatedAt" value={batch.updatedAt.toISOString()} />
      <p className={styles.hint}>
        Create Plants from this SeedBatch? Parentage is derived automatically from the recorded
        cross.
      </p>
      <button className={styles.primary} type="submit">
        Promote seedlings
      </button>
    </MutationForm>
  );
}

function SeedBatch({
  plantId,
  batch,
  locations,
}: {
  plantId: string;
  batch: NonNullable<
    PlantBreedingDetail['inflorescences'][number]['pollinationAttempts'][number]
  >['seedBatches'][number];
  locations: PlantBreedingDetail['locations'];
}) {
  return (
    <div className={`${styles.subrecord} ${batch.voidedAt ? styles.voided : ''}`}>
      <div className={styles.recordHeader}>
        <strong>SeedBatch</strong>
        <span className={styles.badge}>
          {batch.voidedAt ? 'Voided' : batchLabels[batch.status]}
        </span>
      </div>
      <div className={styles.promotion}>
        <strong>Promotion</strong>
        {batch.germinatedCount === null ? (
          <p className={styles.hint}>Record germination before promoting seedlings.</p>
        ) : (
          <p className={styles.hint}>
            {batch.promotion.promotedCount} of {batch.germinatedCount} seedlings promoted ·{' '}
            {batch.promotion.remainingCapacity} remaining
          </p>
        )}
        {batch.promotion.promotedPlants.length > 0 && (
          <ul className={styles.promotedList}>
            {batch.promotion.promotedPlants.map((plant) => (
              <li key={plant.id}>
                <a href={`/plants/${plant.id}`}>{plant.reference}</a> —{' '}
                {plant.name || 'Unnamed Plant'} ·{' '}
                {plant.status === 'QUARANTINE'
                  ? 'Quarantine'
                  : plant.status === 'GROWING'
                    ? 'Growing'
                    : plant.status}
                {plant.archivedAt ? ' · Archived' : ''}
                {plant.location?.name ? ` · ${plant.location.name}` : ''}
              </li>
            ))}
          </ul>
        )}
        {batch.promotion.eligibility === 'CAPACITY' && (
          <p className={styles.hint}>
            All recorded germinated seedlings have already been promoted.
          </p>
        )}
        {batch.promotion.eligibility === 'GERMINATION_UNKNOWN' && (
          <p className={styles.hint}>Record germination before promoting seedlings.</p>
        )}
        {batch.promotion.eligibility === 'NO_GERMINATION' && (
          <p className={styles.hint}>No seedlings have been recorded as germinated.</p>
        )}
        {batch.promotion.eligibility === 'STATUS' && (
          <p className={styles.hint}>This SeedBatch cannot be promoted in its current state.</p>
        )}
        {batch.promotion.eligibility === 'VOIDED' && (
          <p className={styles.hint}>Voided SeedBatches cannot produce new Plants.</p>
        )}
        <PromotionForm plantId={plantId} batch={batch} locations={locations} />
      </div>
      <dl className={styles.details}>
        <div>
          <dt>Harvested</dt>
          <dd>{dateLabel(batch.harvestedOn)}</dd>
        </div>
        <div>
          <dt>Sown</dt>
          <dd>{dateLabel(batch.sownOn)}</dd>
        </div>
        <div>
          <dt>Seed count</dt>
          <dd>{formatSeedCount(batch.seedCount)}</dd>
        </div>
        <div className={styles.full}>
          <dt>Germination</dt>
          <dd>{formatGerminationProgress(batch.germinatedCount, batch.seedCount)}</dd>
        </div>
        <div className={styles.full}>
          <dt>Notes</dt>
          <dd>{batch.notes || 'Not recorded'}</dd>
        </div>
      </dl>
      {batch.correctionReason && (
        <p className={styles.reason}>
          {batch.voidedAt ? 'Void' : 'Correction'} reason: {batch.correctionReason}
        </p>
      )}
      {!batch.voidedAt && (
        <>
          <SeedBatchControls plantId={plantId} batch={batch} />
          <SeedBatchCorrection plantId={plantId} batch={batch} />
        </>
      )}
    </div>
  );
}

export function PlantBreedingWorkflow({
  plant,
  detail,
}: {
  plant: {
    id: string;
    reference: string;
    name: string | null;
    status: string;
    archivedAt: Date | null;
  };
  detail: PlantBreedingDetail;
}) {
  const canCreate = activePlant(plant);
  return (
    <section className={`${styles.section} ${styles.form}`} aria-labelledby="breeding-heading">
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.hint}>Breeding history</p>
          <h2 id="breeding-heading">Breeding</h2>
        </div>
      </div>
      <p className={styles.intro}>
        Inflorescences, pollination provenance, and retained seed-batch history for{' '}
        {plant.reference}.
      </p>
      {canCreate ? (
        <InflorescenceCreate plantId={plant.id} />
      ) : (
        <p className={styles.notice}>
          New inflorescences and pollinations are unavailable for this Plant’s current lifecycle
          state. Existing breeding history remains available for completion and correction.
        </p>
      )}
      {detail.inflorescences.length ? (
        <div className={styles.history}>
          {detail.inflorescences.map((row) => {
            const liveAttempt = row.pollinationAttempts.find((attempt) => !attempt.voidedAt);
            const canPollinate =
              canCreate &&
              !row.voidedAt &&
              row.status !== 'FINISHED' &&
              row.status !== 'ABORTED' &&
              !liveAttempt;
            return (
              <article
                className={`${styles.record} ${row.voidedAt ? styles.voided : ''}`}
                key={row.id}
              >
                <div className={styles.recordHeader}>
                  <strong>Inflorescence</strong>
                  <span className={styles.badge}>
                    {row.voidedAt ? 'Voided' : inflorescenceLabels[row.status]}
                  </span>
                </div>
                <dl className={styles.details}>
                  <div>
                    <dt>Emerged</dt>
                    <dd>{dateLabel(row.emergedOn)}</dd>
                  </div>
                  <div>
                    <dt>Opened</dt>
                    <dd>{dateLabel(row.openedOn)}</dd>
                  </div>
                  <div className={styles.full}>
                    <dt>Notes</dt>
                    <dd>{row.notes || 'Not recorded'}</dd>
                  </div>
                </dl>
                {row.correctionReason && (
                  <p className={styles.reason}>
                    {row.voidedAt ? 'Void' : 'Correction'} reason: {row.correctionReason}
                  </p>
                )}
                {!row.voidedAt && (
                  <>
                    <InflorescenceStatus plantId={plant.id} row={row} />
                    <InflorescenceMaintenance plantId={plant.id} row={row} />
                    {canPollinate && (
                      <PollinationCreate
                        plantId={plant.id}
                        inflorescenceId={row.id}
                        pollenPlants={detail.pollenPlants}
                      />
                    )}
                    {!liveAttempt &&
                      !canPollinate &&
                      row.status !== 'FINISHED' &&
                      row.status !== 'ABORTED' && (
                        <p className={styles.notice}>
                          New pollination is unavailable because this Plant is not eligible for new
                          breeding records.
                        </p>
                      )}
                  </>
                )}
                {row.pollinationAttempts.length ? (
                  <div className={styles.nested}>
                    {row.pollinationAttempts.map((attempt) => (
                      <Attempt
                        key={attempt.id}
                        plantId={plant.id}
                        owner={plant}
                        attempt={attempt}
                        locations={detail.locations}
                      />
                    ))}
                  </div>
                ) : (
                  <p className={styles.empty}>No pollination recorded.</p>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <p className={styles.empty}>No inflorescences recorded yet.</p>
      )}
    </section>
  );
}
