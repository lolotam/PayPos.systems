import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t, type Locale } from '@pospay/i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { EmployeeCardSection } from './employee-card-section';

const IDS = {
  company: '00000000-0000-4000-8000-000000000001',
  business: '00000000-0000-4000-8000-000000000002',
  user: '00000000-0000-4000-8000-000000000003',
  employee: '00000000-0000-4000-8000-000000000004',
  card: '00000000-0000-4000-8000-000000000005',
};

const localeState = vi.hoisted(() => ({ current: 'en' as Locale }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => localeState.current }));

// apiClient() caches its singleton fetch function on first call, so delegate through one handler.
const fetchHandler = vi.fn<(request: Request) => Promise<Response>>();

function activeCardBody(suffix: string) {
  return {
    active: {
      id: IDS.card,
      employee_id: IDS.employee,
      card_code_suffix: suffix,
      issued_at: '2026-10-07T10:00:00.000Z',
      revoked_at: null,
    },
    can_manage: true,
  };
}

function renderCardSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EmployeeCardSection
        companyId={IDS.company}
        businessId={IDS.business}
        userId={IDS.user}
        employeeId={IDS.employee}
      />
    </QueryClientProvider>,
  );
}

function submitCardCode(locale: Locale, code: string) {
  fireEvent.change(screen.getByLabelText(t(locale, 'employeeCard.issue')), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole('button', { name: t(locale, 'employeeCard.issueAction') }));
}

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.staging.pospay.systems');
  vi.stubGlobal('fetch', (request: Request) => fetchHandler(request));
});

beforeEach(() => {
  localeState.current = 'en';
  fetchHandler.mockReset();
  HTMLDialogElement.prototype.showModal = vi.fn(function show(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function hide(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(['', 'EFGH'])(
  'displays only the permitted suffix %s and masks the issue field',
  async (suffix) => {
    fetchHandler.mockImplementation(async () =>
      Response.json(activeCardBody(suffix), { status: 200 }),
    );
    renderCardSection();
    const label = t('en', 'employeeCard.active');
    const expected = suffix ? `${label}: ••••${suffix}` : label;
    await screen.findByText(expected);
    const input = screen.getByLabelText(t('en', 'employeeCard.issue')) as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.classList.contains('card-code-mask')).toBe(true);
    expect(input.autocomplete).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('autocapitalize')).toBe('off');
  },
);

it('requires explicit dialog confirmation before revoking an active card (#123)', async () => {
  let active = true;
  fetchHandler.mockImplementation(async (request: Request) => {
    if (request.method === 'POST' && request.url.endsWith(`/cards/${IDS.card}/revoke`)) {
      active = false;
      return Response.json(
        { ...activeCardBody('EFGH').active, revoked_at: '2026-10-07T11:00:00.000Z' },
        { status: 200 },
      );
    }
    return Response.json(active ? activeCardBody('EFGH') : { active: null, can_manage: true }, {
      status: 200,
    });
  });

  renderCardSection();
  await screen.findByRole('button', { name: t('en', 'employeeCard.revoke') });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeCard.revoke') }));
  expect(screen.getByText(t('en', 'employeeCard.revokeConfirmTitle'))).not.toBeNull();
  expect(fetchHandler.mock.calls.filter(([req]) => req.method === 'POST')).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeCard.revokeCancel') }));
  expect(screen.queryByText(t('en', 'employeeCard.revokeConfirmTitle'))).toBeNull();
  expect(fetchHandler.mock.calls.filter(([req]) => req.method === 'POST')).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeCard.revoke') }));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeCard.revokeConfirm') }));
  await screen.findByText(t('en', 'employeeCard.none'));
  const revokeCalls = fetchHandler.mock.calls.filter(([req]) => req.method === 'POST');
  expect(revokeCalls).toHaveLength(1);
  expect(revokeCalls[0]?.[0].headers.get('Idempotency-Key')).toBeTruthy();
});

it.each(['ar', 'en'] as const)(
  'parses Retry-After across JSON and empty-body 429 responses in %s (#123)',
  async (locale) => {
    localeState.current = locale;
    const envelope = {
      code: 'TOO_MANY_REQUESTS',
      message_ar: t('ar', 'errors.TOO_MANY_REQUESTS'),
      message_en: t('en', 'errors.TOO_MANY_REQUESTS'),
    };
    const issueResponses = [
      Response.json(envelope, { status: 429, headers: { 'Retry-After': '120' } }),
      new Response(null, { status: 429, headers: { 'Retry-After': '45' } }),
      Response.json(envelope, {
        status: 429,
        headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' },
      }),
    ];
    let issueAttempt = 0;
    fetchHandler.mockImplementation(async (request: Request) => {
      if (request.method === 'GET') {
        return Response.json({ active: null, can_manage: true }, { status: 200 });
      }
      const next = issueResponses[issueAttempt++];
      if (!next) throw new Error('Unexpected POST attempt');
      return next;
    });

    renderCardSection();
    await screen.findByText(t(locale, 'employeeCard.none'));

    submitCardCode(locale, 'CARD-TEST-0001');
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        t(locale, 'employeeCard.issueLimitedFor').replace('{seconds}', '120'),
      ),
    );

    submitCardCode(locale, 'CARD-TEST-0002');
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        t(locale, 'employeeCard.issueLimitedFor').replace('{seconds}', '45'),
      ),
    );

    submitCardCode(locale, 'CARD-TEST-0003');
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(t(locale, 'errors.TOO_MANY_REQUESTS')),
    );
  },
);
