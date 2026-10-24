import { fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { endPersonalSession } from '@/app/end-sessions';
import type { PersonalWorkspace } from '@/app/manager-link';
import { usePersonalSession } from '@/personal-staff/api/use-personal-session';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { EmployeeFlow } from './employee-flow';

vi.mock('@/app/end-sessions', () => ({
  endPersonalSession: vi.fn(),
}));
vi.mock('@/personal-staff/api/use-personal-session', () => ({
  usePersonalSession: vi.fn(),
}));
vi.mock('@/personal-staff/ui/personal-screen', () => ({
  PersonalScreen: ({ workspace }: { workspace?: { company_id: string; business_id: string } }) => (
    <>
      <h2>personal screen</h2>
      {workspace ? <p>{`${workspace.company_id} ${workspace.business_id}`}</p> : null}
    </>
  ),
}));

const COMPANY = '00000000-0000-4000-8000-000000000001';
const BUSINESS = '00000000-0000-4000-8000-000000000002';
const OTHER_BUSINESS = '00000000-0000-4000-8000-000000000003';

const REMEMBERED: PersonalWorkspace = { company_id: COMPANY, business_id: BUSINESS };

const SESSION = {
  user_id: '00000000-0000-4000-8000-000000000004',
  company_id: COMPANY,
  business_id: OTHER_BUSINESS,
  employee_id: '00000000-0000-4000-8000-000000000005',
  expires_at: '2026-10-24T10:00:00.000Z',
};

function sessionState(session: typeof SESSION | null) {
  return {
    epoch: 0,
    online: true,
    loading: false,
    session,
    changed: vi.fn(),
    signOut: vi.fn(),
  };
}

function mount(business: PersonalWorkspace | null = REMEMBERED) {
  render(
    <LocaleProvider locale="ar" setLocale={() => undefined}>
      <EmployeeFlow
        business={business}
        pending={null}
        busy={false}
        connect={<p>connect</p>}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(endPersonalSession).mockResolvedValue('done');
  vi.mocked(usePersonalSession).mockReturnValue(sessionState(SESSION));
});

describe('EmployeeFlow', () => {
  it('hides the old business screens while its session is being ended', async () => {
    mount();

    expect(await screen.findByRole('status')).not.toBeNull();
    expect(screen.getByText(t('ar', 'pos.loading'))).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'personal screen' })).toBeNull();
    expect(endPersonalSession).toHaveBeenCalledTimes(1);
  });

  it('offers another try when the sign-out is refused', async () => {
    vi.mocked(endPersonalSession).mockResolvedValue('failed');
    mount();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.roleChangeFailed'));
    expect(screen.queryByRole('heading', { name: 'personal screen' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.retry') }));
    expect(endPersonalSession).toHaveBeenCalledTimes(2);
  });

  it('shows the remembered business when its own session is open', async () => {
    vi.mocked(usePersonalSession).mockReturnValue(
      sessionState({ ...SESSION, business_id: BUSINESS }),
    );
    mount();

    expect(await screen.findByRole('heading', { name: 'personal screen' })).not.toBeNull();
    expect(screen.getByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
    expect(endPersonalSession).not.toHaveBeenCalled();
  });

  it('shows the remembered business when there is no session', async () => {
    vi.mocked(usePersonalSession).mockReturnValue(sessionState(null));
    mount();

    expect(await screen.findByRole('heading', { name: 'personal screen' })).not.toBeNull();
    expect(screen.getByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
    expect(endPersonalSession).not.toHaveBeenCalled();
  });
});
