import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DashboardAccount } from './dashboard-account';

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

it('shows session email and name with complete titles, never the raw user id', () => {
  const account = {
    id: '01920000-0000-7000-8000-000000000001',
    email: 'synthetic.long.email.address@example.test',
    name: 'Synthetic Account',
  };
  render(<DashboardAccount account={account} />);
  expect(screen.queryByText(account.id)).toBeNull();
  const email = screen.getByText(account.email);
  expect(email.title).toBe(account.email);
  expect(email.classList.contains('truncate')).toBe(true);
  expect(email.getAttribute('dir')).toBe('ltr');
  expect(screen.getByText(account.name).title).toBe(account.name);
});
