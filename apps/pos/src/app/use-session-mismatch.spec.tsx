import { render, screen, waitFor } from '@testing-library/react';
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
  business_id: BUSINESS,
  employee_id: '00000000-0000-4000-8000-000000000005',
  expires_at: '2026-10-24T10:00:00.000Z',
};

function remembered(businessId: string): PersonalWorkspace {
  return { company_id: COMPANY, business_id: businessId };
}

function FlowWithBusiness({ business }: { business: PersonalWorkspace }) {
  const { session } = useSessionMismatch(business);
  if (session === null) return <p>remembered business sign-in</p>;
  return <p>session business screens</p>;
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
  it('ends the session of the old business and keeps the sign-in of the remembered one', async () => {
    render(<FlowWithBusiness business={remembered(OTHER_BUSINESS)} />);

    expect(await screen.findByText('remembered business sign-in')).not.toBeNull();
    expect(screen.queryByText('session business screens')).toBeNull();
    expect(endPersonalSession).toHaveBeenCalledTimes(1);
  });

  it('leaves a session of the remembered business alone', async () => {
    render(<FlowWithBusiness business={remembered(BUSINESS)} />);

    expect(await screen.findByText('session business screens')).not.toBeNull();
    expect(endPersonalSession).not.toHaveBeenCalled();
  });

  it('does not sign the same session out twice when the server refuses', async () => {
    vi.mocked(endPersonalSession).mockResolvedValue('failed');
    const { rerender } = render(<FlowWithBusiness business={remembered(OTHER_BUSINESS)} />);

    await waitFor(() => expect(endPersonalSession).toHaveBeenCalledTimes(1));
    rerender(<FlowWithBusiness business={remembered(OTHER_BUSINESS)} />);

    expect(endPersonalSession).toHaveBeenCalledTimes(1);
  });
});
