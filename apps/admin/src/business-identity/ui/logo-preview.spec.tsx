import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LogoPreview } from './logo-preview';

const api = vi.hoisted(() => ({ POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const id = '01920000-0000-7000-8000-0000000000a2';
const fileId = '01920000-0000-7000-8000-0000000000f1';
const retry = t('en', 'pos.retry');

function renderPreview() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <LogoPreview companyId={id} userId={id} fileId={fileId} alt="Shop" />
    </QueryClientProvider>,
  );
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

it('keeps a forbidden logo preview as a refusal without retry', async () => {
  api.POST.mockResolvedValue({
    error: { code: 'FORBIDDEN', message_ar: 'Refused', message_en: 'Forbidden' },
    response: { status: 403 },
  });
  renderPreview();
  expect((await screen.findByRole('alert')).textContent).toContain('Forbidden');
  expect(screen.queryByRole('button', { name: retry })).toBeNull();
});
