import { render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { usePersonalSession } from '../api/use-personal-session';
import { PersonalScreen } from './personal-screen';

vi.mock('../api/use-personal-session', () => ({
  usePersonalSession: vi.fn(() => ({
    epoch: 0,
    online: true,
    loading: false,
    session: null,
    changed: vi.fn(),
    signOut: vi.fn(),
  })),
}));
vi.mock('./enrol-passkey-screen', () => ({
  EnrolPasskeyScreen: ({ employeeId }: { employeeId: string }) => (
    <p>{`session screen ${employeeId}`}</p>
  ),
}));
vi.mock('../push/push-browser', () => ({
  supportsPush: () => false,
  isIosDevice: () => false,
  isStandalone: () => false,
  notificationPermission: () => 'default' as const,
  currentSubscription: async () => null,
}));
vi.mock('../push/push-calls', () => ({
  pushCalls: {
    config: vi.fn(async () => ({ kind: 'not-ready' as const })),
    register: vi.fn(async () => undefined),
    revoke: vi.fn(async () => undefined),
  },
}));
vi.mock('../push/push-record-idb', () => ({
  pushRecordStore: { read: async () => null, write: async () => undefined, remove: async () => undefined },
}));

const WORKSPACE = {
  company_id: '00000000-0000-4000-8000-000000000001',
  business_id: '00000000-0000-4000-8000-000000000002',
};

const SESSION = {
  user_id: 'user',
  employee_id: 'employee',
  company_id: 'company',
  business_id: 'business',
  expires_at: '2026-10-05T12:00:00Z',
};

function mount(props: ComponentProps<typeof PersonalScreen>) {
  render(
    <LocaleProvider locale="en" setLocale={() => undefined}>
      <PersonalScreen {...props} />
    </LocaleProvider>,
  );
}

describe('PersonalScreen props', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    vi.mocked(usePersonalSession).mockReturnValue({
      epoch: 0,
      online: true,
      loading: false,
      session: null,
      changed: vi.fn(),
      signOut: vi.fn(),
    });
  });

  it('signs the employee in with the workspace it is given, with no query string', () => {
    mount({ workspace: WORKSPACE });

    expect(window.location.search).toBe('');
    expect(screen.getByLabelText(t('en', 'staffLogin.phone'))).not.toBeNull();
    expect(screen.queryByText(t('en', 'personalStaff.linkRequired'))).toBeNull();
  });

  it('shows the connect slot under the line that asks the manager', () => {
    mount({ connect: <p>paste here</p> });

    const asked = screen.getByText(t('en', 'personalStaff.linkRequired'));
    const connect = screen.getByText('paste here');

    expect(asked.compareDocumentPosition(connect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows what the session gate returns instead of the session screen', () => {
    vi.mocked(usePersonalSession).mockReturnValue({
      epoch: 0,
      online: true,
      loading: false,
      session: SESSION,
      changed: vi.fn(),
      signOut: vi.fn(),
    });
    mount({ sessionGate: () => <p>the gate says no</p> });

    expect(screen.getByText('the gate says no')).not.toBeNull();
    expect(screen.queryByText(`session screen ${SESSION.employee_id}`)).toBeNull();
  });

  it('shows the session screen when the gate lets the session through', () => {
    vi.mocked(usePersonalSession).mockReturnValue({
      epoch: 0,
      online: true,
      loading: false,
      session: SESSION,
      changed: vi.fn(),
      signOut: vi.fn(),
    });
    mount({ sessionGate: () => null });

    expect(screen.getByText(`session screen ${SESSION.employee_id}`)).not.toBeNull();
    expect(screen.queryByText('the gate says no')).toBeNull();
  });
});
