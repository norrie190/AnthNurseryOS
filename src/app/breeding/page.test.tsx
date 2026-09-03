import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import BreedingPage from './page';
import { getBreedingOverview } from '@/modules/breeding/breeding-overview-queries';

vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('@/modules/breeding/breeding-overview-queries', () => ({ getBreedingOverview: vi.fn() }));
vi.mock('@/modules/breeding/components/breeding-overview-page', () => ({
  BreedingOverviewPage: ({ overview }: { overview: unknown }) => (
    <div data-testid="breeding-page">{JSON.stringify(overview)}</div>
  ),
}));

beforeEach(() => vi.resetAllMocks());

test('loads the overview read model once for /breeding', async () => {
  vi.mocked(getBreedingOverview).mockResolvedValue({} as never);
  const result = await BreedingPage();
  render(result);
  expect(getBreedingOverview).toHaveBeenCalledOnce();
  expect(screen.getByTestId('breeding-page')).toBeInTheDocument();
});
