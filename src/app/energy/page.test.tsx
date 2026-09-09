import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  getEnergyOverview: vi.fn(),
}));

vi.mock('next/server', () => ({ connection: mocks.connection }));
vi.mock('@/modules/energy/energy-overview', () => ({
  getEnergyOverview: mocks.getEnergyOverview,
}));
vi.mock('@/modules/energy/components/energy-overview', () => ({
  EnergyOverviewPage: ({ overview }: { overview: { marker: string } }) => (
    <div>{overview.marker}</div>
  ),
}));

import EnergyPage from './page';

describe('EnergyPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the Energy overview at request time', async () => {
    mocks.getEnergyOverview.mockResolvedValue({ marker: 'Current Energy overview' });

    render(await EnergyPage());

    expect(mocks.connection).toHaveBeenCalledOnce();
    expect(mocks.getEnergyOverview).toHaveBeenCalledOnce();
    expect(screen.getByText('Current Energy overview')).toBeInTheDocument();
  });
});
