import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { EquipmentList } from './equipment-list';
import { EquipmentDetail } from './equipment-detail';
import EquipmentPage from '../../../app/equipment/page';
import ArchivedPage from '../../../app/equipment/archived/page';
import NewPage from '../../../app/equipment/new/page';
import DetailPage from '../../../app/equipment/[equipmentId]/page';
import EditPage from '../../../app/equipment/[equipmentId]/edit/page';
import {
  getEquipmentList,
  getArchivedEquipmentList,
  getEquipmentById,
  getEquipmentLocationOptions,
  type EquipmentDetailRecord,
} from '../equipment-queries';
import { equipmentEditValues } from '../equipment-edit-values';
import { equipmentEnergyView } from '../../energy/energy-view';
import { loadEquipmentEnergyView } from '../../energy/energy-page-data';
import { getEquipmentPhotoGallery } from '../equipment-photo-queries';

vi.mock('../../energy/energy-page-data', () => ({ loadEquipmentEnergyView: vi.fn() }));
vi.mock('../../energy/energy-actions', () => ({ saveEnergyAction: vi.fn() }));
vi.mock('../equipment-photo-queries', () => ({ getEquipmentPhotoGallery: vi.fn() }));

vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('../equipment-queries', () => ({
  getEquipmentList: vi.fn(),
  getArchivedEquipmentList: vi.fn(),
  getEquipmentById: vi.fn(),
  getEquipmentLocationOptions: vi.fn(),
}));
vi.mock('../equipment-actions', () => ({
  createEquipmentAction: vi.fn(),
  updateEquipmentAction: vi.fn(),
}));
vi.mock('../equipment-archive-actions', () => ({
  archiveEquipmentAction: vi.fn(),
  restoreEquipmentAction: vi.fn(),
}));

const item: EquipmentDetailRecord = {
  id: 'ba576170-0776-4f0e-90d9-353cc6518611',
  reference: 'EQP-0001',
  name: 'SF1000D',
  category: 'Grow Light',
  usesPower: true,
  brand: 'Spider Farmer',
  model: 'SF1000D model',
  serialNumber: 'serial',
  notes: 'Nursery light',
  locationId: null,
  location: null,
  purchase: null,
  createdAt: new Date('2026-08-30T12:00:00Z'),
  updatedAt: new Date('2026-08-31T12:00:00Z'),
  archivedAt: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadEquipmentEnergyView).mockResolvedValue(
    equipmentEnergyView({
      equipmentId: item.id,
      usesPower: true,
      token: item.updatedAt.toISOString(),
      rows: [],
      tariffs: [],
      today: '2026-09-01',
    }),
  );
  vi.mocked(getEquipmentList).mockResolvedValue([]);
  vi.mocked(getArchivedEquipmentList).mockResolvedValue([]);
  vi.mocked(getEquipmentById).mockResolvedValue(item);
  vi.mocked(getEquipmentLocationOptions).mockResolvedValue([]);
  vi.mocked(getEquipmentPhotoGallery).mockResolvedValue([]);
});
test.each([false, true])('empty state archived=%s provides a useful next action', (archived) => {
  render(<EquipmentList equipment={[]} archived={archived} />);
  expect(
    screen.getByRole('heading', {
      name: archived ? 'No archived equipment.' : 'No equipment recorded yet.',
    }),
  ).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute(
    'href',
    archived ? '/equipment' : '/equipment/new',
  );
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});
test('list shows reference, manufacturer, power, Location fallback and deterministic input order', () => {
  const other = {
    ...item,
    id: 'other',
    reference: 'EQP-0002',
    usesPower: false,
    brand: null,
    model: null,
  };
  const { container } = render(<EquipmentList equipment={[other, item]} />);
  const links = within(screen.getByRole('list')).getAllByRole('link');
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    '/equipment/other',
    `/equipment/${item.id}`,
  ]);
  expect(links[0]).toHaveTextContent('Energy tracking: Not enabled');
  expect(links[1]).toHaveTextContent('Energy tracking: Supported');
  expect(links[1]).toHaveTextContent('Spider Farmer · SF1000D model');
  expect(links[1]).toHaveTextContent('No location');
  expect(links[1]).toHaveTextContent('30 Aug 2026');
  expect(container.querySelectorAll('li')).toHaveLength(2);
  // One semantic list supports both CSS presentations, without duplicate mobile links.
  expect(screen.getAllByText('EQP-0001')).toHaveLength(1);
});
test('active and archived list rows show primary thumbnails with a safe fallback', () => {
  const photo = {
    id: '7e065a7b-0543-4c62-a36f-7f92731e1499',
    derivativeRevision: '82d40c04-439f-430d-a473-c4dcba6b88ec',
  };
  const { rerender } = render(<EquipmentList equipment={[{ ...item, photos: [photo] }]} />);
  const image = screen.getByRole('img', { name: 'EQP-0001 primary photo' });
  expect(image).toHaveAttribute(
    'src',
    `/equipment/${item.id}/photos/${photo.id}/thumbnail?v=${photo.derivativeRevision}`,
  );
  fireEvent.error(image);
  expect(
    screen.getByRole('img', { name: 'Photo unavailable: EQP-0001 primary photo' }),
  ).toBeInTheDocument();
  rerender(
    <EquipmentList equipment={[{ ...item, archivedAt: item.updatedAt, photos: [] }]} archived />,
  );
  expect(screen.getByRole('img', { name: 'No photo' })).toBeInTheDocument();
});
test('archived list shows archive date and a clear path to restore', () => {
  render(
    <EquipmentList
      equipment={[{ ...item, archivedAt: new Date('2026-08-31T12:00:00Z') }]}
      archived
    />,
  );
  expect(screen.getByRole('list', { name: 'Archived Equipment' })).toHaveTextContent('31 Aug 2026');
  expect(screen.getByRole('link')).toHaveTextContent('View details to restore');
});
test('detail displays immutable reference and optional fallbacks', () => {
  render(<EquipmentDetail equipment={item} />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(item.name);
  expect(screen.getByText('serial')).toBeInTheDocument();
  expect(screen.getByText('Nursery light')).toBeInTheDocument();
  expect(screen.getByText('No purchase information recorded.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit Equipment' })).toHaveAttribute(
    'href',
    `/equipment/${item.id}/edit`,
  );
  expect(screen.getByRole('button', { name: 'Archive Equipment' })).toBeInTheDocument();
  expect(screen.queryByText(item.id)).not.toBeInTheDocument();
});
test('archived detail remains viewable and distinguishes unknown from zero purchase amounts', () => {
  render(
    <EquipmentDetail
      equipment={{
        ...item,
        archivedAt: new Date('2026-08-31'),
        purchase: {
          id: 'purchase',
          equipmentId: item.id,
          seller: 'Shop',
          orderReference: 'order',
          purchaseDate: new Date('2026-08-13'),
          equipmentPriceMinor: 5000,
          shippingCostMinor: 0,
          otherCostMinor: null,
          currency: 'GBP',
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        },
      }}
    />,
  );
  expect(screen.getByText('£50.00')).toBeInTheDocument();
  expect(screen.getByText('£0.00')).toBeInTheDocument();
  expect(screen.getByText('Not recorded')).toBeInTheDocument();
  expect(screen.getByText('13 Aug 2026')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Restore Equipment' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Archive Equipment' })).not.toBeInTheDocument();
});
test('active page reads active list and exposes add/archive navigation', async () => {
  vi.mocked(getEquipmentList).mockResolvedValue([{ ...item, photos: [] }]);
  render(await EquipmentPage());
  expect(getEquipmentList).toHaveBeenCalledOnce();
  expect(getArchivedEquipmentList).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Add Equipment' })).toHaveAttribute(
    'href',
    '/equipment/new',
  );
  expect(screen.getByRole('link', { name: 'Archived Equipment' })).toHaveAttribute(
    'href',
    '/equipment/archived',
  );
});
test('archived page reads only archived list', async () => {
  render(await ArchivedPage());
  expect(getArchivedEquipmentList).toHaveBeenCalledOnce();
  expect(getEquipmentList).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Archived Equipment');
});
test('add route loads usable Location options and form', async () => {
  vi.mocked(getEquipmentLocationOptions).mockResolvedValue([
    { id: 'place', label: 'Tent / Shelf' },
  ]);
  render(await NewPage());
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Add Equipment');
  expect(screen.getByRole('option', { name: 'Tent / Shelf' })).toHaveValue('place');
});
test('detail route uses UUID lookup', async () => {
  render(await DetailPage({ params: Promise.resolve({ equipmentId: item.id }) }));
  expect(getEquipmentById).toHaveBeenCalledWith(item.id);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(item.name);
});
test('detail route loads the ordered Equipment gallery without exposing storage metadata', async () => {
  vi.mocked(getEquipmentPhotoGallery).mockResolvedValue([
    {
      id: '7e065a7b-0543-4c62-a36f-7f92731e1499',
      equipmentId: item.id,
      originalFilename: 'equipment.jpg',
      caption: 'Controller face',
      takenAt: new Date('2026-09-01T08:30:00.000Z'),
      isPrimary: true,
      sortOrder: 0,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      cropX: 0,
      cropY: 0,
      cropSize: 1,
      derivativeRevision: '82d40c04-439f-430d-a473-c4dcba6b88ec',
    },
  ]);
  render(await DetailPage({ params: Promise.resolve({ equipmentId: item.id }) }));
  expect(getEquipmentPhotoGallery).toHaveBeenCalledWith(item.id);
  expect(screen.getByRole('heading', { name: 'Photos' })).toBeInTheDocument();
  expect(screen.getAllByText('Controller face')).toHaveLength(2);
  expect(screen.queryByText('equipment.jpg')).not.toBeInTheDocument();
});
test('edit route retains and labels only the existing archived Location', async () => {
  const location = {
    id: 'old',
    name: 'Old shelf',
    description: null,
    parentLocationId: null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    archivedAt: item.updatedAt,
  };
  vi.mocked(getEquipmentById).mockResolvedValue({ ...item, locationId: location.id, location });
  vi.mocked(getEquipmentLocationOptions).mockResolvedValue([{ id: 'new', label: 'New shelf' }]);
  render(await EditPage({ params: Promise.resolve({ equipmentId: item.id }) }));
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Editing EQP-0001');
  expect(screen.getByLabelText('Location')).toHaveValue('old');
  expect(
    screen.getByRole('option', { name: 'Old shelf (archived, current Location)' }),
  ).toBeInTheDocument();
});
test.each([DetailPage, EditPage])('missing Equipment produces not found', async (page) => {
  vi.mocked(getEquipmentById).mockResolvedValue(null);
  await expect(page({ params: Promise.resolve({ equipmentId: 'missing' }) })).rejects.toThrow(
    'NOT_FOUND',
  );
});
test('edit values preserve null/zero, calendar date and currency precision', () => {
  expect(equipmentEditValues(item)).toMatchObject({
    usesPower: 'true',
    recordPurchase: '',
    equipmentPrice: '',
  });
  expect(
    equipmentEditValues({
      ...item,
      purchase: {
        id: 'p',
        equipmentId: item.id,
        seller: null,
        orderReference: null,
        purchaseDate: new Date('2024-02-29'),
        equipmentPriceMinor: 0,
        shippingCostMinor: null,
        otherCostMinor: 1234,
        currency: 'KWD',
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      },
    }),
  ).toMatchObject({
    recordPurchase: 'on',
    equipmentPrice: '0.000',
    shippingCost: '',
    otherCost: '1.234',
    purchaseDate: '2024-02-29',
  });
});
