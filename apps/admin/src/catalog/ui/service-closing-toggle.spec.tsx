import type { ReactNode } from 'react';
import type { Service } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ServiceEditPanel } from './service-edit-panel';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
const localeState = vi.hoisted(() => ({ selected: 'en' as Locale }));
vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({ GET: get, POST: post, PATCH: patch }),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => localeState.selected }));

const companyId = '01920000-0000-7000-8000-000000000001';
const businessId = '01920000-0000-7000-8000-000000000002';
const userId = '01920000-0000-7000-8000-000000000003';
const serviceId = '01920000-0000-7000-8000-0000000000a1';
const detailRoute = '/v1/businesses/{businessId}/services/{serviceId}';
const closeRoute = '/v1/businesses/{businessId}/services/{serviceId}/close';
const reopenRoute = '/v1/businesses/{businessId}/services/{serviceId}/reopen';

function serviceRecord(overrides: Partial<Service> = {}): Service {
  return {
    id: serviceId,
    business_id: businessId,
    name_en: 'Hair cut',
    name_ar: 'Hair cut AR',
    price: '12.500',
    commission_rule: { kind: 'FOLLOW_PLAN' },
    counts_toward_threshold: true,
    duration_minutes: 90,
    category_id: null,
    category: null,
    closed_at: null,
    revision: 1,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <div dir={localeState.selected === 'ar' ? 'rtl' : 'ltr'}>{children}</div>
    </QueryClientProvider>
  );
}

// تفاصيل الخدمة بتتقرأ مرة في البداية ومرة تانية بعد رفض بيبطل مفتاح التفاصيل، فالسجلات بتترد بالترتيب.
function mockDetailSequence(records: Service[]) {
  let reads = 0;
  get.mockImplementation((path: string) => {
    if (path === detailRoute) {
      const record = records[Math.min(reads, records.length - 1)];
      reads += 1;
      return Promise.resolve({ data: record, response: { status: 200 } });
    }
    if (path === '/v1/businesses/{businessId}/service-categories') {
      return Promise.resolve({ data: { items: [], next_cursor: null }, response: { status: 200 } });
    }
    return Promise.resolve({ data: {}, response: { status: 200 } });
  });
}

function renderPanel(locale: Locale, client = createQueryClient()) {
  localeState.selected = locale;
  render(
    <ServiceEditPanel
      companyId={companyId}
      businessId={businessId}
      userId={userId}
      serviceId={serviceId}
      onClose={vi.fn()}
    />,
    { wrapper: wrapper(client) },
  );
}

function refused(code: string, messageEn: string, messageAr: string, status: number) {
  return {
    error: { code, message_ar: messageAr, message_en: messageEn },
    response: { status },
  };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  localeState.selected = 'en';
});

it.each(['en', 'ar'] as const)(
  'an open service asks once, closes, and the panel flips to closed in %s',
  async (locale) => {
    mockDetailSequence([serviceRecord()]);
    post.mockResolvedValueOnce({
      data: serviceRecord({ closed_at: '2026-11-20T10:00:00Z', revision: 2 }),
      response: { status: 200 },
    });
    renderPanel(locale);
    const badge = await screen.findByText(t(locale, 'catalogServiceCategories.open'));
    expect(badge.closest('[dir]')?.getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    fireEvent.click(
      screen.getByRole('button', { name: t(locale, 'catalogServices.closeService') }),
    );
    expect(await screen.findByText(t(locale, 'catalogServices.closeServiceConfirm'))).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: t(locale, 'catalogServices.closeService') }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: t(locale, 'catalogServices.closeServiceConfirmAction') }),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(closeRoute, {
        params: { header: { 'x-company-id': companyId }, path: { businessId, serviceId } },
        body: { expected_revision: 1 },
      }),
    );
    expect(await screen.findByText(t(locale, 'catalogServiceCategories.closed'))).toBeTruthy();
    expect(
      screen.getByRole('button', { name: t(locale, 'catalogServices.reopenService') }),
    ).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(t(locale, 'catalogServices.serviceClosed'));
  },
);

it('cancelling the confirmation posts nothing and keeps the open badge', async () => {
  const locale: Locale = 'en';
  mockDetailSequence([serviceRecord()]);
  renderPanel(locale);
  await screen.findByText('Open');
  fireEvent.click(screen.getByRole('button', { name: 'Close service' }));
  await screen.findByText(t(locale, 'catalogServices.closeServiceConfirm'));
  fireEvent.click(
    screen.getByRole('button', { name: t(locale, 'catalogServiceCategories.cancel') }),
  );
  expect(screen.queryByRole('status')).toBeNull();
  expect(post).not.toHaveBeenCalled();
  expect(screen.getByText('Open')).toBeTruthy();
  expect(screen.queryByText(t(locale, 'catalogServices.closeServiceConfirm'))).toBeNull();
});

it('a closed service reopens at once without a confirmation', async () => {
  const locale: Locale = 'en';
  mockDetailSequence([
    serviceRecord({ closed_at: '2026-11-19T09:00:00Z', revision: 2 }),
    serviceRecord({ revision: 3 }),
  ]);
  post.mockResolvedValueOnce({ data: serviceRecord({ revision: 3 }), response: { status: 200 } });
  renderPanel(locale);
  const reopen = await screen.findByRole('button', { name: 'Reopen service' });
  expect(screen.queryByText(t(locale, 'catalogServices.closeServiceConfirm'))).toBeNull();
  fireEvent.click(reopen);
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(reopenRoute, {
      params: { header: { 'x-company-id': companyId }, path: { businessId, serviceId } },
      body: { expected_revision: 2 },
    }),
  );
  expect(await screen.findByText('Open')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe(t(locale, 'catalogServices.serviceReopened'));
});

it.each(['en', 'ar'] as const)(
  'a refused reopen (SERVICE_CATEGORY_CLOSED) shows the envelope message in %s and keeps the closed badge',
  async (locale) => {
    mockDetailSequence([serviceRecord({ closed_at: '2026-11-19T09:00:00Z', revision: 2 })]);
    post.mockResolvedValueOnce(
      refused(
        'SERVICE_CATEGORY_CLOSED',
        'The category is closed',
        'The category is closed AR',
        409,
      ),
    );
    renderPanel(locale);
    fireEvent.click(
      await screen.findByRole('button', { name: t(locale, 'catalogServices.reopenService') }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      locale === 'ar' ? 'The category is closed AR' : 'The category is closed',
    );
    expect(screen.getByText(t(locale, 'catalogServiceCategories.closed'))).toBeTruthy();
    const detailCalls = get.mock.calls.filter(([path]) => path === detailRoute);
    expect(detailCalls.length).toBe(1);
  },
);

it('a 409 SERVICE_REVISION_CONFLICT shows its message and the refetched badge shows the server state', async () => {
  const locale: Locale = 'en';
  mockDetailSequence([
    serviceRecord({ revision: 1 }),
    serviceRecord({ closed_at: '2026-11-20T12:00:00Z', revision: 5 }),
  ]);
  post.mockResolvedValueOnce(refused('SERVICE_REVISION_CONFLICT', 'Conflict', 'Conflict AR', 409));
  renderPanel(locale);
  fireEvent.click(await screen.findByRole('button', { name: 'Close service' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByRole('alert').then((alert) => alert.textContent)).toBe('Conflict');
  expect(await screen.findByText('Closed')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reopen service' })).toBeTruthy();
});

it('a 403 shows the envelope message and the badge does not change', async () => {
  const locale: Locale = 'en';
  mockDetailSequence([serviceRecord()]);
  post.mockResolvedValueOnce(refused('FORBIDDEN', 'Forbidden', 'Forbidden AR', 403));
  renderPanel(locale);
  fireEvent.click(await screen.findByRole('button', { name: 'Close service' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByRole('alert').then((alert) => alert.textContent)).toBe('Forbidden');
  expect(screen.getByText('Open')).toBeTruthy();
  expect(screen.queryByRole('status')).toBeNull();
});

it('after a close and a reopen the close confirmation asks again and posts the fresh revision', async () => {
  const locale: Locale = 'en';
  mockDetailSequence([serviceRecord()]);
  post.mockResolvedValueOnce({
    data: serviceRecord({ closed_at: '2026-11-20T10:00:00Z', revision: 2 }),
    response: { status: 200 },
  });
  post.mockResolvedValueOnce({ data: serviceRecord({ revision: 3 }), response: { status: 200 } });
  post.mockResolvedValueOnce({
    data: serviceRecord({ closed_at: '2026-11-20T12:00:00Z', revision: 4 }),
    response: { status: 200 },
  });
  renderPanel(locale);
  await screen.findByText('Open');
  fireEvent.click(screen.getByRole('button', { name: 'Close service' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByText('Closed')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Reopen service' }));
  expect(await screen.findByText('Open')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close service' }));
  expect(await screen.findByText(t(locale, 'catalogServices.closeServiceConfirm'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(post).toHaveBeenLastCalledWith(closeRoute, {
      params: { header: { 'x-company-id': companyId }, path: { businessId, serviceId } },
      body: { expected_revision: 3 },
    }),
  );
  expect(await screen.findByText('Closed')).toBeTruthy();
});

it('a dirty edit form blocks closing with a hint until the edits are saved', async () => {
  const locale: Locale = 'en';
  mockDetailSequence([serviceRecord()]);
  patch.mockResolvedValueOnce({ data: serviceRecord({ revision: 2 }), response: { status: 200 } });
  renderPanel(locale);
  await screen.findByText('Open');
  expect(
    (screen.getByRole('button', { name: 'Close service' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  fireEvent.change(screen.getByLabelText('English name'), { target: { value: 'Renamed' } });
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Close service' }) as HTMLButtonElement).disabled,
    ).toBe(true),
  );
  expect(screen.getByText(t(locale, 'catalogServices.editsUnsaved'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Service updated.')).toBeTruthy();
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Close service' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(screen.queryByText(t(locale, 'catalogServices.editsUnsaved'))).toBeNull();
});

it('the edit form is disabled while close is in flight', async () => {
  const locale: Locale = 'en';
  mockDetailSequence([serviceRecord()]);
  let resolveClose!: (value: unknown) => void;
  post.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveClose = resolve;
    }),
  );
  renderPanel(locale);
  await screen.findByText('Open');
  fireEvent.click(screen.getByRole('button', { name: 'Close service' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(
      true,
    ),
  );
  // jsdom ما بينفذش تعطيل fieldset على الأزرار جواه، فالتحقق بيكون على الخاصية نفسها.
  expect(screen.getByRole('button', { name: 'Save changes' }).closest('fieldset')?.disabled).toBe(
    true,
  );
  resolveClose({
    data: serviceRecord({ closed_at: '2026-11-20T10:00:00Z', revision: 2 }),
    response: { status: 200 },
  });
  expect(await screen.findByText('Service closed.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Save changes' }).closest('fieldset')?.disabled).toBe(
    false,
  );
});

it('reloading clears the closing result', async () => {
  const locale: Locale = 'en';
  mockDetailSequence([serviceRecord()]);
  post.mockResolvedValueOnce({
    data: serviceRecord({ closed_at: '2026-11-20T10:00:00Z', revision: 2 }),
    response: { status: 200 },
  });
  renderPanel(locale);
  await screen.findByText('Open');
  fireEvent.click(screen.getByRole('button', { name: 'Close service' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByText('Service closed.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Reload service' }));
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  expect(screen.queryByText('Service closed.')).toBeNull();
});

it('saving clears the closing result', async () => {
  const locale: Locale = 'en';
  mockDetailSequence([serviceRecord()]);
  post.mockResolvedValueOnce({
    data: serviceRecord({ closed_at: '2026-11-20T10:00:00Z', revision: 2 }),
    response: { status: 200 },
  });
  patch.mockResolvedValueOnce({ data: serviceRecord({ revision: 3 }), response: { status: 200 } });
  renderPanel(locale);
  await screen.findByText('Open');
  fireEvent.click(screen.getByRole('button', { name: 'Close service' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByText('Service closed.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Service updated.')).toBeTruthy();
  expect(screen.queryByText('Service closed.')).toBeNull();
});
