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
  const shell = save.closest('[data-page-shell="two-column"]') as HTMLElement;
  expect(shell.className).toContain('max-w-[1200px]');
  const heading = screen.getByRole('heading', { level: 1, name: t('en', 'serviceSessions.title') });
  expect(shell.contains(heading)).toBe(true);
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

it('keeps the summary sticky from 1024px and carries the resolved discount limit', async () => {
  installReads();
  renderPage();
  const total = await screen.findByText(t('en', 'serviceSessions.draftTotal'), { exact: false });
  const sticky = total.closest('[class~="lg:sticky"]') as HTMLElement;
  expect(sticky.className).toContain('lg:top-4');
  await waitFor(() => expect(sticky.textContent).toContain('10.00%'));
  expect(sticky.textContent).toContain(t('en', 'serviceSessions.limitPerson'));
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
