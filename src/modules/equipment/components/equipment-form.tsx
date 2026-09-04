'use client';

import Link from 'next/link';
import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { createEquipmentAction, updateEquipmentAction } from '../equipment-actions';
import { suggestedEquipmentCategories } from '../equipment-input';
import {
  equipmentFieldLabels,
  initialEquipmentFormState,
  initialEquipmentFormValues,
  type EquipmentFormField,
  type EquipmentFormValues,
  type EquipmentLocationOption,
} from '../equipment-form-state';
import styles from './equipment-management.module.css';
import { ActionBar } from '../../../components/ui/action-bar';
import { FormSection } from '../../../components/ui/form-section';
import { InlineNotice, STALE_CONFLICT_MESSAGE } from '../../../components/ui/inline-notice';

type EquipmentFormProps = {
  locations: readonly EquipmentLocationOption[];
  currencies: readonly string[];
  initialValues?: EquipmentFormValues;
  edit?: { equipmentId: string; reference: string; expectedUpdatedAt: string };
};
export function EquipmentForm({
  locations,
  currencies,
  initialValues = initialEquipmentFormValues,
  edit,
}: EquipmentFormProps) {
  // Keep the original token paired with retained inputs across server refreshes.
  const [opened] = useState({ initialValues, edit });
  const [values, setValues] = useState({ ...opened.initialValues });
  const action = opened.edit
    ? updateEquipmentAction.bind(null, opened.edit.equipmentId, opened.edit.expectedUpdatedAt)
    : createEquipmentAction;
  const [state, formAction, pending] = useActionState(action, initialEquipmentFormState);
  const submitting = useRef(false);
  const summary = useRef<HTMLDivElement>(null);
  const hasPurchase = !!opened.edit && opened.initialValues.recordPurchase === 'on';
  useEffect(() => {
    if (!pending) {
      submitting.current = false;
      if (state.message) summary.current?.focus();
    }
  }, [state, pending]);
  function change(field: EquipmentFormField, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
  }
  function control(field: EquipmentFormField, help?: string) {
    return {
      id: `equipment-${field}`,
      name: field,
      value: values[field],
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
      ) => change(field, event.target.value),
      'aria-invalid': !!state.fieldErrors[field],
      'aria-describedby':
        [state.fieldErrors[field] ? `equipment-${field}-error` : '', help]
          .filter(Boolean)
          .join(' ') || undefined,
    };
  }
  function error(field: EquipmentFormField) {
    return state.fieldErrors[field] ? (
      <p className={styles.fieldError} id={`equipment-${field}-error`}>
        {state.fieldErrors[field]}
      </p>
    ) : null;
  }
  function textField(field: EquipmentFormField, type = 'text', maxLength = 200) {
    return (
      <div className={styles.field} key={field}>
        <label htmlFor={`equipment-${field}`}>{equipmentFieldLabels[field]}</label>
        <input {...control(field)} type={type} maxLength={maxLength} required={field === 'name'} />
        {error(field)}
      </div>
    );
  }
  return (
    <form
      action={formAction}
      noValidate
      aria-busy={pending}
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (submitting.current || pending) return;
        submitting.current = true;
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      {state.message && (
        <InlineNotice
          ref={summary}
          variant="error"
          role="alert"
          tabIndex={-1}
          className={styles.errorSummary}
        >
          <h2>Please check your Equipment details</h2>
          <p>{state.message}</p>
          {state.stale && <p>{STALE_CONFLICT_MESSAGE}</p>}
          {state.stale && opened.edit && (
            <p>
              <a
                href={`/equipment/${opened.edit.equipmentId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View latest Equipment details (opens in a new tab)
              </a>
              . Your entries remain here. Reload this edit page only when you are ready to replace
              them.
            </p>
          )}
          <ul>
            {Object.entries(state.fieldErrors).map(([field, message]) => (
              <li key={field}>
                <a
                  href={`#equipment-${field}`}
                  onClick={(event) => {
                    const input = document.getElementById(`equipment-${field}`);
                    if (input) {
                      event.preventDefault();
                      input.focus();
                    }
                  }}
                >
                  {equipmentFieldLabels[field as EquipmentFormField]}: {message}
                </a>
              </li>
            ))}
          </ul>
        </InlineNotice>
      )}
      <FormSection title="Equipment identity" className={styles.card} disabled={pending}>
        <p className={styles.sectionIntro}>
          Start with the name that will identify this physical asset. Its EQP reference is assigned
          when you save.
        </p>
        <div className={styles.grid}>
          {textField('name')}
          <div className={`${styles.formGroupLabel} ${styles.fullWidth}`}>
            Category and manufacturer
          </div>
          <div className={styles.field}>
            <label htmlFor="equipment-category">Category</label>
            <input
              {...control('category', 'category-help')}
              list="equipment-categories"
              maxLength={80}
              required
            />
            <datalist id="equipment-categories">
              {suggestedEquipmentCategories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
            <p className={styles.hint} id="category-help">
              Choose a suggestion or type your own category.
            </p>
            {error('category')}
          </div>
          {(['brand', 'model', 'serialNumber'] as const).map((field) => textField(field))}
          <div className={`${styles.formGroupLabel} ${styles.fullWidth}`}>
            Location and tracking
          </div>
          <div className={styles.field}>
            <label htmlFor="equipment-usesPower">Track electricity use for this equipment</label>
            <select {...control('usesPower', 'power-help')} required>
              <option value="">Choose Yes or No</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
            <p className={styles.hint} id="power-help">
              Can electrical consumption be tracked for this item? This does not mean it is switched
              on or included in running costs.
            </p>
            {error('usesPower')}
          </div>
          <div className={styles.field}>
            <label htmlFor="equipment-locationId">Location</label>
            <select {...control('locationId', locations.length ? undefined : 'location-help')}>
              <option value="">No location</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.label}
                </option>
              ))}
            </select>
            {!locations.length && (
              <p className={styles.hint} id="location-help">
                No usable Locations have been added yet. You can save without one.
              </p>
            )}
            {error('locationId')}
          </div>
          <div className={`${styles.formGroupLabel} ${styles.fullWidth}`}>Notes</div>
          <div className={`${styles.field} ${styles.fullWidth}`}>
            <label htmlFor="equipment-notes">Notes</label>
            <textarea {...control('notes')} rows={4} maxLength={10000} />
            {error('notes')}
          </div>
        </div>
      </FormSection>
      <FormSection title="Purchase information" className={styles.card} disabled={pending}>
        {hasPurchase ? (
          <>
            <input type="hidden" name="recordPurchase" value="on" />
            <p className={styles.hint}>
              A purchase is recorded. Clear individual fields when unknown; the purchase record will
              be kept.
            </p>
          </>
        ) : (
          <>
            <label className={styles.checkLabel} htmlFor="equipment-recordPurchase">
              <input
                id="equipment-recordPurchase"
                type="checkbox"
                name="recordPurchase"
                checked={values.recordPurchase === 'on'}
                onChange={(event) => change('recordPurchase', event.target.checked ? 'on' : '')}
              />
              Record purchase information
            </label>
            <p className={styles.hint}>
              Optional. You can record a purchase even if all its details are unknown.
            </p>
            {error('recordPurchase')}
          </>
        )}
        {values.recordPurchase === 'on' && (
          <div className={`${styles.grid} ${styles.purchaseFields}`}>
            {textField('seller')}
            {textField('orderReference')}
            {textField('purchaseDate', 'date')}
            <div className={styles.field}>
              <label htmlFor="equipment-currency">Currency</label>
              <select {...control('currency')}>
                {currencies.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency === 'GBP' ? 'GBP — British pound' : currency}
                  </option>
                ))}
              </select>
              {error('currency')}
              <p className={styles.hint}>Changing currency does not convert the amounts.</p>
            </div>
            {(['equipmentPrice', 'shippingCost', 'otherCost'] as const).map((field) => (
              <div className={styles.field} key={field}>
                <label htmlFor={`equipment-${field}`}>
                  {equipmentFieldLabels[field]} ({values.currency === 'GBP' ? '£' : values.currency}
                  )
                </label>
                <input
                  {...control(
                    field,
                    field === 'shippingCost' ? 'cost-help shipping-help' : 'cost-help',
                  )}
                  inputMode="decimal"
                  placeholder="0.00"
                />
                {error(field)}
              </div>
            ))}
            <p className={`${styles.hint} ${styles.fullWidth}`} id="cost-help">
              Leave unknown amounts blank. Enter 0 for a known zero cost.
            </p>
            <p className={`${styles.hint} ${styles.fullWidth}`} id="shipping-help">
              Allocated shipping is the amount assigned to this individual item, not necessarily the
              full shipping cost of a shared order.
            </p>
          </div>
        )}
      </FormSection>
      <div className={styles.formFooter}>
        <p className={styles.hint} aria-live="polite">
          {pending
            ? 'Saving your Equipment. Please wait.'
            : opened.edit
              ? `Your reference ${opened.edit.reference} will stay the same.`
              : 'Your EQP reference will be assigned when you save.'}
        </p>
        <ActionBar className={styles.actions}>
          <Link
            className={styles.secondaryLink}
            href={opened.edit ? `/equipment/${opened.edit.equipmentId}` : '/equipment'}
          >
            Cancel
          </Link>
          <button className={styles.primaryButton} type="submit" disabled={pending}>
            {pending ? 'Saving Equipment…' : opened.edit ? 'Save Changes' : 'Create Equipment'}
          </button>
        </ActionBar>
      </div>
    </form>
  );
}
