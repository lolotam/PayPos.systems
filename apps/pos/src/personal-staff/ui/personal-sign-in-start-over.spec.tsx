import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { usePersonalSignIn } from '../api/use-personal-sign-in';
import { PersonalSignIn } from './personal-sign-in';

vi.mock('../api/use-personal-sign-in', () => ({ usePersonalSignIn: vi.fn() }));

const WORKSPACE = {
  company_id: '00000000-0000-4000-8000-000000000001',
  business_id: '00000000-0000-4000-8000-000000000002',
};

beforeEach(() => {
  vi.clearAllMocks();
});

it.each([
  { pending: false, visible: true },
  { pending: true, visible: false },
])('shows Back correctly when pending=$pending', ({ pending, visible }) => {
  vi.mocked(usePersonalSignIn).mockReturnValue({
    pending,
    challenge: null,
    error: null,
    request: vi.fn(async () => undefined),
    verify: vi.fn(async () => undefined),
    restart: vi.fn(),
  });
  render(
    <LocaleProvider locale="en" setLocale={() => undefined}>
      <PersonalSignIn workspace={WORKSPACE} changed={vi.fn()} startOver={<button>back</button>} />
    </LocaleProvider>,
  );

  const back = screen.queryByRole('button', { name: 'back' });
  if (visible) expect(back).not.toBeNull();
  else expect(back).toBeNull();
});
