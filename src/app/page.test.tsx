import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from './page';

describe('HomePage', () => {
  it('renders the application foundation message', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { name: 'Anth Nursery OS' })).toBeInTheDocument();
    expect(screen.getByText('The application foundation is ready.')).toBeInTheDocument();
  });
});
