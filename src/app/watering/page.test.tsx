import { fireEvent, render, screen } from '@testing-library/react';
import { connection } from 'next/server';
import { beforeEach, expect, test, vi } from 'vitest';
import WateringPage from './page';
import { getWateringQueue } from '@/modules/watering/watering-queue-queries';
import type { WateringQueue } from '@/modules/watering/watering-queue-queries';

vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('server-only', () => ({}));
vi.mock('@/modules/watering/watering-queue-queries', () => ({ getWateringQueue: vi.fn() }));
vi.mock('@/components/photos/photo-image', () => ({
  PhotoImage: ({ src, alt }: { src?: string; alt: string }) =>
    src ? (
      <img src={src} alt={alt} />
    ) : (
      <span role="img" aria-label="No photo">
        No photo
      </span>
    ),
}));

const statuses = [
  'OVERDUE',
  'DUE_TODAY',
  'NEEDS_FIRST_WATERING',
  'DUE_SOON',
  'UPCOMING',
  'NOT_CONFIGURED',
] as const;
const queue: WateringQueue = {
  nurseryDate: '2026-09-10',
  entries: statuses.map((status, index) => ({
    plant: {
      id: `plant-${index}`,
      reference: `ANT-${index}`,
      name: index === 0 ? null : `Plant ${index}`,
      status: index === 1 ? ('QUARANTINE' as const) : ('GROWING' as const),
      location: index === 2 ? null : { id: 'location', name: 'Shelf A' },
      primaryPhoto: index === 0 ? { id: 'photo', derivativeRevision: 'rev-1' } : null,
    },
    due: {
      status,
      nurseryDate: '2026-09-10',
      intervalDays: status === 'NOT_CONFIGURED' ? null : 7,
      latestWateredDate:
        status === 'NEEDS_FIRST_WATERING' || status === 'NOT_CONFIGURED' ? null : '2026-09-03',
      nextDueDate:
        status === 'OVERDUE'
          ? '2026-09-07'
          : status === 'DUE_TODAY'
            ? '2026-09-10'
            : status === 'DUE_SOON'
              ? '2026-09-12'
              : status === 'UPCOMING'
                ? '2026-09-18'
                : null,
      daysUntilDue:
        status === 'OVERDUE'
          ? -3
          : status === 'DUE_TODAY'
            ? 0
            : status === 'DUE_SOON'
              ? 2
              : status === 'UPCOMING'
                ? 8
                : null,
    },
  })),
  counts: {
    totalEligible: 6,
    overdue: 1,
    dueToday: 1,
    dueSoon: 1,
    needsFirstWatering: 1,
    upcoming: 1,
    notConfigured: 1,
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getWateringQueue).mockResolvedValue(queue);
});

test('loads the read model server-side and presents all queue categories and entry details', async () => {
  render(await WateringPage());
  expect(connection).toHaveBeenCalledOnce();
  expect(getWateringQueue).toHaveBeenCalledOnce();
  expect(screen.getByRole('heading', { level: 1, name: 'Watering' })).toBeInTheDocument();
  expect(screen.getAllByRole('checkbox')).toHaveLength(6);
  expect(screen.getByText('0 Plants selected')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Water selected' })).toBeDisabled();
  expect(screen.getByText('active-care Plants in queue')).toBeInTheDocument();
  expect(screen.getByText('3 days overdue')).toBeInTheDocument();
  expect(screen.getAllByText('Due today').length).toBeGreaterThan(0);
  expect(screen.getByText('No watering recorded yet')).toBeInTheDocument();
  expect(screen.getByText('Due in 2 days')).toBeInTheDocument();
  expect(screen.getByText('Due in 8 days')).toBeInTheDocument();
  expect(screen.getByText('Watering schedule not configured')).toBeInTheDocument();
  expect(screen.getByText('Unnamed Plant')).toBeInTheDocument();
  expect(screen.getAllByText(/No location/).length).toBeGreaterThan(0);
  expect(screen.getAllByRole('link', { name: 'Manage watering' })[0]).toHaveAttribute(
    'href',
    '/plants/plant-0',
  );
  expect(screen.getByRole('img', { name: /primary photo/ })).toHaveAttribute(
    'src',
    '/plants/plant-0/photos/photo/thumbnail?v=rev-1',
  );
});

test('handles no active plants and communicates no urgent work', async () => {
  vi.mocked(getWateringQueue).mockResolvedValue({
    ...queue,
    entries: [],
    counts: {
      ...queue.counts,
      totalEligible: 0,
      overdue: 0,
      dueToday: 0,
      dueSoon: 0,
      needsFirstWatering: 0,
      upcoming: 0,
      notConfigured: 0,
    },
  });
  render(await WateringPage());
  expect(
    screen.getByRole('heading', { name: 'No active Plants currently need watering tracking.' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View Plants' })).toHaveAttribute('href', '/plants');
});

test('announces no urgent tasks when only non-urgent categories are populated', async () => {
  vi.mocked(getWateringQueue).mockResolvedValue({
    ...queue,
    entries: [queue.entries[4]],
    counts: {
      ...queue.counts,
      totalEligible: 1,
      overdue: 0,
      dueToday: 0,
      dueSoon: 0,
      needsFirstWatering: 0,
      upcoming: 1,
      notConfigured: 0,
    },
  });
  render(await WateringPage());
  expect(screen.getByRole('status')).toHaveTextContent('No urgent watering tasks today.');
});

test('keeps batch selection and confirmation language visible without changing queue data', async () => {
  render(await WateringPage());
  const checkbox = screen.getAllByRole('checkbox')[0];
  fireEvent.click(checkbox);
  expect(screen.getByText('1 Plants selected')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Water selected' })).toBeEnabled();
  expect(checkbox.closest('li')).toHaveAttribute('data-selected', 'true');

  fireEvent.click(screen.getByRole('button', { name: 'Water selected' }));
  expect(screen.getByRole('heading', { name: 'Water 1 selected Plants now?' })).toBeInTheDocument();
  expect(screen.getByText(/recorded together using one timestamp/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Shared note/)).toBeInTheDocument();
});
