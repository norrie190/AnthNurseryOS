// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest';
import { revalidatePath } from 'next/cache';
import { recordWateringEvent } from './watering-event-service';
import { changeWateringSchedule } from './watering-schedule-service';
import { WateringError } from './watering-errors';
import { changeWateringScheduleAction, recordWateringAction } from './watering-actions';
import { initialRecordWateringState, initialScheduleState } from './watering-form-state';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./watering-event-service', () => ({ recordWateringEvent: vi.fn() }));
vi.mock('./watering-schedule-service', () => ({ changeWateringSchedule: vi.fn() }));

const plantId = '12345678-1234-4234-8234-123456789abc';
function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => vi.resetAllMocks());

test('record action interprets browser time in Europe/London and revalidates the Plant', async () => {
  const result = await recordWateringAction(
    plantId,
    initialRecordWateringState,
    form({ wateredAt: '2026-09-02T12:30', notes: 'Bottom watered' }),
  );
  expect(result).toMatchObject({ success: true, message: 'Watering recorded.' });
  expect(recordWateringEvent).toHaveBeenCalledWith(plantId, {
    wateredAt: '2026-09-02T11:30:00.000Z',
    notes: 'Bottom watered',
  });
  expect(revalidatePath).toHaveBeenCalledWith(`/plants/${plantId}`);
});

test('record action supports backdated values and maps future rejection to the field', async () => {
  vi.mocked(recordWateringEvent).mockRejectedValue(
    new WateringError('FUTURE_WATERING', 'A watering event cannot be recorded in the future.', {
      issues: [{ field: 'wateredAt', message: 'Enter a time that is not in the future.' }],
    }),
  );
  const result = await recordWateringAction(
    plantId,
    initialRecordWateringState,
    form({ wateredAt: '2026-09-02T12:30', notes: '' }),
  );
  expect(result).toMatchObject({
    success: false,
    fieldErrors: { wateredAt: 'Enter a time that is not in the future.' },
  });
  expect(revalidatePath).not.toHaveBeenCalled();
});

test('record action maps a concurrent lifecycle change without exposing service detail', async () => {
  vi.mocked(recordWateringEvent).mockRejectedValue(
    new WateringError('PLANT_NOT_ELIGIBLE', 'Internal lifecycle detail'),
  );
  const result = await recordWateringAction(
    plantId,
    initialRecordWateringState,
    form({ wateredAt: '2026-09-02T12:30', notes: '' }),
  );
  expect(result.message).toContain('no longer eligible');
  expect(result.message).not.toContain('Internal');
});

test('record action rejects unsupported, duplicate and nonexistent DST wall times', async () => {
  for (const data of [
    form({ wateredAt: '2026-03-29T01:30', notes: '' }),
    form({ wateredAt: '2026-09-02T12:30', notes: '', plantId }),
  ]) {
    expect(await recordWateringAction(plantId, initialRecordWateringState, data)).toMatchObject({
      success: false,
    });
  }
  const duplicate = form({ wateredAt: '2026-09-02T12:30', notes: '' });
  duplicate.append('notes', 'again');
  expect(await recordWateringAction(plantId, initialRecordWateringState, duplicate)).toMatchObject({
    success: false,
    fieldErrors: { notes: expect.any(String) },
  });
  expect(recordWateringEvent).not.toHaveBeenCalled();
});

test('schedule action forwards first/change fields and revalidates', async () => {
  const result = await changeWateringScheduleAction(
    plantId,
    initialScheduleState,
    form({ intervalDays: '7', effectiveFrom: '2026-09-03', notes: 'Summer target' }),
  );
  expect(result.success).toBe(true);
  expect(changeWateringSchedule).toHaveBeenCalledWith(plantId, {
    intervalDays: 7,
    effectiveFrom: '2026-09-03',
    notes: 'Summer target',
  });
  expect(revalidatePath).toHaveBeenCalledWith(`/plants/${plantId}`);
});

test('ambiguous autumn time resolves consistently to the later London occurrence', async () => {
  await recordWateringAction(
    plantId,
    initialRecordWateringState,
    form({ wateredAt: '2026-10-25T01:30', notes: '' }),
  );
  expect(recordWateringEvent).toHaveBeenCalledWith(
    plantId,
    expect.objectContaining({ wateredAt: '2026-10-25T01:30:00.000Z' }),
  );
});

test.each(['0', '366', '1.5', ''])('schedule action rejects interval %j', async (intervalDays) => {
  const result = await changeWateringScheduleAction(
    plantId,
    initialScheduleState,
    form({ intervalDays, effectiveFrom: '2026-09-03', notes: '' }),
  );
  expect(result).toMatchObject({
    success: false,
    fieldErrors: { intervalDays: 'Enter a whole number from 1 to 365.' },
  });
  expect(changeWateringSchedule).not.toHaveBeenCalled();
});

test('schedule action rejects an invalid effective date before the service', async () => {
  const result = await changeWateringScheduleAction(
    plantId,
    initialScheduleState,
    form({ intervalDays: '7', effectiveFrom: 'not-a-date', notes: '' }),
  );
  expect(result).toMatchObject({
    success: false,
    fieldErrors: { effectiveFrom: 'Enter a valid effective date.' },
  });
  expect(changeWateringSchedule).not.toHaveBeenCalled();
});

test('schedule exact-start conflict and lifecycle changes receive useful safe messages', async () => {
  vi.mocked(changeWateringSchedule).mockRejectedValueOnce(
    new WateringError('SCHEDULE_CONFLICT', 'Internal overlap detail'),
  );
  const values = form({ intervalDays: '7', effectiveFrom: '2026-09-03', notes: '' });
  expect(await changeWateringScheduleAction(plantId, initialScheduleState, values)).toMatchObject({
    success: false,
    message: expect.stringContaining('need correction'),
  });

  vi.mocked(changeWateringSchedule).mockRejectedValueOnce(
    new WateringError('PLANT_NOT_ELIGIBLE', 'Internal lifecycle detail'),
  );
  expect(await changeWateringScheduleAction(plantId, initialScheduleState, values)).toMatchObject({
    success: false,
    message: expect.stringContaining('no longer eligible'),
  });
});

test('expected not-found and invalid service errors are safe; infrastructure details are hidden', async () => {
  vi.mocked(recordWateringEvent).mockRejectedValueOnce(
    new WateringError('PLANT_NOT_FOUND', 'This Plant could not be found.'),
  );
  expect(
    await recordWateringAction(
      plantId,
      initialRecordWateringState,
      form({ wateredAt: '2026-09-02T12:30', notes: '' }),
    ),
  ).toMatchObject({ success: false, message: 'This Plant could not be found.' });

  vi.mocked(changeWateringSchedule).mockRejectedValueOnce(new Error('secret database message'));
  const result = await changeWateringScheduleAction(
    plantId,
    initialScheduleState,
    form({ intervalDays: '7', effectiveFrom: '2026-09-03', notes: '' }),
  );
  expect(result.message).not.toContain('secret');
  expect(result.message).toContain('could not confirm');
});
