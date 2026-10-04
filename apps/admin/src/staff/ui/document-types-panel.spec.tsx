import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DocumentTypesPanel } from './document-types-panel';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'ar' }));
const id = '01920000-0000-7000-8000-0000000000a2';
const civil = {
  id,
  code: 'civil_id',
  name_en: 'Civil ID',
  name_ar: 'Synthetic civil ID (ar)',
  alert_days: 30,
  requires_expiry: true,
  active: true,
  revision: 2,
};
beforeEach(() => {
  api.GET.mockReset().mockResolvedValue({ data: { items: [civil] } });
  api.POST.mockReset().mockResolvedValue({ data: { ...civil, active: false, revision: 3 } });
  api.PATCH.mockReset().mockResolvedValue({ data: { ...civil, alert_days: 45, revision: 3 } });
});
const setup = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DocumentTypesPanel companyId={id} userId={id} />
    </QueryClientProvider>,
  );

it('shows Arabic names and creates a type with trimmed names and numeric alert days', async () => {
  setup();
  await waitFor(() => expect(screen.getByText('Synthetic civil ID (ar)')).toBeTruthy());
  fireEvent.change(screen.getByLabelText(t('ar', 'employeeDocuments.nameEn')), {
    target: { value: ' Visa ' },
  });
  fireEvent.change(screen.getByLabelText(t('ar', 'employeeDocuments.alertDays')), {
    target: { value: '15' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'employeeDocuments.add') }));
  await waitFor(() => expect(api.POST).toHaveBeenCalled());
  const [path, options] = api.POST.mock.calls[0] ?? [];
  expect(path).toBe('/v1/document-types');
  expect(options.body).toEqual({
    name_en: 'Visa',
    name_ar: null,
    alert_days: 15,
    requires_expiry: true,
  });
  expect(options.params.header['Idempotency-Key']).toEqual(expect.any(String));
});

it('edits at the shown revision and deactivates without deleting', async () => {
  setup();
  fireEvent.click(await screen.findByRole('button', { name: t('ar', 'employeeDocuments.edit') }));
  const alert = screen.getByDisplayValue('30');
  fireEvent.change(alert, { target: { value: '45' } });
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'employeeDocuments.save') }));
  await waitFor(() => expect(api.PATCH).toHaveBeenCalled());
  expect(api.PATCH.mock.calls[0]?.[1].body).toMatchObject({ alert_days: 45, expected_revision: 2 });
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'employeeDocuments.deactivate') }));
  await waitFor(() =>
    expect(api.POST).toHaveBeenCalledWith(
      '/v1/document-types/{typeId}/deactivate',
      expect.objectContaining({ body: { expected_revision: 2 } }),
    ),
  );
});
