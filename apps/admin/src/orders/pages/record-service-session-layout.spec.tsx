import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { id, instant, scope } from '../model/session-recording-result.fixture';
import { RecordServiceSessionPage } from './record-service-session-page';

const state = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, POST: state.post }) }));
vi.mock('../api/use-session-customer-profile', () => ({
  useSessionCustomerProfile: () => ({ data: undefined, isError: false, isPending: true, refetch: vi.fn() }),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

const context = {
  generated_at: instant, business_timezone: 'Asia/Kuwait', recorder_membership_ids: [id(8)],
  recorder_membership_id: id(8), discount_limit: { source: 'PERSON' as const, bps: 1000 },
};

function installReads(refuse = false) {
  state.get.mockImplementation((path: string) => Promise.resolve(refuse
    ? { error: { code: 'FORBIDDEN', message_ar: 'Denied AR', message_en: 'Denied EN' }, response: { status: 403 } }
    : { data: String(path).endsWith('/recording-context') ? context : { items: [], next_cursor: null } }));
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><RecordServiceSessionPage scope={scope} /></QueryClientProvider>);
}

beforeEach(() => {
  state.get.mockReset();
  state.post.mockReset();
});

it('lays the page on the two-column shell with the header above both columns', async () => {
  installReads();
  renderPage();
  const save = await screen.findByRole('button', { name: t('en', 'serviceSessions.save') });
  const heading = screen.getByRole('heading', { level: 1, name: t('en', 'serviceSessions.title') });
  expect(save.closest('[data-page-shell="two-column"]')?.contains(heading)).toBe(true);
  expect(heading.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('puts the form before the draft summary, and the summary in the side column', async () => {
  installReads();
  renderPage();
  const save = await screen.findByRole('button', { name: t('en', 'serviceSessions.save') });
  const form = save.closest('form') as HTMLElement;
  const total = await screen.findByText(t('en', 'serviceSessions.draftTotal'), { exact: false });
  const summary = total.closest('.rounded-card') as HTMLElement;
  expect(form.contains(summary)).toBe(false);
  expect(form.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const columns = form.closest('[data-page-shell]')?.querySelector('[class~="lg:grid"]') as HTMLElement;
  expect(columns.children).toHaveLength(2);
  expect(columns.children[0]?.contains(form)).toBe(true);
  expect(columns.children[1]?.contains(summary)).toBe(true);
});

it('carries the resolved discount limit into the side column summary', async () => {
  installReads();
  renderPage();
  const total = await screen.findByText(t('en', 'serviceSessions.draftTotal'), { exact: false });
  const summary = total.closest('.rounded-card') as HTMLElement;
  await waitFor(() => expect(summary.textContent).toContain('10.00%'));
  expect(summary.textContent).toContain(t('en', 'serviceSessions.limitPerson'));
});

// الالتصاق سلوك CSS لا يقيسه jsdom؛ نتحقق من البنية التي تجعله ممكنًا: الملخص اللاصق ابن مباشر لخانة الجانبي
// (ثاني ابن للشبكة)، وإطار القالب يمدّد خانات الشبكة فيمتد غلاف الجانبي لارتفاع الصف بدل ارتفاع محتواه.
it('puts the sticky summary directly in the side grid item, and stretches that item to the row', async () => {
  installReads();
  renderPage();
  const total = await screen.findByText(t('en', 'serviceSessions.draftTotal'), { exact: false });
  const summary = total.closest('.rounded-card') as HTMLElement;
  const shell = summary.closest('[data-page-shell="two-column"]') as HTMLElement;
  const grid = shell.lastElementChild as HTMLElement;
  const sideItem = grid.children[1] as HTMLElement;
  const sticky = sideItem.firstElementChild as HTMLElement;
  expect(sticky.contains(summary)).toBe(true);
  expect(sticky.className).toContain('lg:sticky');
  expect(sticky.className).toContain('lg:top-4');
  // الحرف كما نتوقعه نحن، لا الثابت المستورد من الكود الإنتاجي، فيُكشف أي خطأ في المحدِّد.
  expect(shell.className.split(' ')).toContain('lg:[&>div:last-child]:items-stretch');
  expect(grid).toBe(shell.children[shell.children.length - 1]);
  expect(grid.children[0]?.contains(screen.getByRole('button', { name: t('en', 'serviceSessions.save') }))).toBe(true);
});

it('falls back to the single-column form shell with the refusal when the read is denied', async () => {
  installReads(true);
  renderPage();
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Denied EN');
  const shell = alert.closest('[data-page-shell]') as HTMLElement;
  expect(shell.getAttribute('data-page-shell')).toBe('form');
  expect(screen.queryByRole('button', { name: t('en', 'serviceSessions.save') })).toBeNull();
});
