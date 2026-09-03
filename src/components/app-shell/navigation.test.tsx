import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePathname } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopNavigation, MobileNavigation } from './navigation';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}));

const mockedUsePathname = vi.mocked(usePathname);

describe('DesktopNavigation', () => {
  beforeEach(() => {
    mockedUsePathname.mockReturnValue('/');
  });

  it('links to the current MVP areas and marks the current page', () => {
    mockedUsePathname.mockReturnValue('/plants');

    render(<DesktopNavigation />);

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Plants' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Plants' })).toHaveAttribute('href', '/plants');
    expect(screen.getByRole('link', { name: 'Watering' })).toHaveAttribute('href', '/watering');
    expect(screen.getByRole('link', { name: 'Breeding' })).toHaveAttribute('href', '/breeding');
    expect(screen.getByRole('link', { name: 'Care' })).toHaveAttribute('href', '/care');
    expect(screen.getByRole('link', { name: 'Equipment' })).toHaveAttribute('href', '/equipment');
    expect(screen.getByRole('link', { name: 'Expenses' })).toHaveAttribute('href', '/expenses');
  });
});

describe('MobileNavigation', () => {
  beforeEach(() => {
    mockedUsePathname.mockReturnValue('/');
  });

  it('opens and closes the mobile menu', async () => {
    const user = userEvent.setup();

    render(<MobileNavigation />);

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Close navigation' })[1]);

    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
  });
});
