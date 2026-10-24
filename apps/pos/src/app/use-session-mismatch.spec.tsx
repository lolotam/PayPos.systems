import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { endPersonalSession } from '@/app/end-sessions';
import type { PersonalWorkspace } from '@/app/manager-link';
import { usePersonalSession } from '@/personal-staff/api/use-personal-session';

import { useSessionMismatch } from './use-session-mismatch';

vi.mock('@/app/end-sessions', () => ({
  endPersonalSession: vi.fn(),
}));
vi.mock('@/personal-staff/api/use-personal-session', () => ({
  usePersonalSession: vi.fn(),
}));

const COMPANY = '00000000-0000-4000-8000-000000000001';
const BUSINESS = '00000000-0000-4000-8000-000000000002';
const OTHER_BUSINESS = '00000000-0000-4000-8000-000000000003';

const SESSION = {
  user_id: '00000000-0000-4000-8000-000000000004',
  company_id: COMPANY,
  business_id: OTHER_BUSINESS,
  employee_id: '00000000-0000-4000-8000-000000000005',
  expires_at: '2026-10-24T10:00:00.000Z',
};

function remembered(businessId: string): PersonalWorkspace {
  return { company_id: COMPANY, business_id: businessId };
}

function FlowWithBusiness({ business }: { business: PersonalWorkspace }) {
  const { mismatched, failed, retry } = useSessionMismatch(business);
  if (!mismatched) return <p>remembered business sign-in</p>;
  return (
    <>
      <p>old business session</p>
      {failed ? <p>sign-out failed</p> : null}
      <button type="button" onClick={retry}>
        try again
      </button>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usePersonalSession).mockReturnValue({
    epoch: 0,
    online: true,
    loading: false,
    session: SESSION,
    changed: vi.fn(),
    signOut: vi.fn(),
  });
  vi.mocked(endPersonalSession).mockResolvedValue('done');
});

describe('useSessionMismatch', () => {
  it('ends the session of the old business once', async () => {
    render(<FlowWithBusiness business={remembered(BUSINESS)} />);

    expect(await screen.findByText('old business session')).not.toBeNull();
    expect(screen.queryByText('remembered business sign-in')).toBeNull();
    expect(endPersonalSession).toHaveBeenCalledTimes(1);
  });

  it('leaves a session of the remembered business alone', async () => {
    vi.mocked(usePersonalSession).mockReturnValue({
      epoch: 0,
      online: true,
      loading: false,
      session: { ...SESSION, business_id: BUSINESS },
      changed: vi.fn(),
      signOut: vi.fn(),
    });
    render(<FlowWithBusiness business={remembered(BUSINESS)} />);

    expect(await screen.findByText('remembered business sign-in')).not.toBeNull();
    expect(endPersonalSession).not.toHaveBeenCalled();
  });

  it('does not sign the same session out twice when the server refuses', async () => {
    vi.mocked(endPersonalSession).mockResolvedValue('failed');
    const { rerender } = render(<FlowWithBusiness business={remembered(BUSINESS)} />);

    expect(await screen.findByText('sign-out failed')).not.toBeNull();
    expect(endPersonalSession).toHaveBeenCalledTimes(1);
    rerender(<FlowWithBusiness business={remembered(BUSINESS)} />);

    expect(endPersonalSession).toHaveBeenCalledTimes(1);
  });

  it('signs the same session out again when the employee asks', async () => {
    vi.mocked(endPersonalSession).mockResolvedValue('failed');
    render(<FlowWithBusiness business={remembered(BUSINESS)} />);
    await screen.findByText('sign-out failed');

    fireEvent.click(screen.getByRole('button', { name: 'try again' }));

    expect(endPersonalSession).toHaveBeenCalledTimes(2);
  });
});
