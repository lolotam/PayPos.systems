import { t } from '@pospay/i18n';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionAttemptJournal } from '../model/session-attempt-journal';
import { id, instant, scope } from '../model/session-recording-result.fixture';
import { RecordServiceSessionPage } from './record-service-session-page';

const state = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, POST: state.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

const context = {
  generated_at: instant,
  business_timezone: 'Asia/Kuwait',
  recorder_membership_ids: [id(8)],
  recorder_membership_id: id(8),
  discount_limit: { source: 'PERSON' as const, bps: 1000 },
};
const service = {
  id: id(5),
  name_ar: null,
  name_en: 'Synthetic service',
  price: '7.125',
  revision: 1,
};
const down = {
  error: { code: 'INTERNAL_ERROR', message_ar: 'Down AR', message_en: 'Services unavailable' },
  response: { status: 500 },
};
const refused = {
  error: { code: 'FORBIDDEN', message_ar: 'Refusal AR', message_en: 'Recording not allowed' },
  response: { status: 403 },
};

// recording-context بيرجع 200 للاتنين (PP-19.1)؛ قايمة الخدمات هي اللي بتفرّق بين اللي بيسجّل واللي بيغيّر المنفّذين بس.
function reads(servicesAllowed: boolean | 'down') {
  state.get.mockImplementation((path: string) => {
    const name = String(path);
    if (name.endsWith('/recording-context'))
      return Promise.resolve({ data: context, response: { status: 200 } });
    if (name.endsWith('/service-options'))
      return Promise.resolve(
        servicesAllowed === 'down'
          ? down
          : servicesAllowed
            ? { data: { items: [service], next_cursor: null }, response: { status: 200 } }
            : refused,
      );
    return Promise.resolve({ data: { items: [], next_cursor: null }, response: { status: 200 } });
  });
}
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const ui = () => (
    <QueryClientProvider client={client}>
      <RecordServiceSessionPage scope={scope} />
    </QueryClientProvider>
  );
  return { ...render(ui()), ui };
}
const save = () => screen.queryByRole('button', { name: t('en', 'serviceSessions.save') });

beforeEach(() => {
  state.locale = 'en';
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  state.get.mockReset();
  state.post.mockReset();
});
afterEach(() => {
  const cleaner = createSessionAttemptJournal(scope, {
    now: () => Date.now(),
    newId: () => id(90),
  });
  cleaner.changeScope(null);
  cleaner.dispose();
  sessionStorage.clear();
  Reflect.deleteProperty(navigator, 'onLine');
  onlineManager.setOnline(true);
});

it('locks the page for a manager who can only change performers, even though the context read succeeds', async () => {
  reads(false);
  renderPage();
  expect((await screen.findByRole('alert')).textContent).toBe('Recording not allowed');
  expect(screen.getByRole('heading', { name: t('en', 'serviceSessions.title') })).toBeTruthy();
  await waitFor(() =>
    expect(
      state.get.mock.calls.some((call) => String(call[0]).endsWith('/recording-context')),
    ).toBe(true),
  );
  expect(save()).toBeNull();
  expect(screen.queryByLabelText(t('en', 'serviceSessions.name'))).toBeNull();
});

it('shows the recording form to a cashier who can record', async () => {
  reads(true);
  renderPage();
  expect(await screen.findByRole('button', { name: t('en', 'serviceSessions.save') })).toBeTruthy();
  expect(screen.getByLabelText(t('en', 'serviceSessions.name'))).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps an unsaved draft when only the language changes', async () => {
  reads(true);
  let answerArabic: (value: unknown) => void = () => undefined;
  const english = state.get.getMockImplementation();
  state.get.mockImplementation((path: string, init?: { params?: { query?: { lang?: string } } }) =>
    String(path).endsWith('/service-options') && init?.params?.query?.lang === 'ar'
      ? new Promise((resolve) => (answerArabic = resolve))
      : english?.(path, init),
  );
  const view = renderPage();
  const name = (await screen.findByLabelText(t('en', 'serviceSessions.name'))) as HTMLInputElement;
  fireEvent.change(name, { target: { value: 'Draft customer' } });
  state.locale = 'ar';
  view.rerender(view.ui());
  await waitFor(() =>
    expect(
      state.get.mock.calls.some(
        ([path, init]) =>
          String(path).endsWith('/service-options') && init?.params?.query?.lang === 'ar',
      ),
    ).toBe(true),
  );
  expect((screen.getByLabelText(t('ar', 'serviceSessions.name')) as HTMLInputElement).value).toBe(
    'Draft customer',
  );
  await act(async () =>
    answerArabic({ data: { items: [service], next_cursor: null }, response: { status: 200 } }),
  );
  expect((screen.getByLabelText(t('ar', 'serviceSessions.name')) as HTMLInputElement).value).toBe(
    'Draft customer',
  );
});

it('does not open the form when the first service read fails with 500, and offers a retry', async () => {
  reads('down');
  renderPage();
  const retry = await screen.findByRole('button', {
    name: t('en', 'serviceSessions.retryServices'),
  });
  expect(screen.getByRole('alert').textContent).toContain('Services unavailable');
  await waitFor(() =>
    expect(
      state.get.mock.calls.some((call) => String(call[0]).endsWith('/recording-context')),
    ).toBe(true),
  );
  expect(save()).toBeNull();
  reads(true);
  fireEvent.click(retry);
  expect(await screen.findByRole('button', { name: t('en', 'serviceSessions.save') })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
