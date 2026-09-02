import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  getDashboardSummary: vi.fn(),
}));

vi.mock('next/server', () => ({ connection: mocks.connection }));
vi.mock('@/modules/dashboard', () => ({ getDashboardSummary: mocks.getDashboardSummary }));
vi.mock('@/modules/dashboard/components/dashboard', () => ({
  Dashboard: ({ summary }: { summary: { marker: string } }) => <div>{summary.marker}</div>,
}));

import HomePage from './page';

describe('HomePage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the approved Dashboard read model at request time', async () => {
    mocks.getDashboardSummary.mockResolvedValue({ marker: 'Current nursery summary' });

    render(await HomePage());

    expect(mocks.connection).toHaveBeenCalledOnce();
    expect(mocks.getDashboardSummary).toHaveBeenCalledOnce();
    expect(screen.getByText('Current nursery summary')).toBeInTheDocument();
  });
});
