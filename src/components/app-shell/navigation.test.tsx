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

  it('groups the current destinations and marks the current page', () => {
    mockedUsePathname.mockReturnValue('/plants');

    render(<DesktopNavigation />);

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Plants' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Plants' })).toHaveAttribute('href', '/plants');
    expect(screen.getByRole('link', { name: 'Watering' })).toHaveAttribute('href', '/watering');
    expect(screen.getByRole('link', { name: 'Breeding' })).toHaveAttribute('href', '/breeding');
    expect(screen.getByRole('link', { name: 'Equipment' })).toHaveAttribute('href', '/equipment');
    expect(screen.getByRole('link', { name: 'Energy' })).toHaveAttribute('href', '/energy/tariffs');
    expect(screen.getByRole('link', { name: 'Expenses' })).toHaveAttribute('href', '/expenses');
    expect(screen.queryByRole('link', { name: 'Care' })).not.toBeInTheDocument();
    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
  });

  it('keeps parent destinations active for nested routes', () => {
    mockedUsePathname.mockReturnValue('/plants/30ab0f8b-f7a3-44c1-b3ad-9d18268d3edd/edit');

    render(<DesktopNavigation />);

    expect(screen.getByRole('link', { name: 'Plants' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('keeps Energy active for its tariff route', () => {
    mockedUsePathname.mockReturnValue('/energy/tariffs');

    render(<DesktopNavigation />);

    expect(screen.getByRole('link', { name: 'Energy' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('MobileNavigation', () => {
  beforeEach(() => {
    mockedUsePathname.mockReturnValue('/');
  });

  it('opens, closes, and restores focus from the mobile menu', async () => {
    const user = userEvent.setup();

    render(<MobileNavigation />);

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Navigation menu' })).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Close navigation' })[1]);

    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveFocus();
  });

  it('closes with Escape', async () => {
    const user = userEvent.setup();

    render(<MobileNavigation />);
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveFocus();
  });
});
