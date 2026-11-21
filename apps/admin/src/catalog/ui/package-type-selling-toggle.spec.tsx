import type { PackageTypeListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { PackageTypesPage } from '../pages/package-types-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  api.PATCH.mockReset();
});

const id = '01920000-0000-7000-8000-0000000000a2';
const stoppedAt = '2026-11-14T08:00:00.000Z';
const listItem = (stopped = false, revision = 1): PackageTypeListItem => ({
  id,
  name_en: 'Synthetic package',
  name_ar: null,
  price: '12.500',
  validity_days: 90,
  component_count: 1,
  revision,
  selling_stopped_at: stopped ? stoppedAt : null,
});
const detail = (item: PackageTypeListItem) => ({
  ...item,
  business_id: id,
  components: [{ service_id: id, sessions: 10, name_en: 'Service', name_ar: null, price: '1.000' }],
  created_at: '2026-10-05T10:00:00.000Z',
  updated_at: '2026-10-05T10:00:00.000Z',
});
const page = (item: PackageTypeListItem, canManage = true) => ({
  items: [item],
  next_cursor: null,
  can_manage: canManage,
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LocaleProvider locale="en" setLocale={() => undefined}>
      <QueryClientProvider client={client}>
        <PackageTypesPage
          companyId={id}
          userId={id}
          business={{ id, name_en: 'Business', name_ar: null, business_type: 'salon', country: null, branches: [] }}
        />
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

it.each([
  { stopped: false, action: 'stopSelling', otherAction: 'resumeSelling' },
  { stopped: true, action: 'resumeSelling', otherAction: 'stopSelling' },
] as const)('shows $action and the correct badge for a manageable row', async (test) => {
  api.GET.mockResolvedValueOnce({ data: page(listItem(test.stopped)) });
  renderPage();
  const button = await screen.findByRole('button', {
    name: t('en', `catalogPackageTypes.${test.action}`),
  });
  expect(button).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: t('en', `catalogPackageTypes.${test.otherAction}`) }),
  ).toBeNull();
  if (test.stopped) {
    expect(screen.getByText(t('en', 'catalogPackageTypes.notOnSale'))).toBeTruthy();
  } else {
    expect(screen.queryByText(t('en', 'catalogPackageTypes.notOnSale'))).toBeNull();
  }
});

it('keeps the stopped badge but hides both actions without canManage', async () => {
  api.GET.mockResolvedValueOnce({ data: page(listItem(true), false) });
  renderPage();
  expect(await screen.findByText(t('en', 'catalogPackageTypes.notOnSale'))).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: t('en', 'catalogPackageTypes.stopSelling') }),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: t('en', 'catalogPackageTypes.resumeSelling') }),
  ).toBeNull();
});

it('disables the stop button while the request is pending', async () => {
  let finish!: (value: { data: ReturnType<typeof detail> }) => void;
  api.GET.mockResolvedValueOnce({ data: page(listItem()) });
  api.POST.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  api.GET.mockResolvedValueOnce({ data: page(listItem(true, 2)) });
  renderPage();
  const button = await screen.findByRole('button', {
    name: t('en', 'catalogPackageTypes.stopSelling'),
  });
  fireEvent.click(button);
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
  finish({ data: detail(listItem(true, 2)) });
  expect(
    await screen.findByRole('button', { name: t('en', 'catalogPackageTypes.resumeSelling') }),
  ).toBeTruthy();
});

it.each(['PACKAGE_TYPE_SELLING_UNCHANGED', 'PACKAGE_TYPE_REVISION_CONFLICT'] as const)(
  'shows the i18n refusal for %s in an alert',
  async (code) => {
    api.GET.mockResolvedValueOnce({ data: page(listItem()) });
    api.POST.mockResolvedValueOnce({
      error: {
        code,
        message_ar: t('ar', `errors.${code}`),
        message_en: t('en', `errors.${code}`),
      },
    });
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: t('en', 'catalogPackageTypes.stopSelling') }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(t('en', `errors.${code}`));
  },
);

it('shows the stopped badge and resume action after a successful stop', async () => {
  api.GET.mockResolvedValueOnce({ data: page(listItem()) });
  api.POST.mockResolvedValueOnce({ data: detail(listItem(true, 2)) });
  api.GET.mockResolvedValueOnce({ data: page(listItem(true, 2)) });
  renderPage();
  fireEvent.click(
    await screen.findByRole('button', { name: t('en', 'catalogPackageTypes.stopSelling') }),
  );
  expect(
    await screen.findByRole('button', { name: t('en', 'catalogPackageTypes.resumeSelling') }),
  ).toBeTruthy();
  expect(screen.getByText(t('en', 'catalogPackageTypes.notOnSale'))).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: t('en', 'catalogPackageTypes.stopSelling') }),
  ).toBeNull();
});

it('preserves an unsaved visible draft while selling is unavailable for the open editor', async () => {
  api.GET.mockImplementation(async (path: string) => ({
    data: path.endsWith('/{packageTypeId}')
      ? detail(listItem())
      : path.endsWith('/service-options')
        ? { items: [], next_cursor: null }
        : page(listItem()),
  }));
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'catalogPackageTypes.edit') }));
  const name = await screen.findByLabelText(t('en', 'catalogPackageTypes.nameEn'));
  fireEvent.change(name, { target: { value: 'Unsaved synthetic draft' } });
  expect(
    screen.queryByRole('button', { name: t('en', 'catalogPackageTypes.stopSelling') }),
  ).toBeNull();
  expect((name as HTMLInputElement).value).toBe('Unsaved synthetic draft');
  expect(api.POST).not.toHaveBeenCalled();
});

it('blocks editing through selling and list refresh, then saves with the refreshed revision', async () => {
  let finish!: (value: { data: ReturnType<typeof detail> }) => void;
  let refresh!: (value: { data: ReturnType<typeof page> }) => void;
  let stopped = false;
  api.GET.mockImplementation(async (path: string) => {
    if (path.endsWith('/{packageTypeId}'))
      return { data: detail(listItem(stopped, stopped ? 2 : 1)) };
    if (path.endsWith('/service-options')) return { data: { items: [], next_cursor: null } };
    if (stopped && api.PATCH.mock.calls.length === 0)
      return new Promise((resolve) => {
        refresh = resolve;
      });
    return { data: page(listItem(stopped, stopped ? 2 : 1)) };
  });
  api.POST.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  api.PATCH.mockResolvedValue({
    data: detail({ ...listItem(true, 3), name_en: 'Updated package' }),
  });
  renderPage();
  const edit = await screen.findByRole('button', { name: t('en', 'catalogPackageTypes.edit') });
  fireEvent.click(edit);
  await screen.findByLabelText(t('en', 'catalogPackageTypes.nameEn'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogPackageTypes.cancel') }));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogPackageTypes.stopSelling') }));
  await waitFor(() => expect((edit as HTMLButtonElement).disabled).toBe(true));
  stopped = true;
  finish({ data: detail(listItem(true, 2)) });
  await waitFor(() => expect(refresh).toBeTypeOf('function'));
  expect((edit as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByLabelText(t('en', 'catalogPackageTypes.nameEn'))).toBeNull();
  refresh({ data: page(listItem(true, 2)) });
  await waitFor(() => expect((edit as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(edit);
  const name = await screen.findByLabelText(t('en', 'catalogPackageTypes.nameEn'));
  expect((name as HTMLInputElement).value).toBe('Synthetic package');
  fireEvent.change(name, { target: { value: 'Updated package' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogPackageTypes.save') }));
  await screen.findByText(t('en', 'catalogPackageTypes.saved'));
  expect(api.PATCH.mock.calls[0]?.[1].body.expected_revision).toBe(2);
  expect(
    (screen.getByLabelText(t('en', 'catalogPackageTypes.nameEn')) as HTMLInputElement).value,
  ).toBe('Updated package');
});
