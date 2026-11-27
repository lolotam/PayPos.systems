import { act, fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { endPersonalSession } from '@/app/end-sessions';
import type { PersonalWorkspace } from '@/app/manager-link';
import { usePersonalSession } from '@/personal-staff/api/use-personal-session';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { EmployeeFlow } from './employee-flow';
import { FOREIGN_SIGN_OUT_WAIT_MS } from './foreign-session-notice';

vi.mock('@/app/end-sessions', () => ({
  endPersonalSession: vi.fn(),
}));
vi.mock('@/personal-staff/api/use-personal-session', () => ({
  usePersonalSession: vi.fn(),
}));
vi.mock('@/personal-staff/ui/enrol-passkey-screen', () => ({
  EnrolPasskeyScreen: ({ employeeId }: { employeeId: string }) => (
    <p>{`session screen ${employeeId}`}</p>
  ),
}));
vi.mock('@/personal-staff/ui/personal-sign-in', () => ({
  PersonalSignIn: ({ workspace }: { workspace: { company_id: string; business_id: string } }) => (
    <p>{`sign-in ${workspace.company_id} ${workspace.business_id}`}</p>
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

function sessionState(session: typeof SESSION | null, epoch = 0) {
  return {
    epoch,
    online: true,
    loading: false,
    confirmedNoSession: session === null,
    session,
    changed: vi.fn(),
    signOut: vi.fn(),
  };
}

function flow(
  business: PersonalWorkspace | null = REMEMBERED,
  businessUnreadable = false,
  mustClearLeftoverSession = false,
) {
  return (
    <EmployeeFlow
      business={business}
      businessUnreadable={businessUnreadable}
      mustClearLeftoverSession={mustClearLeftoverSession}
      pending={null}
      busy={false}
      connect={<p>connect</p>}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />
  );
}

function mount(
  business: PersonalWorkspace | null = REMEMBERED,
  businessUnreadable = false,
  mustClearLeftoverSession = false,
) {
  return render(
    <LocaleProvider locale="ar" setLocale={() => undefined}>
      {flow(business, businessUnreadable, mustClearLeftoverSession)}
    </LocaleProvider>,
  );
}

function redraw(view: ReturnType<typeof render>) {
  view.rerender(
    <LocaleProvider locale="ar" setLocale={() => undefined}>
      {flow()}
    </LocaleProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(endPersonalSession).mockResolvedValue('done');
  vi.mocked(usePersonalSession).mockReturnValue(sessionState(SESSION));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('EmployeeFlow with a session of another business', () => {
  it('hides the old business screens while its session is being ended', async () => {
    mount();

    expect(await screen.findByRole('status')).not.toBeNull();
    expect(screen.queryByText(`session screen ${SESSION.employee_id}`)).toBeNull();
    expect(endPersonalSession).toHaveBeenCalledTimes(1);
  });

  it('offers another try when the sign-out is refused', async () => {
    vi.mocked(endPersonalSession).mockResolvedValue('failed');
    mount();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.roleChangeFailed'));
    expect(screen.queryByText(`session screen ${SESSION.employee_id}`)).toBeNull();
  });

  it('ends the session again when the employee asks and locks the button while it runs', async () => {
    vi.mocked(endPersonalSession).mockResolvedValueOnce('failed');
    let release!: (result: 'done' | 'failed') => void;
    vi.mocked(endPersonalSession).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    mount();

    fireEvent.click(await screen.findByRole('button', { name: t('ar', 'nativeShell.retry') }));

    expect(endPersonalSession).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('button', { name: t('ar', 'nativeShell.retry') }).hasAttribute('disabled'),
    ).toBe(true);

    await act(async () => {
      release('failed');
    });
  });
});

describe('EmployeeFlow when the same foreign session reads back', () => {
  it('shows the alert and the retry again after a refused sign-out', async () => {
    vi.mocked(endPersonalSession).mockResolvedValue('failed');
    const view = mount();
    await screen.findByRole('alert');
    expect(endPersonalSession).toHaveBeenCalledTimes(1);

    vi.mocked(usePersonalSession).mockReturnValue(sessionState(null));
    await act(async () => {
      redraw(view);
    });
    expect(screen.getByText(`sign-in ${COMPANY} ${BUSINESS}`)).not.toBeNull();

    vi.mocked(usePersonalSession).mockReturnValue(sessionState({ ...SESSION }));
    await act(async () => {
      redraw(view);
    });

    expect(screen.getByRole('alert')).not.toBeNull();
    expect(screen.getByRole('button', { name: t('ar', 'nativeShell.retry') })).not.toBeNull();
    expect(endPersonalSession).toHaveBeenCalledTimes(1);
  });

  it('fails a done attempt when the same session reads back', async () => {
    const view = mount();
    expect(await screen.findByRole('status')).not.toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    expect(endPersonalSession).toHaveBeenCalledTimes(1);

    vi.mocked(usePersonalSession).mockReturnValue(sessionState(null));
    await act(async () => {
      redraw(view);
    });
    expect(screen.getByText(`sign-in ${COMPANY} ${BUSINESS}`)).not.toBeNull();

    vi.mocked(usePersonalSession).mockReturnValue(sessionState({ ...SESSION }));
    await act(async () => {
      redraw(view);
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.roleChangeFailed'));
    expect(
      screen.getByRole('button', { name: t('ar', 'nativeShell.retry') }).hasAttribute('disabled'),
    ).toBe(false);
    expect(endPersonalSession).toHaveBeenCalledTimes(1);
  });
});

describe('EmployeeFlow with a session of the remembered business or none', () => {
  it('shows the session screen of the remembered business, with no sign-out', async () => {
    vi.mocked(usePersonalSession).mockReturnValue(
      sessionState({ ...SESSION, business_id: BUSINESS }),
    );
    mount();

    expect(await screen.findByText(`session screen ${SESSION.employee_id}`)).not.toBeNull();
    expect(screen.queryByText(`sign-in ${COMPANY} ${BUSINESS}`)).toBeNull();
    expect(endPersonalSession).not.toHaveBeenCalled();
  });

  it('shows the sign-in of the remembered business when there is no session', async () => {
    vi.mocked(usePersonalSession).mockReturnValue(sessionState(null));
    mount();

    expect(await screen.findByText(`sign-in ${COMPANY} ${BUSINESS}`)).not.toBeNull();
    expect(endPersonalSession).not.toHaveBeenCalled();
  });
});

describe('EmployeeFlow without a remembered business', () => {
  it('signs the live personal session out before showing the personal screen', async () => {
    mount(null);

    expect(await screen.findByRole('status')).not.toBeNull();
    expect(screen.queryByText(`session screen ${SESSION.employee_id}`)).toBeNull();
    expect(endPersonalSession).toHaveBeenCalledTimes(1);
  });

  it('shows the failure and the retry instead of the old screens when the sign-out is refused', async () => {
    vi.mocked(endPersonalSession).mockResolvedValue('failed');
    mount(null);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.roleChangeFailed'));
    expect(screen.getByRole('button', { name: t('ar', 'nativeShell.retry') })).not.toBeNull();
    expect(screen.queryByText(`session screen ${SESSION.employee_id}`)).toBeNull();
  });

  it('hides private screens without signing out when the business could not be read', async () => {
    mount(null, true);

    expect(await screen.findByText('connect')).not.toBeNull();
    expect(screen.queryByText(`session screen ${SESSION.employee_id}`)).toBeNull();
    expect(endPersonalSession).not.toHaveBeenCalled();
  });
});

describe('EmployeeFlow first link and foreign sign-out abort', () => {
  it('signs out a leftover same-business session after connecting without a remembered business, then opens after fresh sign-in', async () => {
    vi.mocked(usePersonalSession).mockReturnValue(
      sessionState({ ...SESSION, business_id: BUSINESS }, 0),
    );
    const view = mount(REMEMBERED, false, true);

    expect(await screen.findByRole('status')).not.toBeNull();
    expect(screen.queryByText(`session screen ${SESSION.employee_id}`)).toBeNull();
    expect(endPersonalSession).toHaveBeenCalledTimes(1);

    vi.mocked(usePersonalSession).mockReturnValue(
      sessionState({ ...SESSION, business_id: BUSINESS }, 1),
    );
    view.rerender(
      <LocaleProvider locale="ar" setLocale={() => undefined}>
        {flow(REMEMBERED, false, true)}
      </LocaleProvider>,
    );

    expect(await screen.findByText(`session screen ${SESSION.employee_id}`)).not.toBeNull();
  });

  it('aborts an in-flight foreign sign-out request when the wait timer expires', () => {
    vi.useFakeTimers();
    let received: AbortSignal | undefined;
    vi.mocked(endPersonalSession).mockImplementation((signal?: AbortSignal) => {
      received = signal;
      return new Promise<'done' | 'failed'>(() => undefined);
    });

    mount();

    expect(received).toBeInstanceOf(AbortSignal);
    expect(received?.aborted).toBe(false);

    act(() => {
      vi.advanceTimersByTime(FOREIGN_SIGN_OUT_WAIT_MS);
    });

    expect(received?.aborted).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain(
      t('ar', 'nativeShell.roleChangeFailed'),
    );
  });
});
