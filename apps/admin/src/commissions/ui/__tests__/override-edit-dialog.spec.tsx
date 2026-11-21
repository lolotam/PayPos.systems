import type { CommissionOverrideServiceItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/shared/api/query-client';
import { planScope } from '../../api/plan-access';
import type { OverrideAttemptMemory } from '../../api/use-save-commission-override';
import { deferredAnswer, ok, routeGet } from '../../api/__tests__/plan-http';
import { overrideItem, overridePage, SERVICE_A } from '../../api/__tests__/override-http';
import { OverrideEditDialog } from '../override-edit-dialog';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const scope = planScope('company', 'business', 'user-a');
const L = {
  kind: t('en', 'commissionOverrides.ruleKind'),
  bps: t('en', 'commissionOverrides.bpsLabel'),
  amount: t('en', 'commissionOverrides.amountLabel'),
  date: t('en', 'commissionOverrides.effectiveFrom'),
  save: t('en', 'commissionOverrides.save'),
  saving: t('en', 'commissionOverrides.saving'),
  cancel: t('en', 'commissionOverrides.cancel'),
  saved: t('en', 'commissionOverrides.saved'),
  bpsError: t('en', 'commissionOverrides.errorInvalidBps'),
  moneyError: t('en', 'commissionOverrides.errorInvalidMoney'),
  pastDate: t('en', 'errors.COMMISSION_EFFECTIVE_FROM_PAST'),
  closedPeriod: t('en', 'errors.COMMISSION_PERIOD_CLOSED'),
  current: t('en', 'commissionOverrides.currentBadge'),
  empty: t('en', 'commissionOverrides.historyEmpty'),
  loadMore: t('en', 'commissionOverrides.loadMore'),
  couldNot: t('en', 'commissionOverrides.couldNotLoadMore'),
};

let client: QueryClient;
let memory: OverrideAttemptMemory;

function service(overrides: Partial<CommissionOverrideServiceItem> = {}): CommissionOverrideServiceItem {
  const base: CommissionOverrideServiceItem = {
    service_id: SERVICE_A,
    name_en: 'Dyeing',
    name_ar: 'Dyeing',
    closed_at: null,
    service_rule: { kind: 'PCT', value: 1000 },
    price: '25.000',
    current_override: null,
  };
  return { ...base, ...overrides };
}

function mountDialog(item: CommissionOverrideServiceItem = service()) {
  const onClose = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <OverrideEditDialog
        scope={scope}
        employeeId="01920000-0000-7c11-8a11-0000000000a1"
        timeZone="Asia/Kuwait"
        service={item}
        memory={memory}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { ...view, onClose };
}

const kindSelect = () => screen.getByLabelText(L.kind) as HTMLSelectElement;
const bpsInput = () => screen.getByLabelText(L.bps) as HTMLInputElement;
const amountInput = () => screen.getByLabelText(L.amount) as HTMLInputElement;
const dateInput = () => screen.getByLabelText(L.date) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: L.save }) as HTMLButtonElement;

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-20T21:00:00Z'));
  api.GET.mockReset();
  api.POST.mockReset();
  routeGet(api.GET, async () => ok(overridePage([], null)));
  api.POST.mockResolvedValue(ok(overrideItem(SERVICE_A)));
  client = createQueryClient();
  memory = { current: new Map() };
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterEach(() => {
  vi.useRealTimers();
});

it('CM-12: four kinds only; follow-plan and zero have no value field and send no value; an empty percentage cannot be saved', async () => {
  mountDialog();
  expect(Array.from(kindSelect().options).map((option) => option.value)).toEqual([
    'FOLLOW_PLAN',
    'ZERO',
    'PCT',
    'FIXED',
  ]);
  await waitFor(() => expect(saveButton().disabled).toBe(true));
  expect(await screen.findByText(L.bpsError)).toBeTruthy();
  fireEvent.change(kindSelect(), { target: { value: 'FOLLOW_PLAN' } });
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  expect(screen.queryByLabelText(L.bps)).toBeNull();
  expect(screen.queryByLabelText(L.amount)).toBeNull();
  fireEvent.click(saveButton());
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
  expect(api.POST.mock.calls[0]?.[1].body).toEqual({
    service_id: SERVICE_A,
    rule: { kind: 'FOLLOW_PLAN' },
    effective_from: '2026-11-21',
  });
});

it('an invalid percentage or amount shows its field error and keeps save disabled', async () => {
  mountDialog();
  fireEvent.change(bpsInput(), { target: { value: '10001' } });
  expect(await screen.findByText(L.bpsError)).toBeTruthy();
  await waitFor(() => expect(saveButton().disabled).toBe(true));
  fireEvent.change(kindSelect(), { target: { value: 'FIXED' } });
  fireEvent.change(amountInput(), { target: { value: '-1.000' } });
  expect(await screen.findByText(L.moneyError)).toBeTruthy();
  await waitFor(() => expect(saveButton().disabled).toBe(true));
});

it('KWD: 12.5 is normalised to 12.500 and sent as a string, also from Arabic digits', async () => {
  api.POST.mockResolvedValue(
    ok(overrideItem(SERVICE_A, { rule: { kind: 'FIXED', value: '12.500' } })),
  );
  mountDialog();
  fireEvent.change(kindSelect(), { target: { value: 'FIXED' } });
  fireEvent.change(amountInput(), { target: { value: '12.5' } });
  fireEvent.blur(amountInput());
  await waitFor(() => expect(amountInput().value).toBe('12.500'));
  fireEvent.click(saveButton());
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
  const body = api.POST.mock.calls[0]?.[1].body as { rule: { kind: string; value: string } };
  expect(body.rule).toEqual({ kind: 'FIXED', value: '12.500' });
  expect(typeof body.rule.value).toBe('string');
  fireEvent.change(amountInput(), { target: { value: '١٢.٥' } });
  fireEvent.click(saveButton());
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  const second = api.POST.mock.calls[1]?.[1].body as { rule: { value: string } };
  expect(second.rule.value).toBe('12.500');
  expect(typeof second.rule.value).toBe('string');
});

it('the start date defaults to the business day, not the stored row\'s date', async () => {
  mountDialog(
    service({
      current_override: {
        id: '01920000-0000-7000-8000-0000000000d1',
        rule: { kind: 'PCT', value: 1500 },
        effective_from: '2026-01-05',
        created_at: '2026-01-05T09:00:00Z',
      },
    }),
  );
  await waitFor(() => expect(dateInput().value).toBe('2026-11-21'));
  expect(bpsInput().value).toBe('1500');
});

it('CM-13: a past-date refusal shows at the date field, a closed-period refusal on the form, values stay and both clear on edit', async () => {
  api.POST.mockResolvedValueOnce({
    error: { code: 'COMMISSION_EFFECTIVE_FROM_PAST' },
    response: { status: 422, ok: false },
  });
  mountDialog();
  fireEvent.change(bpsInput(), { target: { value: '1500' } });
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  fireEvent.click(saveButton());
  expect(await screen.findByText(L.pastDate)).toBeTruthy();
  expect(bpsInput().value).toBe('1500');
  api.POST.mockResolvedValueOnce({
    error: { code: 'COMMISSION_PERIOD_CLOSED' },
    response: { status: 409, ok: false },
  });
  fireEvent.change(bpsInput(), { target: { value: '1600' } });
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  fireEvent.click(saveButton());
  expect(await screen.findByText(L.closedPeriod)).toBeTruthy();
  fireEvent.change(bpsInput(), { target: { value: '1700' } });
  await waitFor(() => expect(screen.queryByText(L.closedPeriod)).toBeNull());
  expect(screen.queryByText(L.pastDate)).toBeNull();
  expect(bpsInput().value).toBe('1700');
});

it('a pending save locks the dialog; after success it shows saved, re-bases the form and stays open', async () => {
  const pending = deferredAnswer();
  api.POST.mockReturnValueOnce(pending.promise);
  const { onClose } = mountDialog();
  fireEvent.change(bpsInput(), { target: { value: '1500' } });
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  const submit = saveButton();
  fireEvent.click(submit);
  await waitFor(() => expect(screen.getByRole('button', { name: L.saving })).toBeTruthy());
  expect(submit.disabled).toBe(true);
  expect((screen.getByRole('button', { name: L.cancel }) as HTMLButtonElement).disabled).toBe(true);
  const dialog = document.querySelector('dialog');
  if (dialog) fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => {
    pending.resolve(ok(overrideItem(SERVICE_A, { rule: { kind: 'PCT', value: 1500 } })));
  });
  expect(await screen.findByText(L.saved)).toBeTruthy();
  expect(document.querySelector('dialog')).toBeTruthy();
  await waitFor(() => expect(bpsInput().value).toBe('1500'));
  expect(dateInput().value).toBe('2026-11-21');
});

it('history: the current mark follows is_current, pages append, a failed page retries and an empty history says so', async () => {
  const empty = mountDialog();
  expect(await screen.findByText(L.empty)).toBeTruthy();
  empty.unmount();
  let page = 0;
  routeGet(api.GET, async () => {
    page += 1;
    if (page === 1)
      return ok(
        overridePage(
          [
            overrideItem(SERVICE_A, { id: '01920000-0000-7000-8000-0000000000e1', is_current: true }),
            overrideItem(SERVICE_A, { id: '01920000-0000-7000-8000-0000000000e2', is_current: false }),
          ],
          'next-cursor',
        ),
      );
    if (page === 2)
      return ok(
        overridePage(
          [overrideItem(SERVICE_A, { id: '01920000-0000-7000-8000-0000000000e3', is_current: false })],
          'another-cursor',
        ),
      );
    return { error: { code: 'INTERNAL' }, response: { status: 500, ok: false } };
  });
  mountDialog();
  expect(await screen.findByText(L.current)).toBeTruthy();
  expect(screen.getAllByText(L.current)).toHaveLength(1);
  fireEvent.click(await screen.findByRole('button', { name: L.loadMore }));
  await waitFor(() => expect(screen.getAllByText('15.00%')).toHaveLength(3));
  fireEvent.click(screen.getByRole('button', { name: L.loadMore }));
  expect(await screen.findByText(L.couldNot)).toBeTruthy();
  expect(screen.getByRole('button', { name: L.loadMore })).toBeTruthy();
});
