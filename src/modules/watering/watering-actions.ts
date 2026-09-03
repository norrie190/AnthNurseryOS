'use server';

import { revalidatePath } from 'next/cache';
import { WateringError } from './watering-errors';
import { parseRecordWateringForm, parseScheduleForm } from './watering-form-data';
import type {
  RecordWateringField,
  RecordWateringFormState,
  ScheduleField,
  ScheduleFormState,
} from './watering-form-state';
import { recordWateringEvent } from './watering-event-service';
import { changeWateringSchedule } from './watering-schedule-service';
import { correctWateringEvent, voidWateringEvent } from './watering-event-service';
import {
  correctWateringSchedulePeriod,
  voidWateringSchedulePeriod,
} from './watering-schedule-service';
import { nurseryInstantForDateTimeInput } from '../../lib/calendar-date';
import type { HistoryActionState } from './watering-form-state';

function issues<Fields extends string>(
  error: WateringError,
  allowed: readonly Fields[],
): Partial<Record<Fields, string>> {
  const fields = new Set<string>(allowed);
  const result: Partial<Record<Fields, string>> = {};
  for (const issue of error.issues) {
    const field = issue.field.replace(/^input\./, '');
    if (fields.has(field)) result[field as Fields] = issue.message;
  }
  return result;
}

export async function recordWateringAction(
  plantId: string,
  _previous: RecordWateringFormState,
  formData: FormData,
): Promise<RecordWateringFormState> {
  const parsed = parseRecordWateringForm(formData);
  if (!parsed.success) return parsed.state;
  try {
    await recordWateringEvent(plantId, parsed.input);
    revalidatePath(`/plants/${plantId}`);
    return { success: true, message: 'Watering recorded.', fieldErrors: {} };
  } catch (error) {
    if (error instanceof WateringError && error.code !== 'CONFLICT') {
      return {
        success: false,
        message:
          error.code === 'PLANT_NOT_ELIGIBLE'
            ? 'This Plant is no longer eligible for new watering records. Reload the page to review its current lifecycle state.'
            : error.message,
        fieldErrors: issues<RecordWateringField>(error, ['wateredAt', 'notes']),
      };
    }
    console.error('Watering event save failed', error);
    return {
      success: false,
      message:
        'We could not confirm that the watering was recorded. Reload the Plant details to check before trying again.',
      fieldErrors: {},
    };
  }
}

export async function changeWateringScheduleAction(
  plantId: string,
  _previous: ScheduleFormState,
  formData: FormData,
): Promise<ScheduleFormState> {
  const parsed = parseScheduleForm(formData);
  if (!parsed.success) return parsed.state;
  try {
    await changeWateringSchedule(plantId, parsed.input);
    revalidatePath(`/plants/${plantId}`);
    return { success: true, message: 'Watering schedule saved.', fieldErrors: {} };
  } catch (error) {
    if (error instanceof WateringError && error.code !== 'CONFLICT') {
      return {
        success: false,
        message:
          error.code === 'SCHEDULE_CONFLICT'
            ? 'This date conflicts with existing schedule history. If a period already starts on this date, that period will need correction rather than a normal schedule change.'
            : error.code === 'PLANT_NOT_ELIGIBLE'
              ? 'This Plant is no longer eligible for normal schedule changes. Reload the page to review its current lifecycle state.'
              : error.message,
        fieldErrors: issues<ScheduleField>(error, ['intervalDays', 'effectiveFrom', 'notes']),
      };
    }
    console.error('Watering schedule save failed', error);
    return {
      success: false,
      message:
        'We could not confirm that the watering schedule was saved. Reload the Plant details to check before trying again.',
      fieldErrors: {},
    };
  }
}

type HistoryContext = {
  kind: 'event' | 'schedule';
  mode: 'correct' | 'void';
  itemId: string;
  token: string;
};

function historyFields(data: FormData, allowed: readonly string[]) {
  const values: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (const key of data.keys()) {
    if (!allowed.includes(key) && !key.startsWith('$ACTION_'))
      throw new WateringError('VALIDATION_FAILED', 'The form contains unsupported fields.');
  }
  for (const key of allowed) {
    const entries = data.getAll(key);
    if (entries.length > 1 || (entries.length === 1 && typeof entries[0] !== 'string'))
      errors[key] = 'Supply one value for this field.';
    else values[key] = entries.length ? String(entries[0]) : '';
  }
  return { values, errors };
}

export async function wateringHistoryAction(
  plantId: string,
  context: HistoryContext,
  _previous: HistoryActionState,
  formData: FormData,
): Promise<HistoryActionState> {
  try {
    const allowed =
      context.mode === 'void'
        ? ['correctionReason', 'confirm']
        : context.kind === 'event'
          ? ['wateredAt', 'notes', 'correctionReason']
          : ['intervalDays', 'effectiveFrom', 'effectiveTo', 'notes', 'correctionReason'];
    const { values, errors } = historyFields(formData, allowed);
    if (context.mode === 'void' && values.confirm !== 'yes')
      errors.confirm = 'Confirm this record should be voided.';
    if (!values.correctionReason.trim())
      errors.correctionReason = 'Explain why this historical record is being changed.';
    if (context.mode === 'correct' && context.kind === 'event' && !errors.wateredAt) {
      try {
        nurseryInstantForDateTimeInput(values.wateredAt);
      } catch (error) {
        errors.wateredAt = error instanceof Error ? error.message : 'Enter a valid date and time.';
      }
    }
    if (context.mode === 'correct' && context.kind === 'schedule') {
      if (
        !/^\d+$/.test(values.intervalDays) ||
        Number(values.intervalDays) < 1 ||
        Number(values.intervalDays) > 365
      )
        errors.intervalDays = 'Enter a whole number from 1 to 365.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(values.effectiveFrom))
        errors.effectiveFrom = 'Enter a valid effective date.';
      if (values.effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(values.effectiveTo))
        errors.effectiveTo = 'Enter a valid end date.';
    }
    if (Object.keys(errors).length)
      return {
        success: false,
        message: 'Check the highlighted historical record details.',
        fieldErrors: errors,
      };
    if (context.kind === 'event') {
      if (context.mode === 'correct')
        await correctWateringEvent(plantId, context.itemId, {
          wateredAt: nurseryInstantForDateTimeInput(values.wateredAt).toISOString(),
          notes: values.notes,
          correctionReason: values.correctionReason,
          expectedUpdatedAt: context.token,
        });
      else
        await voidWateringEvent(plantId, context.itemId, {
          correctionReason: values.correctionReason,
          expectedUpdatedAt: context.token,
        });
    } else if (context.mode === 'correct') {
      await correctWateringSchedulePeriod(plantId, context.itemId, {
        intervalDays: Number(values.intervalDays),
        effectiveFrom: values.effectiveFrom,
        effectiveTo: values.effectiveTo || null,
        notes: values.notes,
        correctionReason: values.correctionReason,
        expectedUpdatedAt: context.token,
      });
    } else
      await voidWateringSchedulePeriod(plantId, context.itemId, {
        correctionReason: values.correctionReason,
        expectedUpdatedAt: context.token,
      });
    revalidatePath(`/plants/${plantId}`);
    return {
      success: true,
      message:
        context.mode === 'void'
          ? 'Record voided. It remains in history and is excluded from calculations.'
          : 'Historical record corrected.',
      fieldErrors: {},
    };
  } catch (error) {
    if (error instanceof WateringError && error.code !== 'CONFLICT')
      return {
        success: false,
        message:
          error.code === 'STALE_UPDATE'
            ? 'This record changed while the form was open. Review the refreshed history before trying again.'
            : error.code === 'SCHEDULE_CONFLICT'
              ? 'These boundary changes conflict with existing schedule history. Review adjacent periods before trying again.'
              : error.message,
        fieldErrors: Object.fromEntries(
          error.issues.map((issue) => [issue.field.replace(/^input\./, ''), issue.message]),
        ),
        ...(error.code === 'STALE_UPDATE' ? { stale: true } : {}),
      };
    console.error('Watering history action failed', error);
    return {
      success: false,
      message:
        'We could not confirm this historical change. Reload the Plant details before trying again.',
      fieldErrors: {},
    };
  }
}
