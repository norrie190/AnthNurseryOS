import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  DashboardSummary,
  InvestmentCurrencySummary,
  InvestmentDomainSummary,
} from '../dashboard-summary';
import { Dashboard } from './dashboard';

const emptyInvestment: InvestmentDomainSummary = {
  relevantRecordCount: 0,
  completeCostRecordCount: 0,
  unknownCurrencyRecordCount: 0,
  coverageComplete: true,
  byCurrency: [],
};

function energy(overrides: Partial<DashboardSummary['energy']> = {}): DashboardSummary['energy'] {
  return {
    basis: 'Projection from current settings and rate; not measured consumption',
    activePoweredEquipmentCount: 0,
    activePoweredEquipmentConfiguredTodayCount: 0,
    archivedEquipmentWithOngoingSettingsTodayCount: 0,
    configuredOperatingDrawWatts: null,
    estimatedKwh: null,
    knownEstimatedVariableCostPence: null,
    configurationCoverage: {
      relevantEquipmentCount: 0,
      configuredEquipmentCount: 0,
      complete: true,
    },
    costCoverage: { relevantEquipmentCount: 0, knownCostEquipmentCount: 0, complete: true },
    currentTariff: null,
    ...overrides,
  };
}

function summary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    plants: {
      activeCount: 0,
      growingCount: 0,
      quarantineCount: 0,
      soldCount: 0,
      deceasedCount: 0,
      archivedCount: 0,
    },
    equipment: {
      activeCount: 0,
      activeUsesPowerCount: 0,
      activeDoesNotUsePowerCount: 0,
      archivedCount: 0,
    },
    investment: {
      plants: emptyInvestment,
      equipment: emptyInvestment,
      combinedByCurrency: [],
    },
    energy: energy(),
    watering: {
      totalEligible: 0,
      overdue: 0,
      dueToday: 0,
      needsFirstWatering: 0,
      dueSoon: 0,
      upcoming: 0,
      notConfigured: 0,
      attention: [],
    },
    recentlyAdded: { plants: [], equipment: [] },
    ...overrides,
  };
}

function currency(
  code: string,
  spend: number,
  overrides: Partial<InvestmentCurrencySummary> = {},
): InvestmentCurrencySummary {
  return {
    currency: code,
    knownItemPriceSubtotalMinor: spend,
    knownAllocatedShippingSubtotalMinor: 0,
    knownOtherCostSubtotalMinor: 0,
    knownSpendSubtotalMinor: spend,
    relevantRecordCount: 1,
    completeCostRecordCount: 1,
    coverageComplete: true,
    ...overrides,
  };
}

describe('Dashboard', () => {
  it('renders the compact Watering overview and ordered attention links', () => {
    render(
      <Dashboard
        summary={summary({
          watering: {
            totalEligible: 3,
            overdue: 1,
            dueToday: 1,
            needsFirstWatering: 0,
            dueSoon: 1,
            upcoming: 0,
            notConfigured: 0,
            attention: [
              {
                id: 'plant-1',
                reference: 'ANT-0001',
                displayName: 'Aloe',
                status: 'OVERDUE',
                daysUntilDue: -4,
                nextDueDate: '2026-09-01',
                location: { id: 'loc-1', name: 'Shelf A' },
                primaryPhoto: { id: 'photo-1', derivativeRevision: 'rev-1' },
              },
              {
                id: 'plant-2',
                reference: 'ANT-0002',
                displayName: 'Unnamed Plant',
                status: 'DUE_TODAY',
                daysUntilDue: 0,
                nextDueDate: '2026-09-03',
                location: null,
                primaryPhoto: null,
              },
            ],
          },
        })}
      />,
    );
    const section = screen.getByRole('heading', { name: 'Needs attention' }).closest('section')!;
    expect(section).toHaveTextContent('Overdue1');
    expect(section).toHaveTextContent('Due today1');
    expect(section).toHaveTextContent('1 due soon');
    expect(section).toHaveTextContent('4 days overdue');
    expect(section).toHaveTextContent('Due today');
    expect(section).toHaveTextContent('Shelf A');
    expect(within(section).getByRole('link', { name: /Aloe/ })).toHaveAttribute(
      'href',
      '/plants/plant-1',
    );
    expect(within(section).getByRole('link', { name: 'View watering queue' })).toHaveAttribute(
      'href',
      '/watering',
    );
    expect(within(section).getByAltText('ANT-0001 primary photo')).toHaveAttribute(
      'src',
      '/plants/plant-1/photos/photo-1/thumbnail?v=rev-1',
    );
  });
  it('renders Plant and Equipment overview counts with capability wording', () => {
    render(
      <Dashboard
        summary={summary({
          plants: {
            activeCount: 9,
            growingCount: 4,
            quarantineCount: 2,
            soldCount: 2,
            deceasedCount: 1,
            archivedCount: 3,
          },
          equipment: {
            activeCount: 7,
            activeUsesPowerCount: 5,
            activeDoesNotUsePowerCount: 2,
            archivedCount: 1,
          },
        })}
      />,
    );

    const overview = screen.getByRole('heading', { name: 'Nursery snapshot' }).closest('section')!;
    const plants = within(overview)
      .getByRole('heading', { name: 'Plants', level: 3 })
      .closest('article')!;
    expect(plants).toHaveTextContent('9active');
    expect(plants).toHaveTextContent('Growing4');
    expect(plants).toHaveTextContent('Quarantine2');
    expect(plants).toHaveTextContent('Sold2');
    expect(plants).toHaveTextContent('Deceased1');
    expect(plants).toHaveTextContent('Archived3');

    const equipment = within(overview)
      .getByRole('heading', { name: 'Equipment', level: 3 })
      .closest('article')!;
    expect(equipment).toHaveTextContent('7active');
    expect(equipment).toHaveTextContent('Power tracking capable5');
    expect(equipment).toHaveTextContent('Does not use power2');
    expect(equipment).toHaveTextContent('Archived1');
    expect(equipment).toHaveTextContent(/does not mean an item is currently operating/i);
    expect(equipment).not.toHaveTextContent(/currently running/i);
  });

  it('shows complete same-currency investment without a grand total', () => {
    const plants = currency('GBP', 1250);
    const equipment = currency('GBP', 2500);
    render(
      <Dashboard
        summary={summary({
          investment: {
            plants: {
              ...emptyInvestment,
              relevantRecordCount: 1,
              completeCostRecordCount: 1,
              byCurrency: [plants],
            },
            equipment: {
              ...emptyInvestment,
              relevantRecordCount: 1,
              completeCostRecordCount: 1,
              byCurrency: [equipment],
            },
            combinedByCurrency: [
              currency('GBP', 3750, { relevantRecordCount: 2, completeCostRecordCount: 2 }),
            ],
          },
        })}
      />,
    );

    const section = screen.getByRole('heading', { name: 'Investment' }).closest('section')!;
    expect(within(section).getByText('£12.50')).toBeInTheDocument();
    expect(within(section).getByText('£25.00')).toBeInTheDocument();
    expect(within(section).getByText('£37.50')).toBeInTheDocument();
    expect(within(section).getByText('Combined spend')).toBeInTheDocument();
    expect(section).not.toHaveTextContent(/grand total/i);
  });

  it('labels incomplete and zero investment correctly and keeps currencies separate', () => {
    const gbpPlant = currency('GBP', 0, { completeCostRecordCount: 0, coverageComplete: false });
    const euroEquipment = currency('EUR', 500);
    render(
      <Dashboard
        summary={summary({
          investment: {
            plants: {
              relevantRecordCount: 2,
              completeCostRecordCount: 0,
              unknownCurrencyRecordCount: 1,
              coverageComplete: false,
              byCurrency: [gbpPlant],
            },
            equipment: {
              ...emptyInvestment,
              relevantRecordCount: 1,
              completeCostRecordCount: 1,
              byCurrency: [euroEquipment],
            },
            combinedByCurrency: [gbpPlant, euroEquipment],
          },
        })}
      />,
    );

    const section = screen.getByRole('heading', { name: 'Investment' }).closest('section')!;
    expect(within(section).getAllByText('£0.00')).toHaveLength(2);
    expect(within(section).getAllByText('€5.00')).toHaveLength(2);
    expect(within(section).getAllByText(/known .*spend/i).length).toBeGreaterThan(0);
    expect(section).toHaveTextContent('0 of 2 Plant records have complete cost information.');
    expect(
      within(section)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['GBP', 'EUR']);
    expect(section).not.toHaveTextContent('£5.00');
  });

  it('renders complete current energy projections and tariff', () => {
    render(
      <Dashboard
        summary={summary({
          energy: energy({
            activePoweredEquipmentCount: 2,
            activePoweredEquipmentConfiguredTodayCount: 2,
            configuredOperatingDrawWatts: '150.00',
            estimatedKwh: { daily: '1.5000000', days30: '45.0000000', days365: '547.5000000' },
            knownEstimatedVariableCostPence: {
              daily: '30.000000000000',
              days30: '900.000000000000',
              days365: '10950.000000000000',
            },
            configurationCoverage: {
              relevantEquipmentCount: 2,
              configuredEquipmentCount: 2,
              complete: true,
            },
            costCoverage: { relevantEquipmentCount: 2, knownCostEquipmentCount: 2, complete: true },
            currentTariff: {
              id: 'tariff-1',
              currency: 'GBP',
              unitRateMinorPerKwh: '20.00000',
              effectiveFrom: '2026-08-01',
            },
          }),
        })}
      />,
    );

    const section = screen.getByRole('heading', { name: 'Energy estimates' }).closest('section')!;
    expect(section).toHaveTextContent('2 of 2 active power-tracking items are configured today.');
    expect(section).toHaveTextContent('150 W');
    expect(section).toHaveTextContent('1.5 kWh');
    expect(section).toHaveTextContent('£0.30');
    expect(section).toHaveTextContent('£9.00');
    expect(section).toHaveTextContent('£109.50');
    expect(section).toHaveTextContent(/not measured consumption or actual bills/i);
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('p/kWh')).toBeInTheDocument();
    expect(screen.getByText('1 Aug 2026')).toBeInTheDocument();
  });

  it('surfaces partial configuration and archived ongoing settings separately', () => {
    render(
      <Dashboard
        summary={summary({
          energy: energy({
            activePoweredEquipmentCount: 3,
            activePoweredEquipmentConfiguredTodayCount: 2,
            archivedEquipmentWithOngoingSettingsTodayCount: 1,
            configuredOperatingDrawWatts: '100.00',
            estimatedKwh: { daily: '1.0000000', days30: '30.0000000', days365: '365.0000000' },
            knownEstimatedVariableCostPence: {
              daily: '25.000000000000',
              days30: '750.000000000000',
              days365: '9125.000000000000',
            },
            configurationCoverage: {
              relevantEquipmentCount: 3,
              configuredEquipmentCount: 2,
              complete: false,
            },
            costCoverage: {
              relevantEquipmentCount: 3,
              knownCostEquipmentCount: 2,
              complete: false,
            },
          }),
        })}
      />,
    );

    expect(screen.getByText('Some current settings are missing')).toBeInTheDocument();
    expect(screen.getByText('Known estimate / day')).toBeInTheDocument();
    const notice = screen.getByLabelText('Archived Equipment attention');
    expect(notice).toHaveTextContent('1 archived Equipment item');
    expect(notice).toHaveTextContent(/kept separate from active estimates/i);
  });

  it('renders no-powered and missing-tariff empty states', () => {
    const { rerender } = render(<Dashboard summary={summary()} />);
    expect(
      screen.getByRole('heading', { name: 'No active power-tracking Equipment' }),
    ).toBeInTheDocument();
    expect(screen.getByText('No current tariff')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Configure tariff' })).toHaveAttribute(
      'href',
      '/energy/tariffs',
    );

    rerender(
      <Dashboard
        summary={summary({
          energy: energy({
            activePoweredEquipmentCount: 1,
            activePoweredEquipmentConfiguredTodayCount: 1,
            configuredOperatingDrawWatts: '100.00',
            estimatedKwh: { daily: '1.0000000', days30: '30.0000000', days365: '365.0000000' },
            configurationCoverage: {
              relevantEquipmentCount: 1,
              configuredEquipmentCount: 1,
              complete: true,
            },
            costCoverage: {
              relevantEquipmentCount: 1,
              knownCostEquipmentCount: 0,
              complete: false,
            },
          }),
        })}
      />,
    );
    expect(
      screen.getByText(/cost estimates are unknown because no current tariff/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
  });

  it('treats zero tariff and known zero consumption as valid zero values', () => {
    render(
      <Dashboard
        summary={summary({
          energy: energy({
            activePoweredEquipmentCount: 1,
            activePoweredEquipmentConfiguredTodayCount: 1,
            configuredOperatingDrawWatts: '0.00',
            estimatedKwh: { daily: '0.0000000', days30: '0.0000000', days365: '0.0000000' },
            knownEstimatedVariableCostPence: {
              daily: '0.000000000000',
              days30: '0.000000000000',
              days365: '0.000000000000',
            },
            configurationCoverage: {
              relevantEquipmentCount: 1,
              configuredEquipmentCount: 1,
              complete: true,
            },
            costCoverage: { relevantEquipmentCount: 1, knownCostEquipmentCount: 1, complete: true },
            currentTariff: {
              id: 'tariff-zero',
              currency: 'GBP',
              unitRateMinorPerKwh: '0.00000',
              effectiveFrom: '2026-01-01',
            },
          }),
        })}
      />,
    );

    expect(screen.getByText('0 W')).toBeInTheDocument();
    expect(screen.getByText('0 kWh')).toBeInTheDocument();
    expect(screen.getAllByText('£0.00')).toHaveLength(3);
    const tariffCard = screen
      .getByRole('heading', { name: 'Current electricity tariff' })
      .closest('article')!;
    expect(within(tariffCard).getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('No current tariff')).not.toBeInTheDocument();
  });

  it('renders recent links, safe thumbnails, fallbacks and no more than four items', () => {
    const createdAt = new Date('2026-08-02T12:00:00.000Z');
    render(
      <Dashboard
        summary={summary({
          recentlyAdded: {
            plants: Array.from({ length: 5 }, (_, index) => ({
              id: `plant-${index}`,
              reference: `ANT-${index}`,
              name: index === 1 ? null : `Plant ${index}`,
              displayName: index === 1 ? 'Unnamed Plant' : `Plant ${index}`,
              createdAt,
              primaryPhoto:
                index === 0 ? { id: 'plant-photo', derivativeRevision: 'plant-revision' } : null,
            })),
            equipment: Array.from({ length: 5 }, (_, index) => ({
              id: `equipment-${index}`,
              reference: `EQP-${index}`,
              name: `Equipment ${index}`,
              createdAt,
              primaryPhoto:
                index === 0
                  ? { id: 'equipment-photo', derivativeRevision: 'equipment-revision' }
                  : null,
            })),
          },
        })}
      />,
    );

    expect(screen.getByText('Plant 0').closest('a')).toHaveAttribute('href', '/plants/plant-0');
    expect(screen.getByText('Equipment 0').closest('a')).toHaveAttribute(
      'href',
      '/equipment/equipment-0',
    );
    const plantImage = screen.getByAltText('ANT-0 primary photo');
    expect(plantImage).toHaveAttribute(
      'src',
      '/plants/plant-0/photos/plant-photo/thumbnail?v=plant-revision',
    );
    expect(screen.getByAltText('EQP-0 primary photo')).toHaveAttribute(
      'src',
      '/equipment/equipment-0/photos/equipment-photo/thumbnail?v=equipment-revision',
    );
    expect(screen.getAllByRole('img', { name: 'No photo' })).toHaveLength(6);
    expect(screen.getByText('Unnamed Plant')).toBeInTheDocument();
    expect(screen.getAllByText('Added 2 Aug 2026')).toHaveLength(8);
    expect(screen.getByRole('list', { name: 'Recently added Plants' }).children).toHaveLength(4);
    expect(screen.getByRole('list', { name: 'Recently added Equipment' }).children).toHaveLength(4);
    expect(screen.queryByText('Plant 4')).not.toBeInTheDocument();
    expect(screen.queryByText('Equipment 4')).not.toBeInTheDocument();

    fireEvent.error(plantImage);
    expect(
      screen.getByRole('img', { name: 'Photo unavailable: ANT-0 primary photo' }),
    ).toBeInTheDocument();
  });
});
