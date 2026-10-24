import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EmployeeAppLinkButton } from './employee-app-link-button';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const id = '01920000-0000-7000-8000-0000000000a2';
const label = t('en', 'employeeAppLink.open');

function renderButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EmployeeAppLinkButton companyId={id} userId={id} businessId={id} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.GET.mockReset();
});

it('shows the staff app link when the guarded read succeeds', async () => {
  api.GET.mockResolvedValue({
    data: {
      company_id: id,
      business_id: id,
      business_name_en: 'Synthetic business',
      business_name_ar: null,
    },
    response: { status: 200 },
  });
  renderButton();
  const link = await screen.findByRole('link', { name: label });
  expect(link.getAttribute('href')).toBe('/staff/employee-app-link');
});

it.each([403, 500])('hides the staff app link when the read fails with %s', async (status) => {
  api.GET.mockResolvedValue({ error: { code: 'REFUSED' }, response: { status } });
  renderButton();
  await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('link', { name: label })).toBeNull();
});
