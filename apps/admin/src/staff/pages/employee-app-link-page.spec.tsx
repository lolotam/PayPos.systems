import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { whatsAppShareHref } from '../model/employee-app-link';
import { EmployeeAppLinkPage } from './employee-app-link-page';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const company = '01920000-0000-7000-8000-0000000000c1';
const business = '01920000-0000-7000-8000-0000000000b1';
const otherBusiness = '01920000-0000-7000-8000-0000000000b2';
const user = '01920000-0000-7000-8000-0000000000a1';
const origin = 'https://pos.staging.pospay.systems';
const linkFor = (id: string) => `${origin}/personal?company=${company}&business=${id}`;

function answer(businessId: string) {
  return {
    company_id: company,
    business_id: businessId,
    business_name_en: businessId === business ? 'Synthetic business' : 'Other business',
    business_name_ar: null,
  };
}

function mockSuccess(businessId = business) {
  api.GET.mockResolvedValue({ data: answer(businessId), response: { status: 200 } });
}

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(businessId = business, client = queryClient()) {
  const view = render(
    <QueryClientProvider client={client}>
      <EmployeeAppLinkPage companyId={company} userId={user} businessId={businessId} />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

beforeEach(() => {
  api.GET.mockReset();
  vi.stubEnv('NEXT_PUBLIC_POS_URL', origin);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('EL-T01 shows the business name and exact staff link', async () => {
  mockSuccess();
  renderPage();
  expect(await screen.findByText('Synthetic business')).toBeTruthy();
  expect(screen.getByText(linkFor(business))).toBeTruthy();
});

it('EL-T02 renders the QR for the displayed link with its accessible label', async () => {
  mockSuccess();
  renderPage();
  expect(await screen.findByText(linkFor(business))).toBeTruthy();
  const qr = screen.getByRole('img', { name: t('en', 'employeeAppLink.qrLabel') });
  expect(qr.querySelector('svg')).not.toBeNull();
});

it('EL-T03 confirms a successful copy and sends the exact link to the clipboard', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  mockSuccess();
  renderPage();
  const link = await screen.findByText(linkFor(business));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeAppLink.copy') }));
  expect(await screen.findByText(t('en', 'employeeAppLink.copied'))).toBeTruthy();
  expect(writeText).toHaveBeenCalledWith(link.textContent);
});

it('EL-T03 keeps the selectable link visible when copying is rejected', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('refused'));
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  mockSuccess();
  renderPage();
  const link = await screen.findByText(linkFor(business));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeAppLink.copy') }));
  expect(await screen.findByText(t('en', 'employeeAppLink.copyFailed'))).toBeTruthy();
  expect(screen.getByText(linkFor(business))).toBe(link);
});

it('EL-T04 shows no-access and hides the link and actions on 403', async () => {
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  renderPage();
  expect((await screen.findByRole('alert')).textContent).toContain(t('en', 'errors.FORBIDDEN'));
  expect(screen.queryByText(linkFor(business))).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'employeeAppLink.copy') })).toBeNull();
});

it.each([
  { name: 'EL-T05 unset POS URL', origin: undefined },
  { name: 'EL-T08 unrecognised POS host', origin: 'https://pos.example.test' },
])('$name shows not-configured and no QR', async ({ origin: configuredOrigin }) => {
  vi.stubEnv('NEXT_PUBLIC_POS_URL', configuredOrigin);
  mockSuccess();
  renderPage();
  expect((await screen.findByRole('alert')).textContent).toContain(
    t('en', 'employeeAppLink.notConfigured'),
  );
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByText(linkFor(business))).toBeNull();
});

it('EL-T07 changes the link when another business is selected', async () => {
  api.GET.mockImplementation(
    async (_path: string, init: { params: { path: { businessId: string } } }) => ({
      data: answer(init.params.path.businessId),
      response: { status: 200 },
    }),
  );
  const client = queryClient();
  const view = renderPage(business, client);
  expect(await screen.findByText(linkFor(business))).toBeTruthy();
  view.rerender(
    <QueryClientProvider client={client}>
      <EmployeeAppLinkPage companyId={company} userId={user} businessId={otherBusiness} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText(linkFor(otherBusiness))).toBeTruthy();
  expect(screen.queryByText(linkFor(business))).toBeNull();
});

it('EL-T09 opens WhatsApp with the encoded line and makes no additional API request', async () => {
  mockSuccess();
  renderPage();
  const link = linkFor(business);
  expect(await screen.findByText(link)).toBeTruthy();
  const whatsapp = screen.getByRole('link', { name: t('en', 'employeeAppLink.whatsapp') });
  const line = t('en', 'employeeAppLink.whatsappLine').replace('{name}', 'Synthetic business');
  const href = whatsapp.getAttribute('href') ?? '';
  expect(href.startsWith('https://wa.me/?text=')).toBe(true);
  expect(href).toBe(whatsAppShareHref(line, link));
  fireEvent.click(whatsapp);
  await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(1));
});
