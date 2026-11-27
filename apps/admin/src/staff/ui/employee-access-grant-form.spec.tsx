import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeAccessGrantForm } from './employee-access-grant-form';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

const ID = '01920000-0000-7000-8000-00000000000d';
const ACTIVE = {
  state: 'ACTIVE',
  role: 'staff',
  branch_id: ID,
  phone_last3: '567',
  can_manage: true,
  can_cancel: false,
};

function fill(email: string | null) {
  fireEvent.change(screen.getByLabelText('Her phone (canonical, with country code)'), {
    target: { value: '+96551234567' },
  });
  fireEvent.change(screen.getByLabelText('Temporary PIN (4 digits)'), {
    target: { value: '1234' },
  });
  fireEvent.click(screen.getByLabelText('I confirmed this number is hers'));
  if (email !== null)
    fireEvent.change(screen.getByLabelText('Recovery email (optional)'), {
      target: { value: email },
    });
}

beforeEach(() => {
  post.mockReset().mockResolvedValue({ data: ACTIVE, error: undefined });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EmployeeAccessGrantForm companyId={ID} businessId={ID} employeeId={ID} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
});

describe('the optional recovery email on «Give access»', () => {
  it('sends it trimmed with the grant and then shows the granted message', async () => {
    fill(' sara@example.test ');
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]?.body).toMatchObject({ recovery_email: 'sara@example.test' });
    expect(await screen.findByText(/Access granted/)).toBeTruthy();
  });

  it('sends no address when the field stays empty', async () => {
    fill(null);
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]?.body?.recovery_email).toBeUndefined();
    expect(await screen.findByText(/Access granted/)).toBeTruthy();
  });

  it('shows a message and sends nothing for a malformed address', async () => {
    fill('not-an-email');
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    expect(
      await screen.findByText('Enter a valid email address, or leave the field empty.'),
    ).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });
});
