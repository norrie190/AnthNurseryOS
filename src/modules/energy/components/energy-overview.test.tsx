import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { EnergyOverview } from '../energy-overview';
import { EnergyOverviewPage } from './energy-overview';

function overview(overrides: Partial<EnergyOverview> = {}): EnergyOverview {
  return {
    today: '2026-09-08',
    equipmentCount: 1,
    configuredCount: 1,
    archivedOngoingCount: 0,
    currentTariff: {
      unitRateMinorPerKwh: '25.00000',
      effectiveFrom: '2026-09-01',
      effectiveTo: null,
    },
    nextTariff: null,
    totals: {
      configuredOperatingDrawWatts: '70.00',
      estimatedKwhPerDay: '0.84',
      estimatedCostPerDay: '£0.21',
      estimatedCost30Days: '£6.30',
      estimatedCost365Days: '£76.65',
      energyCoverageComplete: true,
      costCoverageComplete: true,
    },
    equipment: [
      {
        id: 'equipment-id',
        reference: 'EQP-0001',
        name: 'Grow light',
        primaryPhoto: null,
        current: {
          powerWatts: '70.00',
          hoursPerDay: '12.00',
          estimatedKwhPerDay: '0.84',
          estimatedCostPerDay: '£0.21',
          knownZero: false,
        },
        nextSettingFrom: null,
      },
    ],
    ...overrides,
  };
}

describe('EnergyOverviewPage', () => {
  it('shows honest current projections and a per Equipment breakdown', () => {
    render(<EnergyOverviewPage overview={overview()} />);

    expect(screen.getByRole('heading', { name: 'Energy' })).toBeInTheDocument();
    expect(screen.getByText('70 W')).toBeInTheDocument();
    expect(screen.getAllByText('0.84 kWh')).toHaveLength(2);
    expect(screen.getByText('£6.30')).toBeInTheDocument();
    expect(screen.getByText('£76.65')).toBeInTheDocument();
    expect(screen.getByText(/not live measurements or household bills/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Manage tariffs/i })).toHaveAttribute(
      'href',
      '/energy/tariffs',
    );

    const equipment = screen.getByRole('listitem');
    expect(within(equipment).getByText('Grow light')).toBeInTheDocument();
    expect(within(equipment).getByText('EQP-0001')).toBeInTheDocument();
    expect(within(equipment).getByRole('link', { name: /Manage/i })).toHaveAttribute(
      'href',
      '/equipment/equipment-id#energy',
    );
  });

  it('makes incomplete setup and a scheduled tariff clear', () => {
    render(
      <EnergyOverviewPage
        overview={overview({
          configuredCount: 0,
          currentTariff: null,
          nextTariff: { unitRateMinorPerKwh: '24.50000', effectiveFrom: '2026-09-09' },
          totals: {
            configuredOperatingDrawWatts: null,
            estimatedKwhPerDay: null,
            estimatedCostPerDay: null,
            estimatedCost30Days: null,
            estimatedCost365Days: null,
            energyCoverageComplete: false,
            costCoverageComplete: false,
          },
          equipment: [
            {
              id: 'equipment-id',
              reference: 'EQP-0001',
              name: 'Grow light',
              primaryPhoto: null,
              current: null,
              nextSettingFrom: '2026-09-10',
            },
          ],
        })}
      />,
    );

    expect(screen.getByRole('heading', { name: '1 item needs settings' })).toBeInTheDocument();
    expect(screen.getByText('No tariff applies today')).toBeInTheDocument();
    expect(
      screen.getByText((_, element) =>
        Boolean(
          element?.tagName === 'P' &&
          element.textContent?.match(/Next rate 24.5 p\/kWh from 9 Sept 2026/),
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('No settings for today')).toBeInTheDocument();
    expect(screen.getByText('Scheduled from 10 Sept 2026')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1 item needs settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review EQP-0001/i })).toHaveAttribute(
      'href',
      '/equipment/equipment-id#energy',
    );
    expect(screen.getByRole('link', { name: /Review settings/i })).toHaveAttribute(
      'href',
      '/equipment/equipment-id#energy',
    );
  });

  it('leads with missing setup rather than presenting a partial cost as the total', () => {
    const partial = overview();
    render(
      <EnergyOverviewPage
        overview={overview({
          equipmentCount: 2,
          configuredCount: 1,
          totals: { ...partial.totals, costCoverageComplete: false },
          equipment: [
            ...partial.equipment,
            {
              id: 'second',
              reference: 'EQP-0002',
              name: 'Fan',
              primaryPhoto: null,
              current: null,
              nextSettingFrom: null,
            },
          ],
        })}
      />,
    );

    expect(screen.getByRole('heading', { name: '1 item needs settings' })).toBeInTheDocument();
    expect(
      screen.getByText('£6.30 known variable cost for the next 30 days so far'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Set up EQP-0002/i })).toHaveAttribute(
      'href',
      '/equipment/second#energy',
    );
    expect(screen.getByRole('link', { name: /Set up power/i })).toHaveAttribute(
      'href',
      '/equipment/second#energy',
    );
  });

  it('keeps archived ongoing settings outside active totals and visible as a warning', () => {
    render(<EnergyOverviewPage overview={overview({ archivedOngoingCount: 1 })} />);

    expect(screen.getByText(/1 archived Equipment item/)).toBeInTheDocument();
    expect(screen.getByText(/kept out of the active totals/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review archived Equipment' })).toHaveAttribute(
      'href',
      '/equipment/archived',
    );
  });

  it('offers a clear start when no powered Equipment exists', () => {
    const base = overview();
    render(
      <EnergyOverviewPage
        overview={overview({
          equipmentCount: 0,
          configuredCount: 0,
          equipment: [],
          totals: {
            ...base.totals,
            estimatedCost30Days: null,
            costCoverageComplete: false,
          },
        })}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Add powered Equipment' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Add Equipment' })[0]).toHaveAttribute(
      'href',
      '/equipment/new',
    );
  });
});
