import { render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { PersonalScreen } from './personal-screen';

vi.mock('../api/use-personal-session', () => ({
  usePersonalSession: () => ({
    epoch: 0,
    online: true,
    loading: false,
    session: null,
    changed: vi.fn(),
    signOut: vi.fn(),
  }),
}));

const WORKSPACE = {
  company_id: '00000000-0000-4000-8000-000000000001',
  business_id: '00000000-0000-4000-8000-000000000002',
};

function mount(props: { workspace?: typeof WORKSPACE; connect?: ReactNode }) {
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
});
