'use client';

import Link from 'next/link';
import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import {
  initialPlantFormState,
  initialPlantFormValues,
  plantFieldLabels,
  plantStatusLabels,
  type PlantFormField,
  type PlantSelectOption,
  type PlantFormValues,
  type PlantFormState,
} from '../plant-form-state';
import { ParentSelector } from './parent-selector';
import styles from './plant-management.module.css';

export type PlantFormOptions = {
  parents: readonly PlantSelectOption[];
  locations: readonly PlantSelectOption[];
  currencies: readonly string[];
  parentageLocked?: boolean;
};

type PlantFormProps = PlantFormOptions & {
  action: (previous: PlantFormState, data: FormData) => Promise<PlantFormState>;
  initialValues?: PlantFormValues;
  edit?: { plantId: string; reference: string; hasPurchase: boolean };
};

export function PlantForm({
  parents,
  locations,
  currencies,
  parentageLocked = false,
  action,
  initialValues = initialPlantFormValues,
  edit,
}: PlantFormProps) {
  const [values, setValues] = useState({ ...initialValues });
  const [state, formAction, pending] = useActionState(action, initialPlantFormState);
  const submitting = useRef(false);
  const summary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pending) {
      submitting.current = false;
      if (state.message) summary.current?.focus();
    }
  }, [state, pending]);

  function change(field: PlantFormField, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
  }
  function control(field: PlantFormField) {
    return {
      id: `plant-${field}`,
      name: field,
      value: values[field],
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
      ) => change(field, event.target.value),
      'aria-invalid': !!state.fieldErrors[field],
      'aria-describedby': state.fieldErrors[field] ? `plant-${field}-error` : undefined,
    };
  }
  function error(field: PlantFormField) {
    return state.fieldErrors[field] ? (
      <p id={`plant-${field}-error`} className={styles.fieldError}>
        {state.fieldErrors[field]}
      </p>
    ) : null;
  }

  return (
    <form
      action={formAction}
      className={styles.form}
      noValidate
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (submitting.current || pending) return;
        submitting.current = true;
        // Dispatch explicitly so React does not reset parent/purchase choices on errors.
        // Capture the form before pending disables its controls.
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      {state.message && (
        <div
          ref={summary}
          tabIndex={-1}
          role="alert"
          className={styles.errorSummary}
          aria-labelledby="plant-error-title"
        >
          <h2 id="plant-error-title">Please check your Plant details</h2>
          <p>{state.message}</p>
          {state.stale && edit && (
            <p>
              <a href={`/plants/${edit.plantId}`} target="_blank" rel="noopener noreferrer">
                View latest Plant details (opens in a new tab)
              </a>
              . Your entries remain here; reload this edit page only when you are ready to replace
              them.
            </p>
          )}
          {Object.keys(state.fieldErrors).length > 0 && (
            <ul>
              {(Object.entries(state.fieldErrors) as [PlantFormField, string][]).map(
                ([field, message]) => (
                  <li key={field}>
                    <a
                      href={`#plant-${field}`}
                      onClick={(event) => {
                        const input = document.getElementById(`plant-${field}`);
                        if (input) {
                          event.preventDefault();
                          input.focus();
                        }
                      }}
                    >
                      {plantFieldLabels[field]}: {message}
                    </a>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      )}

      <fieldset className={styles.card} disabled={pending}>
        <legend>Plant details</legend>
        <p className={styles.sectionIntro}>Start with what you know. A name is optional.</p>
        <div className={styles.grid}>
          <div className={styles.field}>
            <label htmlFor="plant-name">
              Name <span>(optional)</span>
            </label>
            <input
              {...control('name')}
              autoComplete="off"
              placeholder="e.g. Anthurium crystallinum"
            />
            {error('name')}
          </div>
          <div className={styles.field}>
            <label htmlFor="plant-status">Status</label>
            <select {...control('status')}>
              {Object.entries(plantStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {error('status')}
          </div>
          <div className={styles.field}>
            <label htmlFor="plant-locationId">
              Location <span>(optional)</span>
            </label>
            <select
              {...control('locationId')}
              aria-describedby={
                [control('locationId')['aria-describedby'], locations.length ? '' : 'location-help']
                  .filter(Boolean)
                  .join(' ') || undefined
              }
            >
              <option value="">No location</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.label}
                </option>
              ))}
            </select>
            {locations.length === 0 && (
              <p id="location-help" className={styles.hint}>
                No Locations have been added yet. You can save without one.
              </p>
            )}
            {error('locationId')}
          </div>
          <div className={`${styles.field} ${styles.fullWidth}`}>
            <label htmlFor="plant-notes">
              Notes <span>(optional)</span>
            </label>
            <textarea {...control('notes')} rows={4} />
            {error('notes')}
          </div>
        </div>
      </fieldset>

      <fieldset className={styles.card} disabled={pending}>
        <legend>Parentage</legend>
        {parentageLocked ? (
          <p className={styles.hint}>
            Parentage is derived from this Plant’s recorded breeding provenance and cannot be edited
            here.
          </p>
        ) : (
          <>
            <p className={styles.sectionIntro}>
              Link a Plant in your collection, record an external name, or leave a parent unknown.
            </p>
            <div className={styles.grid}>
              <ParentSelector
                role="seed"
                emptyMessage={
                  edit
                    ? 'No other Plants are available as parents. Choose Unknown or enter an external name.'
                    : undefined
                }
                values={values}
                onChange={change}
                errors={state.fieldErrors}
                options={parents}
              />
              <ParentSelector
                role="pollen"
                emptyMessage={
                  edit
                    ? 'No other Plants are available as parents. Choose Unknown or enter an external name.'
                    : undefined
                }
                values={values}
                onChange={change}
                errors={state.fieldErrors}
                options={parents}
              />
            </div>
          </>
        )}
      </fieldset>

      <fieldset className={styles.card} disabled={pending}>
        <legend>Purchase information</legend>
        {edit?.hasPurchase ? (
          <>
            <input type="hidden" name="recordPurchase" value="on" />
            <p className={styles.hint}>
              A purchase is recorded for this Plant. Clear individual fields if their details are
              unknown; the purchase record will be kept.
            </p>
          </>
        ) : (
          <>
            <label className={styles.checkLabel} htmlFor="plant-recordPurchase">
              <input
                id="plant-recordPurchase"
                name="recordPurchase"
                type="checkbox"
                checked={values.recordPurchase === 'on'}
                onChange={(event) => change('recordPurchase', event.target.checked ? 'on' : '')}
                aria-describedby={
                  state.fieldErrors.recordPurchase ? 'plant-recordPurchase-error' : 'purchase-help'
                }
              />
              Record purchase information
            </label>
            <p className={styles.hint} id="purchase-help">
              Leave this off if you are not recording a purchase. You can record a purchase even if
              its details are unknown.
            </p>
            {error('recordPurchase')}
          </>
        )}
        {values.recordPurchase === 'on' && (
          <div className={`${styles.grid} ${styles.purchaseFields}`}>
            <div className={styles.field}>
              <label htmlFor="plant-seller">Seller</label>
              <input {...control('seller')} />
              {error('seller')}
            </div>
            <div className={styles.field}>
              <label htmlFor="plant-orderReference">Order reference</label>
              <input {...control('orderReference')} />
              {error('orderReference')}
            </div>
            <div className={styles.field}>
              <label htmlFor="plant-purchaseDate">Purchase date</label>
              <input {...control('purchaseDate')} type="date" />
              {error('purchaseDate')}
            </div>
            <div className={styles.field}>
              <label htmlFor="plant-currency">Currency</label>
              <select {...control('currency')}>
                {currencies.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency === 'GBP' ? 'GBP — British pound' : currency}
                  </option>
                ))}
              </select>
              {edit && (
                <p className={styles.hint}>
                  Changing currency uses the amounts entered below. It does not convert their value.
                </p>
              )}
              {error('currency')}
            </div>
            {(['plantPrice', 'shippingCost', 'otherCost'] as const).map((field) => (
              <div key={field} className={styles.field}>
                <label htmlFor={`plant-${field}`}>
                  {plantFieldLabels[field]} ({values.currency})
                </label>
                <div className={styles.moneyInput}>
                  <span aria-hidden="true">
                    {values.currency === 'GBP' ? '£' : values.currency}
                  </span>
                  <input
                    {...control(field)}
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-describedby={[control(field)['aria-describedby'], 'cost-help']
                      .filter(Boolean)
                      .join(' ')}
                  />
                </div>
                {error(field)}
              </div>
            ))}
            <p id="cost-help" className={`${styles.hint} ${styles.fullWidth}`}>
              Leave an amount blank if it is unknown. Enter 0 if there was no cost.
            </p>
          </div>
        )}
      </fieldset>

      <div className={styles.formFooter}>
        <p className={styles.hint} aria-live="polite">
          {pending
            ? 'Saving your Plant. Please wait.'
            : edit
              ? `Your reference ${edit.reference} will stay the same.`
              : 'Your ANT reference will be assigned when you save.'}
        </p>
        <div className={styles.actions}>
          <Link
            href={edit ? `/plants/${edit.plantId}` : '/plants'}
            className={styles.secondaryLink}
          >
            Cancel
          </Link>
          <button className={styles.primaryButton} type="submit" disabled={pending}>
            {pending
              ? edit
                ? 'Saving Changes…'
                : 'Saving Plant…'
              : edit
                ? 'Save Changes'
                : 'Save Plant'}
          </button>
        </div>
      </div>
    </form>
  );
}
