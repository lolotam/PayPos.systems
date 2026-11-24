import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EmployeeAppLinkPage } from './employee-app-link-page';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <svg data-testid="qr" data-value={value} />,
}));

const company = '01920000-0000-7000-8000-0000000000c1';
const business = '01920000-0000-7000-8000-0000000000b1';
const user = '01920000-0000-7000-8000-0000000000a1';
const origin = 'https://pos.staging.pospay.systems';
const link = `${origin}/personal?company=${company}&business=${business}`;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EmployeeAppLinkPage companyId={company} userId={user} businessId={business} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.GET.mockReset();
  vi.stubEnv('NEXT_PUBLIC_POS_URL', origin);
  api.GET.mockResolvedValue({
    data: {
      company_id: company,
      business_id: business,
      business_name_en: 'Synthetic business',
      business_name_ar: null,
    },
    response: { status: 200 },
  });
});

it('puts the link, the code and the actions in one card under the header of the form shell', async () => {
  renderPage();
  await screen.findByText(link);
  const heading = screen.getByRole('heading', { name: t('en', 'employeeAppLink.title') });
  const shell = heading.closest('[data-page-shell="form"]');
  expect(shell).not.toBeNull();
  const card = screen.getByRole('img', { name: t('en', 'employeeAppLink.qrLabel') }).closest(
    '.rounded-card',
  );
  expect(card).not.toBeNull();
  expect(shell?.contains(card)).toBe(true);
  expect(within(card as HTMLElement).getByText(link)).toBeTruthy();
  expect(within(card as HTMLElement).getByText('Synthetic business')).toBeTruthy();
  expect(
    within(card as HTMLElement).getByRole('button', { name: t('en', 'employeeAppLink.copy') }),
  ).toBeTruthy();
  expect(screen.getAllByRole('heading', { name: t('en', 'employeeAppLink.title') })).toHaveLength(1);
});

it('keeps the header with the refusal message', async () => {
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  renderPage();
  expect((await screen.findByRole('alert')).textContent).toContain(t('en', 'errors.FORBIDDEN'));
  const heading = screen.getByRole('heading', { name: t('en', 'employeeAppLink.title') });
  expect(heading.closest('[data-page-shell="form"]')).not.toBeNull();
});
