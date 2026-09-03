import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { PlantWateringDetail } from '../watering-schedule-queries';
import { recordWateringAction, changeWateringScheduleAction } from '../watering-actions';
import { PlantWatering } from './plant-watering';
import type { RecordWateringFormState } from '../watering-form-state';

vi.mock('../watering-actions', () => ({
  recordWateringAction: vi.fn(),
  changeWateringScheduleAction: vi.fn(),
}));

const plantId = '12345678-1234-4234-8234-123456789abc';
const stamp = new Date('2026-09-01T10:00:00.000Z');
function detail(overrides: Partial<PlantWateringDetail> = {}): PlantWateringDetail {
  return {
    plant: {
      id: plantId,
      reference: 'ANT-0001',
      name: 'Velvet',
      status: 'GROWING',
      archivedAt: null,
      activeCareEligible: true,
    },
    schedule: null,
    latestWateringEvent: null,
    due: {
      status: 'NOT_CONFIGURED',
      nurseryDate: '2026-09-03',
      intervalDays: null,
      latestWateredDate: null,
      nextDueDate: null,
      daysUntilDue: null,
    },
    events: [],
    periods: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(recordWateringAction).mockResolvedValue({
    success: true,
    message: 'Watering recorded.',
    fieldErrors: {},
  });
  vi.mocked(changeWateringScheduleAction).mockResolvedValue({
    success: true,
    message: 'Watering schedule saved.',
    fieldErrors: {},
  });
});

test.each([
  ['NOT_CONFIGURED', null, 'No watering schedule configured'],
  ['NEEDS_FIRST_WATERING', null, 'Schedule configured — first watering not recorded'],
  ['OVERDUE', -3, 'Overdue by 3 days'],
  ['DUE_TODAY', 0, 'Due today'],
  ['DUE_SOON', 2, 'Due in 2 days'],
  ['UPCOMING', 8, 'Due in 8 days'],
] as const)('renders %s as human status text', (status, daysUntilDue, label) => {
  render(
    <PlantWatering
      watering={detail({
        due: {
          status,
          nurseryDate: '2026-09-03',
          intervalDays: status === 'NOT_CONFIGURED' ? null : 7,
          latestWateredDate: status === 'NEEDS_FIRST_WATERING' ? null : '2026-09-01',
          nextDueDate: daysUntilDue === null ? null : '2026-09-10',
          daysUntilDue,
        },
      })}
    />,
  );
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.queryByText(status)).not.toBeInTheDocument();
});

test('shows interval and UK-style latest/next dates without presenting them as guarantees', () => {
  render(
    <PlantWatering
      watering={detail({
        due: {
          status: 'DUE_SOON',
          nurseryDate: '2026-09-03',
          intervalDays: 7,
          latestWateredDate: '2026-09-01',
          nextDueDate: '2026-09-08',
          daysUntilDue: 5,
        },
      })}
    />,
  );
  expect(screen.getByText('Every 7 days')).toBeInTheDocument();
  expect(screen.getByText('1 September 2026')).toBeInTheDocument();
  expect(screen.getByText('8 September 2026')).toBeInTheDocument();
  expect(screen.getByText(/calendar-based care estimates/)).toBeInTheDocument();
});

test.each([
  ['GROWING', null, true],
  ['QUARANTINE', null, true],
  ['SOLD', null, false],
  ['DECEASED', null, false],
  ['GROWING', stamp, false],
] as const)('lifecycle %s archived=%s controls=%s', (status, archivedAt, controls) => {
  render(
    <PlantWatering
      watering={detail({
        plant: {
          ...detail().plant,
          status,
          archivedAt,
          activeCareEligible: controls,
        },
      })}
    />,
  );
  if (controls) {
    expect(screen.getByRole('button', { name: 'Record watering' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configure watering' })).toBeInTheDocument();
  } else {
    expect(screen.queryByRole('button', { name: 'Record watering' })).not.toBeInTheDocument();
    expect(screen.getByText(/Watering history is read-only/)).toBeInTheDocument();
  }
});

test('record form submits notes/backdated time once and exposes pending state', async () => {
  let finish!: (state: RecordWateringFormState) => void;
  vi.mocked(recordWateringAction).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<PlantWatering watering={detail()} />);
  fireEvent.change(screen.getByLabelText('Watered at'), { target: { value: '2026-08-20T09:15' } });
  fireEvent.change(screen.getByLabelText('Notes (optional)', { selector: '#watering-notes' }), {
    target: { value: 'Soaked well' },
  });
  const form = screen.getByRole('button', { name: 'Record watering' }).closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(recordWateringAction).toHaveBeenCalledOnce();
  const submitted = vi.mocked(recordWateringAction).mock.calls[0][2];
  expect(submitted.get('wateredAt')).toBe('2026-08-20T09:15');
  expect(submitted.get('notes')).toBe('Soaked well');
  expect(screen.getByRole('button', { name: 'Recording…' })).toBeDisabled();
  await act(async () => finish({ success: true, message: 'Watering recorded.', fieldErrors: {} }));
  expect(screen.getByRole('status')).toHaveTextContent('Watering recorded.');
});

test('forms display mapped feedback and schedule values', async () => {
  vi.mocked(changeWateringScheduleAction).mockResolvedValue({
    success: false,
    message: 'This date requires correction rather than a normal change.',
    fieldErrors: { effectiveFrom: 'Choose another date.' },
  });
  render(<PlantWatering watering={detail()} />);
  fireEvent.change(screen.getByLabelText('Interval (days)'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2026-09-20' } });
  fireEvent.change(
    screen.getByLabelText('Notes (optional)', { selector: '#watering-schedule-notes' }),
    { target: { value: 'Autumn target' } },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Configure watering' }));
  const submitted = vi.mocked(changeWateringScheduleAction).mock.calls[0][2];
  expect(Object.fromEntries(submitted)).toEqual({
    intervalDays: '5',
    effectiveFrom: '2026-09-20',
    notes: 'Autumn target',
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('requires correction');
  expect(screen.getByText('Choose another date.')).toBeInTheDocument();
});

test('current schedule, event history and schedule states retain gaps and void information', () => {
  const current = {
    id: 'current',
    plantId,
    intervalDays: 7,
    effectiveFrom: new Date('2026-09-01'),
    effectiveTo: null,
    notes: 'Current notes',
    voidedAt: null,
    correctionReason: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  render(
    <PlantWatering
      watering={detail({
        schedule: current,
        due: { ...detail().due, status: 'NEEDS_FIRST_WATERING', intervalDays: 7 },
        events: [
          {
            id: 'new',
            plantId,
            wateredAt: new Date('2026-09-02T08:00:00Z'),
            notes: 'Newest',
            voidedAt: null,
            correctionReason: 'Time corrected',
            createdAt: stamp,
            updatedAt: stamp,
          },
          {
            id: 'void',
            plantId,
            wateredAt: new Date('2026-09-01T08:00:00Z'),
            notes: null,
            voidedAt: stamp,
            correctionReason: 'Duplicate',
            createdAt: stamp,
            updatedAt: stamp,
          },
        ],
        periods: [
          {
            ...current,
            id: 'old',
            effectiveFrom: new Date('2026-08-01'),
            effectiveTo: new Date('2026-09-01'),
          },
          current,
          { ...current, id: 'future', effectiveFrom: new Date('2026-10-01') },
          {
            ...current,
            id: 'void-period',
            effectiveFrom: new Date('2026-08-15'),
            effectiveTo: new Date('2026-08-20'),
            voidedAt: stamp,
            correctionReason: 'Wrong dates',
          },
        ],
      })}
    />,
  );
  expect(screen.getAllByText('Current notes')).toHaveLength(5);
  expect(screen.getByText('Newest')).toBeInTheDocument();
  expect(screen.getByText('Correction reason: Time corrected')).toBeInTheDocument();
  expect(screen.getByText('Voided — excluded from due calculations')).toBeInTheDocument();
  expect(screen.getByText('Void reason: Duplicate')).toBeInTheDocument();
  for (const state of ['Historical', 'Current', 'Future', 'Voided'])
    expect(screen.getByText(state)).toBeInTheDocument();
  expect(screen.getByText('Void reason: Wrong dates')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /correct|void/i })).not.toBeInTheDocument();
});

test('empty histories and a genuine current gap are explicit', () => {
  render(<PlantWatering watering={detail()} />);
  expect(screen.getByText(/No schedule applies today/)).toBeInTheDocument();
  expect(screen.getByText('No watering has been recorded yet.')).toBeInTheDocument();
  expect(screen.getByText('No watering schedule history yet.')).toBeInTheDocument();
});
