import type { ChangeWateringScheduleInput } from './watering-schedule-service';
import type { RecordWateringEventInput } from './watering-event-service';
import { nurseryInstantForDateTimeInput } from '../../lib/calendar-date';
import {
  type RecordWateringField,
  type RecordWateringFormState,
  type ScheduleField,
  type ScheduleFormState,
} from './watering-form-state';

function readFields<Fields extends string>(formData: FormData, fields: readonly Fields[]) {
  const allowed = new Set<string>(fields);
  const values = {} as Record<Fields, string>;
  const fieldErrors: Partial<Record<Fields, string>> = {};
  let unsupported = false;
  for (const key of formData.keys()) {
    if (!allowed.has(key) && !key.startsWith('$ACTION_')) unsupported = true;
  }
  for (const field of fields) {
    const entries = formData.getAll(field);
    if (entries.length !== 1 || typeof entries[0] !== 'string') {
      fieldErrors[field] = 'Supply one text value for this field.';
      values[field] = '';
    } else values[field] = entries[0];
  }
  return { values, fieldErrors, unsupported };
}

export function parseRecordWateringForm(
  formData: FormData,
):
  | { success: true; input: RecordWateringEventInput }
  | { success: false; state: RecordWateringFormState } {
  const read = readFields(formData, ['wateredAt', 'notes'] as const);
  if (!read.fieldErrors.wateredAt) {
    try {
      nurseryInstantForDateTimeInput(read.values.wateredAt);
    } catch (error) {
      read.fieldErrors.wateredAt =
        error instanceof Error ? error.message : 'Enter a valid nursery date and time.';
    }
  }
  if (read.unsupported || Object.keys(read.fieldErrors).length) {
    return {
      success: false,
      state: {
        success: false,
        message: read.unsupported
          ? 'The form contained unsupported fields. Reload the page and try again.'
          : 'Check the highlighted watering details.',
        fieldErrors: read.fieldErrors,
      },
    };
  }
  return {
    success: true,
    input: {
      wateredAt: nurseryInstantForDateTimeInput(read.values.wateredAt).toISOString(),
      notes: read.values.notes,
    },
  };
}

export function parseScheduleForm(
  formData: FormData,
):
  | { success: true; input: ChangeWateringScheduleInput }
  | { success: false; state: ScheduleFormState } {
  const read = readFields(formData, ['intervalDays', 'effectiveFrom', 'notes'] as const);
  const intervalDays = Number(read.values.intervalDays);
  if (
    !read.fieldErrors.intervalDays &&
    (!/^\d+$/.test(read.values.intervalDays) || intervalDays < 1 || intervalDays > 365)
  ) {
    read.fieldErrors.intervalDays = 'Enter a whole number from 1 to 365.';
  }
  if (!read.fieldErrors.effectiveFrom && !/^\d{4}-\d{2}-\d{2}$/.test(read.values.effectiveFrom)) {
    read.fieldErrors.effectiveFrom = 'Enter a valid effective date.';
  }
  if (read.unsupported || Object.keys(read.fieldErrors).length) {
    return {
      success: false,
      state: {
        success: false,
        message: read.unsupported
          ? 'The form contained unsupported fields. Reload the page and try again.'
          : 'Check the highlighted schedule details.',
        fieldErrors: read.fieldErrors,
      },
    };
  }
  return {
    success: true,
    input: {
      intervalDays,
      effectiveFrom: read.values.effectiveFrom,
      notes: read.values.notes,
    },
  };
}

export const recordWateringFields: readonly RecordWateringField[] = ['wateredAt', 'notes'];
export const scheduleFields: readonly ScheduleField[] = ['intervalDays', 'effectiveFrom', 'notes'];
