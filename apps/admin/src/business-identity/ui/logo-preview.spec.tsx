import { t } from '@pospay/i18n';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LogoPreview } from './logo-preview';

const api = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const id = '01920000-0000-7000-8000-0000000000a2';
const fileId = '01920000-0000-7000-8000-0000000000f1';
const retry = t('en', 'pos.retry');

function queryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function preview(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <LogoPreview companyId={id} userId={id} fileId={fileId} alt="Shop" />
    </QueryClientProvider>
  );
}

function renderPreview() {
  const client = queryClient();
  render(preview(client));
  return client;
}

beforeEach(() => {
  api.POST.mockReset();
});

it('retries a failed logo preview and then shows it', async () => {
  let attempts = 0;
  api.POST.mockImplementation(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('offline');
    return { data: { download_url: 'https://files.test/logo', expires_in: 60 } };
  });
  const client = renderPreview();
  fireEvent.click(await screen.findByRole('button', { name: retry }));
  const image = await screen.findByRole('img', { name: 'Shop' });
  expect(image.getAttribute('src')).toBe('https://files.test/logo');
  expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain('https://files.test/logo');
});

it('shows the remounted preview after the first download is cancelled', async () => {
  const pending: Array<(value: unknown) => void> = [];
  api.POST.mockImplementation(
    () =>
      new Promise((resolve) => {
        pending.push(resolve);
      }),
  );
  const client = queryClient();
  const first = render(preview(client));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('status').textContent).toBe(t('en', 'admin.loading'));
  const firstSignal = api.POST.mock.calls[0]?.[1].signal as AbortSignal;
  first.unmount();
  expect(firstSignal.aborted).toBe(true);
  render(preview(client));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  pending[0]?.({ data: { download_url: 'https://files.test/stale', expires_in: 60 } });
  pending[1]?.({ data: { download_url: 'https://files.test/fresh', expires_in: 60 } });
  const image = await screen.findByRole('img', { name: 'Shop' });
  expect(image.getAttribute('src')).toBe('https://files.test/fresh');
});

it('does not download the logo again when the window regains focus', async () => {
  focusManager.setFocused(true);
  api.POST.mockResolvedValue({
    data: { download_url: 'https://files.test/logo', expires_in: 60 },
  });
  renderPreview();
  await screen.findByRole('img', { name: 'Shop' });
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  expect(api.POST).toHaveBeenCalledTimes(1);
  focusManager.setFocused(undefined);
});

it('retries a broken image with a fresh download', async () => {
  let attempts = 0;
  api.POST.mockImplementation(async () => {
    attempts += 1;
    return { data: { download_url: `https://files.test/logo-${attempts}`, expires_in: 60 } };
  });
  renderPreview();
  fireEvent.error(await screen.findByRole('img', { name: 'Shop' }));
  expect(screen.getByRole('alert').textContent).toContain(t('en', 'admin.unexpected'));
  fireEvent.click(screen.getByRole('button', { name: retry }));
  const image = await screen.findByRole('img', { name: 'Shop' });
  expect(image.getAttribute('src')).toBe('https://files.test/logo-2');
  expect(api.POST).toHaveBeenCalledTimes(2);
});

it('keeps a forbidden logo preview as a refusal without retry', async () => {
  api.POST.mockResolvedValue({
    error: { code: 'FORBIDDEN', message_ar: 'Refused', message_en: 'Forbidden' },
    response: { status: 403 },
  });
  renderPreview();
  expect((await screen.findByRole('alert')).textContent).toContain('Forbidden');
  expect(screen.queryByRole('button', { name: retry })).toBeNull();
});
