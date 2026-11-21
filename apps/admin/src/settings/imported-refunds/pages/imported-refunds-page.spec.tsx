import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ImportedRefundsPage } from './imported-refunds-page';

const api = vi.hoisted(() => ({
  GET: vi.fn(),
  PUT: vi.fn(),
}));
const state = vi.hoisted(() => ({
  workspace: undefined as WorkspaceController | undefined,
  userId: 'user' as string | null,
}));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => state.userId }));
vi.mock('@/workspace/model/workspace-provider', () => ({ useWorkspace: () => state.workspace }));

const id = '01920000-0000-7000-8000-0000000000c1';
const heading = t('en', 'importedRefunds.title');
const label = t('en', 'importedRefunds.label');
const offNote = t('en', 'importedRefunds.offNote');
const refused = t('en', 'importedRefunds.notAllowed');

function renderPage(businessId = id, sharedClient?: QueryClient) {
  const client =
    sharedClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  const view = render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <ImportedRefundsPage companyId={id} userId="user" businessId={businessId} />
      </DirectionProvider>
    </QueryClientProvider>,
  );
  return { client, view };
}

beforeEach(() => {
  api.GET.mockReset();
  api.PUT.mockReset();
  api.GET.mockResolvedValue({
    data: { imported_refunds_enabled: false },
    response: { status: 200 },
  });
  state.userId = 'user';
  state.workspace = {
    status: 'ready',
    company: {
      id,
      name_ar: null,
      name_en: 'Synthetic company',
      businesses: [],
      role_code: 'owner',
      scope: 'COMPANY',
    },
    business: { id, name_ar: null, name_en: 'Synthetic business', branches: [] },
    branch: undefined,
    companies: [],
    choose: vi.fn(),
  };
});

it('shows the switch off with the off note for a business that never touched it', async () => {
  renderPage();
  const control = await screen.findByRole('switch', { name: label });
  expect((control as HTMLInputElement).checked).toBe(false);
  expect(screen.getByRole('status').textContent).toContain(offNote);
  expect(screen.getByRole('heading', { name: heading }).textContent).toBe(heading);
});

it('shows the switch on after the server confirms a save', async () => {
  api.GET.mockResolvedValue({
    data: { imported_refunds_enabled: true },
    response: { status: 200 },
  });
  renderPage();
  const control = await screen.findByRole('switch', { name: label });
  expect((control as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByRole('status')).toBeNull();
});

it('a failed save brings back the last value the server confirmed, with an error message', async () => {
  api.PUT.mockResolvedValue({ error: { code: 'INTERNAL_ERROR' }, response: { status: 500 } });
  renderPage();
  const control = await screen.findByRole('switch', { name: label });
  fireEvent.click(control);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  await waitFor(() =>
    expect((screen.getByRole('switch', { name: label }) as HTMLInputElement).checked).toBe(false),
  );
  expect(screen.getByRole('status').textContent).toContain(offNote);
  expect(api.PUT).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/settings/imported-refunds',
    expect.objectContaining({
      params: expect.objectContaining({ path: { businessId: id } }),
      body: { imported_refunds_enabled: true },
    }),
  );
});

it('a 403 read shows a not-allowed message with no control', async () => {
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  renderPage();
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(refused));
  expect(screen.queryByRole('switch')).toBeNull();
});

it('a denied write shows the refusal and the guarded GET reestablishes the confirmed value', async () => {
  api.PUT.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  const { client, view } = renderPage();
  const control = await screen.findByRole('switch', { name: label });
  let finishProof: (value: unknown) => void = () => undefined;
  api.GET.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishProof = resolve;
      }),
  );
  fireEvent.click(control);
  // الـ GET المحمي لازم يثبت الصلاحية من جديد، والمفتاح مختفي طول انتظار الرد.
  await waitFor(() => expect(screen.queryByRole('switch')).toBeNull());
  finishProof({ data: { imported_refunds_enabled: false }, response: { status: 200 } });
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(t('en', 'importedRefunds.notAllowed')),
  );
  await waitFor(() => {
    const settled = screen.getByRole('switch', { name: label }) as HTMLInputElement;
    expect(settled.checked).toBe(false);
    expect(settled.disabled).toBe(false);
  });
  expect(api.GET).toHaveBeenCalledTimes(2);
  client.clear();
  view.unmount();
});

it('a read denial while a write is in flight wins over the late write settlement', async () => {
  api.GET.mockResolvedValueOnce({
    data: { imported_refunds_enabled: true },
    response: { status: 200 },
  });
  let releaseWrite: (value: unknown) => void = () => undefined;
  api.PUT.mockImplementation(
    () =>
      new Promise((resolve) => {
        releaseWrite = resolve;
      }),
  );
  const { client, view } = renderPage();
  const control = await screen.findByRole('switch', { name: label });
  expect((control as HTMLInputElement).checked).toBe(true);
  fireEvent.click(control);
  // قراية أحدث مرفوضة (زي refetch بعد سحب التفويض) بتظهر الرفض وتشيل التحكم فورًا.
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  await client.invalidateQueries({ queryKey: ['imported-refunds', id, 'user', id] });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(refused));
  expect(screen.queryByRole('switch')).toBeNull();
  // تسوية الكتابة القديمة (حتى لو نجحت) ما بترجعش المفتاح: الرفض بيفضل هو العرض الوحيد.
  releaseWrite({ data: { imported_refunds_enabled: true }, response: { status: 200 } });
  await waitFor(() => expect(api.GET.mock.calls.length).toBeGreaterThan(2));
  expect(screen.getByRole('alert').textContent).toContain(refused);
  expect(screen.queryByRole('switch')).toBeNull();
  client.clear();
  view.unmount();
});

it('a changed scope refetches its own value and ignores late answers of the previous one', async () => {
  const otherBusiness = '01920000-0000-7000-8000-0000000000d1';
  let releaseFirst: (value: unknown) => void = () => undefined;
  api.GET.mockImplementation(
    (_path: string, options?: { params?: { path?: Record<string, string> } }) => {
      const business = options?.params?.path?.businessId;
      if (business === id) {
        // قراية النشاط القديم معلّقة، وبتتحل متأخر جدًا بعد ما النطاق اتبدّل خالص.
        return new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Promise.resolve({
        data: { imported_refunds_enabled: business === otherBusiness },
        response: { status: 200 },
      });
    },
  );
  const first = renderPage();
  // تغيير النشاط في الـ workspace بيعمل remount بمفتاح كويري جديد: قيمة النشاط الجديد هي المعروضة،
  // ورد النشاط القديم المتأخر ما بيلمسش المفتاح الجديد.
  const second = renderPage(otherBusiness, first.client);
  const control = await screen.findByRole('switch', { name: label });
  expect((control as HTMLInputElement).checked).toBe(true);
  first.view.unmount();
  releaseFirst({ data: { imported_refunds_enabled: false }, response: { status: 200 } });
  await waitFor(() => expect((control as HTMLInputElement).checked).toBe(true));
  expect(
    api.GET.mock.calls.filter(
      (call) =>
        (call[1] as { params?: { path?: { businessId?: string } } })?.params?.path?.businessId ===
        otherBusiness,
    ).length,
  ).toBeGreaterThan(0);
  second.client.clear();
  second.view.unmount();
});

it('a preseeded switch stays hidden while the current GET is pending, shows after it authorizes, and a denial hides it', async () => {
  api.GET.mockImplementation(() => new Promise(() => undefined));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  client.setQueryData(['imported-refunds', id, 'user', id], { imported_refunds_enabled: true });
  const { view } = renderPage(id, client);
  // كاش متخزن وقراية حالية معلّقة: المفتاح مخفي بالكامل قبل الإثبات.
  await waitFor(() => expect(screen.queryByRole('switch', { name: label })).toBeNull());
  api.GET.mockResolvedValue({
    data: { imported_refunds_enabled: true },
    response: { status: 200 },
  });
  await client.invalidateQueries({ queryKey: ['imported-refunds', id, 'user', id] });
  const control = await screen.findByRole('switch', { name: label });
  expect((control as HTMLInputElement).checked).toBe(true);
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  await client.invalidateQueries({ queryKey: ['imported-refunds', id, 'user', id] });
  await waitFor(() => expect(screen.queryByRole('switch', { name: label })).toBeNull());
  expect(screen.getByRole('alert').textContent).toContain(refused);
  view.unmount();
  client.clear();
});

it('a denied write stays visible even when the following GET equals the requested value', async () => {
  // الكتابة اترفض وقيمة الخادم بعدها بقت مساوية للقيمة المطلوبة (فاعل تاني شغّلها):
  // رسالة الرفض بتفضل ظاهرة وما بتختفيش، والقيمة المعروضة هي القيمة المؤكدة من الخادم.
  api.GET.mockResolvedValueOnce({
    data: { imported_refunds_enabled: false },
    response: { status: 200 },
  }).mockResolvedValue({ data: { imported_refunds_enabled: true }, response: { status: 200 } });
  api.PUT.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  renderPage();
  const control = await screen.findByRole('switch', { name: label });
  expect((control as HTMLInputElement).checked).toBe(false);
  fireEvent.click(control);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  await waitFor(() =>
    expect((screen.getByRole('switch', { name: label }) as HTMLInputElement).disabled).toBe(false),
  );
  expect(screen.getByRole('alert').textContent).toContain(t('en', 'importedRefunds.notAllowed'));
  expect((screen.getByRole('switch', { name: label }) as HTMLInputElement).checked).toBe(true);
});

it('keeps the confirmed value read-only and retries the GET after a save and read failure', async () => {
  api.PUT.mockResolvedValue({
    error: { code: 'UNEXPECTED', message_en: 'Synthetic save failure' },
    response: { status: 500 },
  });
  renderPage();
  const control = await screen.findByRole('switch', { name: label });
  api.GET.mockResolvedValue({ error: { code: 'UNEXPECTED' }, response: { status: 500 } });
  fireEvent.click(control);
  const retry = await screen.findByRole('button', { name: t('en', 'importedRefunds.retryRead') });
  expect(
    screen.getByRole('switch', { name: t('en', 'importedRefunds.lastConfirmed') }),
  ).toMatchObject({
    checked: false,
    disabled: true,
  });
  expect(screen.getByRole('alert').textContent).toBe(t('en', 'admin.unexpected'));
  api.GET.mockResolvedValue({
    data: { imported_refunds_enabled: true },
    response: { status: 200 },
  });
  fireEvent.click(retry);
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: label })).toMatchObject({
      checked: true,
      disabled: false,
    }),
  );
  expect(api.PUT).toHaveBeenCalledTimes(1);
});

it('prioritizes the current guarded GET refusal over a previous save failure', async () => {
  api.PUT.mockResolvedValue({
    error: { code: 'UNEXPECTED', message_en: 'Synthetic save failure' },
    response: { status: 500 },
  });
  renderPage();
  const control = await screen.findByRole('switch', { name: label });
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  fireEvent.click(control);
  expect((await screen.findByRole('alert')).textContent).toBe(refused);
  expect(screen.queryByRole('switch', { name: label })).toBeNull();
});

it('labels the prior value without claiming current policy after a successful PUT and failed GET', async () => {
  renderPage();
  const control = await screen.findByRole('switch', { name: label });
  api.PUT.mockResolvedValue({
    data: { imported_refunds_enabled: true },
    response: { status: 200 },
  });
  api.GET.mockResolvedValue({ error: { code: 'UNEXPECTED' }, response: { status: 500 } });
  fireEvent.click(control);
  await screen.findByRole('button', { name: t('en', 'importedRefunds.retryRead') });
  expect(
    screen.getByRole('switch', { name: t('en', 'importedRefunds.lastConfirmed') }),
  ).toMatchObject({ checked: false, disabled: true });
  expect(screen.queryByText(offNote)).toBeNull();
});
