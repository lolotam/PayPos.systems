import type { CustomerPackageListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';
import { beforeEach, expect, it, vi } from 'vitest';
import { createSessionDraft, type SessionDraftForm, type SessionDraftLine } from '../model/session-drafts';
import type { PackageList } from '../model/session-package-options';
import { SessionPackageToggle } from './session-package-toggle';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en', get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
beforeEach(() => { state.locale = 'en'; state.get.mockReset(); });

const scope = { companyId: 'company', businessId: 'business', branchId: 'branch', userId: 'actor' };
const serviceId = 'service-a';
const customerId = 'customer-a';
let formRef: UseFormReturn<SessionDraftForm> | null = null;

function packageItem(id: string, expiresOn: string, patch: Partial<CustomerPackageListItem> = {}) {
  return {
    id,
    provenance: 'SOLD' as const,
    name_en: `Package ${id}`,
    name_ar: null,
    expires_on: expiresOn,
    expired: false,
    used_up: false,
    price_paid: '20.000',
    refunded_amount: '0.000',
    components: [{
      id: `component-${id}`, service_id: serviceId, position: 1,
      name_en: 'Synthetic service', name_ar: null, sessions_total: 2, remaining: 2,
      used: 0, refunded: 0, next_unit_value: '10.000',
      slot_values: [{ unit_value: '10.000', free: 2, used: 0, refunded: 0 }],
    }],
    ...patch,
  };
}

function packageList(items: CustomerPackageListItem[], patch: Partial<PackageList> = {}): PackageList {
  return { items, complete: true, truncated: false, error: false, loading: false, retry: vi.fn(), ...patch };
}

type HarnessProps = {
  packages: PackageList;
  customerId?: string | null;
  serviceId?: string;
  visitDate?: string;
  lines?: SessionDraftLine[];
  index?: number;
  onSubmit?: (data: SessionDraftForm) => void;
};

function Harness({
  packages, customerId: selectedCustomer = customerId, serviceId: selectedService = serviceId,
  visitDate = '2026-06-15', lines, index = 0, onSubmit,
}: HarnessProps) {
  const form = useForm<SessionDraftForm>({
    defaultValues: { lines: lines ?? [{ ...createSessionDraft('line'), service_id: selectedService }] },
  });
  useEffect(() => { formRef = form; }, [form]);
  return <FormProvider {...form}><form noValidate onSubmit={form.handleSubmit((data) => onSubmit?.(data))}>
    <SessionPackageToggle scope={scope} customerId={selectedCustomer} index={index}
      visitDate={visitDate} packages={packages} />
    <button type="submit">Submit fixture</button>
  </form></FormProvider>;
}

function renderToggle(props: HarnessProps) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (next: HarnessProps) => <QueryClientProvider client={client}><Harness {...next} /></QueryClientProvider>;
  return { ...render(ui(props)), ui };
}

function toggleButton() {
  return screen.getByRole('button', { name: t(state.locale, 'serviceSessions.fromPackage') });
}

function radio(name: string) {
  return screen.getByRole('radio', { name: new RegExp(name) }) as HTMLInputElement;
}

function labelOf(input: HTMLInputElement) {
  const label = input.closest('label');
  if (!label) throw new Error('Missing package label');
  return label;
}

it.each(['packageNoCustomer', 'packageNoService'] as const)('disables the toggle with the visible %s gate', (key) => {
  renderToggle({
    packages: packageList([]),
    customerId: key === 'packageNoCustomer' ? null : customerId,
    serviceId: key === 'packageNoService' ? '' : serviceId,
  });
  expect((toggleButton() as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(t('en', `serviceSessions.${key}`))).toBeTruthy();
});

it.each(['en', 'ar'] as const)('preselects the earliest expiry and shows its suggested badge in %s', async (locale) => {
  state.locale = locale;
  renderToggle({ packages: packageList([
    packageItem('later', '2027-01-01'),
    packageItem('first', '2026-12-01'),
  ]) });
  fireEvent.click(toggleButton());
  await waitFor(() => expect(radio('Package first').checked).toBe(true));
  expect(within(labelOf(radio('Package first'))).getByText(t(locale, 'serviceSessions.packageSuggested'))).toBeTruthy();
  expect(radio('Package later').checked).toBe(false);
});

it('keeps the user choice when the package list rerenders', async () => {
  const props = { packages: packageList([
    packageItem('first', '2026-12-01'), packageItem('later', '2027-01-01'),
  ]) };
  const view = renderToggle(props);
  fireEvent.click(toggleButton());
  await waitFor(() => expect(radio('Package first').checked).toBe(true));
  fireEvent.click(radio('Package later'));
  view.rerender(view.ui({ packages: packageList([
    packageItem('later', '2027-01-01'), packageItem('first', '2026-12-01'),
  ]) }));
  await waitFor(() => expect(radio('Package later').checked).toBe(true));
  expect(radio('Package first').checked).toBe(false);
});

it('disables an exhausted option and shows the exhausted validation for its chosen line', async () => {
  const first = { ...createSessionDraft('first'), service_id: serviceId, from_package: true, package_entitlement_id: 'a' };
  const second = { ...createSessionDraft('second'), service_id: serviceId, from_package: true, package_entitlement_id: 'a' };
  const submit = vi.fn();
  const item = packageItem('a', '2026-12-01');
  const view = renderToggle({ packages: packageList([item]), lines: [first, second], index: 1, onSubmit: submit });
  expect(radio('Package a').disabled).toBe(false);
  const component = item.components[0];
  if (!component) throw new Error('Missing package component');
  component.remaining = 1;
  view.rerender(view.ui({ packages: packageList([item]), lines: [first, second], index: 1, onSubmit: submit }));
  await waitFor(() => expect(radio('Package a').disabled).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: 'Submit fixture' }));
  expect((await screen.findByText(t('en', 'serviceSessions.packageExhausted'))).getAttribute('role')).toBe('alert');
  expect(submit).not.toHaveBeenCalled();
});

it('shows and suggests an expired-today package for a back-dated visit', async () => {
  const expired = packageItem('old', '2026-10-01', { expired: true });
  renderToggle({ packages: packageList([expired]), visitDate: '2026-09-30' });
  fireEvent.click(toggleButton());

  await waitFor(() => expect(radio('Package old').checked).toBe(true));
  expect(within(labelOf(radio('Package old'))).getByText(t('en', 'serviceSessions.packageSuggested'))).toBeTruthy();
  expect(screen.getByText(t('en', 'serviceSessions.packageExpired'))).toBeTruthy();
});

it('hides the only package and shows the none-usable message after its expiry', async () => {
  const expired = packageItem('old', '2026-10-01', { expired: true });
  renderToggle({ packages: packageList([expired]), visitDate: '2026-10-02' });
  fireEvent.click(toggleButton());

  expect(await screen.findByText(t('en', 'serviceSessions.packageNoneUsable'))).toBeTruthy();
  expect(screen.queryByRole('radio', { name: /Package old/ })).toBeNull();
});

it('shows a package when the visit is on its expiry day', async () => {
  const expired = packageItem('old', '2026-10-01', { expired: true });
  renderToggle({ packages: packageList([expired]), visitDate: '2026-10-01' });
  fireEvent.click(toggleButton());

  expect(await screen.findByRole('radio', { name: /Package old/ })).toBeTruthy();
});

it('renders loading, retryable failure and no-usable-package states', async () => {
  const view = renderToggle({ packages: packageList([], { complete: false, loading: true }) });
  fireEvent.click(toggleButton());
  expect(screen.getByRole('status').textContent).toBe(t('en', 'serviceSessions.packageLoading'));
  const retry = vi.fn();
  view.rerender(view.ui({ packages: packageList([], { complete: false, error: true, retry }) }));
  expect(screen.getByRole('alert').textContent).toBe(t('en', 'serviceSessions.packageLoadFailed'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.packageRetry') }));
  expect(retry).toHaveBeenCalledTimes(1);
  view.rerender(view.ui({ packages: packageList([]) }));
  expect(screen.getByRole('status').textContent).toBe(t('en', 'serviceSessions.packageNoneUsable'));
});

it('requires a pick before submitting a package line', async () => {
  const submit = vi.fn();
  renderToggle({ packages: packageList([]), onSubmit: submit });
  fireEvent.click(toggleButton());
  fireEvent.click(screen.getByRole('button', { name: 'Submit fixture' }));
  expect((await screen.findByText(t('en', 'serviceSessions.packageRequired'))).getAttribute('role')).toBe('alert');
  expect(submit).not.toHaveBeenCalled();
});

it('turning off clears the pick and hides the picker', async () => {
  renderToggle({ packages: packageList([packageItem('first', '2026-12-01')]) });
  fireEvent.click(toggleButton());
  await waitFor(() => expect(radio('Package first').checked).toBe(true));
  fireEvent.click(toggleButton());
  expect(toggleButton().getAttribute('aria-pressed')).toBe('false');
  expect(screen.queryByRole('radio')).toBeNull();
  expect(formRef?.getValues('lines.0.package_entitlement_id')).toBeNull();
});

it('shows a truncation note without suggesting a package and allows a manual pick', () => {
  renderToggle({ packages: packageList([
    packageItem('first', '2026-12-01'), packageItem('later', '2027-01-01'),
  ], { complete: false, truncated: true }) });
  fireEvent.click(toggleButton());

  expect(radio('Package first').checked).toBe(false);
  expect(radio('Package later').checked).toBe(false);
  expect(screen.queryByText(t('en', 'serviceSessions.packageSuggested'))).toBeNull();
  expect(screen.getByText(t('en', 'serviceSessions.packageListTruncated'))).toBeTruthy();
  fireEvent.click(radio('Package first'));
  expect(radio('Package first').checked).toBe(true);
});

it('shows only the truncation note when a partial list has no usable options', () => {
  renderToggle({ packages: packageList([], { complete: false, truncated: true }) });
  fireEvent.click(toggleButton());

  expect(screen.getByText(t('en', 'serviceSessions.packageListTruncated'))).toBeTruthy();
  expect(screen.queryByText(t('en', 'serviceSessions.packageNoneUsable'))).toBeNull();
});

it('keeps the no-usable-package message for a complete empty list', () => {
  renderToggle({ packages: packageList([], { complete: true, truncated: false }) });
  fireEvent.click(toggleButton());

  expect(screen.getByText(t('en', 'serviceSessions.packageNoneUsable'))).toBeTruthy();
  expect(screen.queryByText(t('en', 'serviceSessions.packageListTruncated'))).toBeNull();
});
