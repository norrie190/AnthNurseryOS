import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { PlantList } from './plant-list';
import type { PlantListItem } from '../plant-queries';

const plant: PlantListItem = {
  id: 'a8e64bb0-47ef-4a99-963c-aef88aed09ea',
  reference: 'ANT-0001',
  name: 'HURC',
  status: 'GROWING',
  location: { name: 'Grow Tent 1' },
  photos: [],
  createdAt: new Date('2026-08-30T12:00:00Z'),
};

test('renders only the selected primary thumbnail and uses a placeholder when delivery fails', () => {
  render(
    <PlantList
      plants={[{ ...plant, photos: [{ id: 'primary-photo', derivativeRevision: null }] }]}
    />,
  );
  const image = screen.getByRole('img');
  expect(image).toHaveAttribute('src', `/plants/${plant.id}/photos/primary-photo/thumbnail`);
  fireEvent.error(image);
  expect(screen.getByRole('img', { name: /Photo unavailable/ })).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute('href', `/plants/${plant.id}`);
});

test('Plants without a photo have a neutral placeholder and no image request', () => {
  const { container } = render(<PlantList plants={[plant]} />);
  expect(screen.getByRole('img', { name: 'No photo' })).toBeInTheDocument();
  expect(container.querySelector('img')).toBeNull();
});

test('shows a useful empty state and Add Plant link', () => {
  render(<PlantList plants={[]} />);
  expect(screen.getByRole('heading', { name: 'No active Plants' })).toBeInTheDocument();
  expect(
    screen.getByText('Add a Plant to your collection, or restore one from Archived Plants.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Add Plant' })).toHaveAttribute('href', '/plants/new');
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});

test('shows one Plant with its reference and a link containing all row details', () => {
  const { container } = render(<PlantList plants={[plant]} />);
  const list = screen.getByRole('list', { name: 'Plants' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  const link = within(list).getByRole('link');
  expect(link).toHaveAttribute('href', `/plants/${plant.id}`);
  for (const text of ['ANT-0001', 'HURC', 'Growing', 'Grow Tent 1', '30 Aug 2026']) {
    expect(link).toHaveTextContent(text);
  }
  expect(container).not.toHaveTextContent(plant.id);
  expect(container.querySelector('time')).toHaveAttribute(
    'datetime',
    plant.createdAt.toISOString(),
  );
});

test('preserves the query order for multiple Plants', () => {
  render(<PlantList plants={[{ ...plant, id: 'newer', reference: 'ANT-0002' }, plant]} />);
  const links = within(screen.getByRole('list', { name: 'Plants' })).getAllByRole('link');
  expect(links).toHaveLength(2);
  expect(links[0]).toHaveTextContent('ANT-0002');
  expect(links[0]).toHaveAttribute('href', '/plants/newer');
  expect(links[1]).toHaveTextContent('ANT-0001');
});

test('provides one keyboard target per Plant and activates the link with Enter', async () => {
  const user = userEvent.setup();
  render(<PlantList plants={[plant, { ...plant, id: 'second', reference: 'ANT-0002' }]} />);
  const links = screen.getAllByRole('link');
  const activate = vi.fn((event: Event) => event.preventDefault());
  links[0].addEventListener('click', activate);
  await user.tab();
  expect(links[0]).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(activate).toHaveBeenCalledOnce();
  expect(links[0]).toHaveAttribute('href', `/plants/${plant.id}`);
  await user.tab();
  expect(links[1]).toHaveFocus();
});

test('uses meaningful fallbacks for an unnamed Plant with no Location', () => {
  render(<PlantList plants={[{ ...plant, name: null, location: null }]} />);
  expect(screen.getByText('Unnamed Plant')).toBeInTheDocument();
  expect(screen.getByText('No location', { exact: false })).toBeInTheDocument();
});

test.each([
  ['GROWING', 'Growing'],
  ['QUARANTINE', 'Quarantine'],
  ['SOLD', 'Sold'],
  ['DECEASED', 'Deceased'],
] as const)('displays %s with its readable label', (status, label) => {
  render(<PlantList plants={[{ ...plant, status }]} />);
  expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
  expect(screen.queryByText(status, { exact: true })).not.toBeInTheDocument();
});

test('displays the Added date in the same nursery timezone as Plant details', () => {
  render(<PlantList plants={[{ ...plant, createdAt: new Date('2026-08-29T23:30:00Z') }]} />);
  expect(screen.getByText('30 Aug 2026')).toBeInTheDocument();
});

test('provides an archived empty state with a way back to active Plants', () => {
  render(<PlantList plants={[]} archived />);
  expect(screen.getByRole('heading', { name: 'No archived Plants' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to active Plants' })).toHaveAttribute(
    'href',
    '/plants',
  );
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});

test('reuses responsive rows for archived Plants, with archive dates and preserved query ordering', () => {
  const { container } = render(
    <PlantList
      archived
      plants={[
        { ...plant, archivedAt: new Date('2026-08-30T23:30:00Z'), name: null, location: null },
        {
          ...plant,
          id: 'second',
          reference: 'ANT-0002',
          status: 'DECEASED',
          archivedAt: new Date('2026-08-29T12:00:00Z'),
        },
      ]}
    />,
  );
  const links = within(screen.getByRole('list', { name: 'Archived Plants' })).getAllByRole('link');
  expect(links).toHaveLength(2);
  expect(links[0]).toHaveAttribute('href', `/plants/${plant.id}`);
  expect(links[0]).toHaveTextContent('ANT-0001');
  expect(links[0]).toHaveTextContent('Unnamed Plant');
  expect(links[0]).toHaveTextContent('Growing');
  expect(links[0]).toHaveTextContent('No location');
  expect(links[0]).toHaveTextContent('31 Aug 2026');
  expect(links[1]).toHaveTextContent('Deceased');
  expect(links[1]).toHaveTextContent('Grow Tent 1');
  expect(container).not.toHaveTextContent(plant.id);
  expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-08-30T23:30:00.000Z');
});
