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
