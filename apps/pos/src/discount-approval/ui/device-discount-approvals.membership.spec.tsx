import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CallResult } from '@/shared/api/call';
import { LocaleProvider } from '@/shared/locale/locale-context';
import type * as DeviceDiscountCalls from '../api/device-discount-calls';
import { DeviceDiscountApprovals } from './device-discount-approvals';

type DeviceProposal = DeviceDiscountCalls.DeviceProposal;

const calls = vi.hoisted(() => ({ read: vi.fn(), decide: vi.fn() }));

vi.mock('../api/device-discount-calls', async () => {
  const actual = await vi.importActual<typeof DeviceDiscountCalls>(
    '../api/device-discount-calls',
  );
  return {
    ...actual,
    readDeviceDiscountProposals: calls.read,
    decideDeviceDiscountProposal: calls.decide,
  };
});

const branchId = '01923f66-3d2b-7c00-8000-000000000001';
const m1 = '01923f66-3d2b-7c00-8000-000000000101';
const m2 = '01923f66-3d2b-7c00-8000-000000000102';
const fixture: DeviceProposal = {
  kind: 'RECORD',
  id: '01923f66-3d2b-7c00-8000-000000000001',
  request_id: '01923f66-3d2b-7c00-8000-000000000002',
  service_name_ar: 'Dye AR',
  service_name_en: 'Dye',
  list_price: '25.000',
  price: '25.000',
  discount: '5.000',
  net: '20.000',
  effective_bps: 2000,
  requester_first_name_ar: 'Mona AR',
  requester_first_name_en: 'Mona',
  customer_first_name: 'Sara',
  requested_at: '2026-11-04T10:00:00.000Z',
  expires_at: '2026-11-04T13:20:00.000Z',
  terms_hash: 'a'.repeat(64),
};

function decideFailure(details?: unknown): CallResult<unknown> {
  return {
    ok: false,
    failure: {
      kind: 'http',
      status: 422,
      envelope: {
        code: 'DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED',
        message_ar: 'pick AR',
        message_en: 'pick EN',
        ...(details === undefined ? {} : { details }),
      },
    },
  };
}

function membershipFailure() {
  return decideFailure({
    approver_membership_ids: [m1, m2],
    approver_memberships: [
      {
        membership_id: m1,
        scope_type: 'BUSINESS',
        scope_id: '01923f66-3d2b-7c00-8000-000000000201',
        role: {
          code: 'business_manager',
          is_system: true,
          name_ar: null,
          name_en: 'Business manager',
        },
      },
      {
        membership_id: m2,
        scope_type: 'BRANCH',
        scope_id: '01923f66-3d2b-7c00-8000-000000000202',
        role: { code: 'custom_x', is_system: false, name_ar: 'Custom AR', name_en: 'Custom' },
      },
    ],
  });
}

function renderTree(client: QueryClient, operatorKey: string, onRejected: () => Promise<void>) {
  return (
    <QueryClientProvider client={client}>
      <DirectionProvider dir="rtl">
        <LocaleProvider locale="ar" setLocale={() => undefined}>
          <DeviceDiscountApprovals
            branchId={branchId}
            operatorKey={operatorKey}
            onRejected={onRejected}
          />
        </LocaleProvider>
      </DirectionProvider>
    </QueryClientProvider>
  );
}

function display() {
  const onRejected = vi.fn().mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(renderTree(client, '0:op-a', onRejected));
  const setOperator = (key: string) => view.rerender(renderTree(client, key, onRejected));
  return { client, setOperator, ...view };
}

async function submitDecision(decision: 'approve' | 'reject' = 'approve', reason?: string) {
  fireEvent.click(await screen.findByRole('button', { name: t('ar', 'deviceDiscountApproval.choose') }));
  fireEvent.change(screen.getByLabelText(t('ar', 'deviceDiscountApproval.phone')), {
    target: { value: '+96550000001' },
  });
  fireEvent.change(screen.getByLabelText(t('ar', 'deviceDiscountApproval.pin')), {
    target: { value: '1234' },
  });
  if (reason !== undefined) {
    fireEvent.change(screen.getByLabelText(t('ar', 'deviceDiscountApproval.reason')), {
      target: { value: reason },
    });
  }
  fireEvent.click(screen.getByRole('button', { name: t('ar', `deviceDiscountApproval.${decision}`) }));
}

async function openPicker(decision: 'approve' | 'reject' = 'approve', reason?: string) {
  calls.decide.mockResolvedValueOnce(membershipFailure());
  await submitDecision(decision, reason);
  expect(await screen.findByText(t('ar', 'deviceDiscountApproval.membershipPrompt'))).not.toBeNull();
}

function pickSecondMembership(decision: 'approve' | 'reject' = 'approve') {
  fireEvent.change(screen.getByLabelText(t('ar', 'deviceDiscountApproval.membership')), {
    target: { value: m2 },
  });
  fireEvent.click(screen.getByRole('button', { name: t('ar', `deviceDiscountApproval.${decision}`) }));
}

function expectEmptyForm() {
  expect(
    (screen.getByLabelText(t('ar', 'deviceDiscountApproval.phone')) as HTMLInputElement).value,
  ).toBe('');
  expect(
    (screen.getByLabelText(t('ar', 'deviceDiscountApproval.pin')) as HTMLInputElement).value,
  ).toBe('');
  expect(screen.queryByLabelText(t('ar', 'deviceDiscountApproval.membership'))).toBeNull();
}

function firstBody(): Record<string, unknown> {
  const body = calls.decide.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
  if (!body) throw new Error('first decision missing');
  return body;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T10:00:00.000Z'));
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  calls.read.mockReset().mockResolvedValue({ items: [fixture], next_cursor: null });
  calls.decide.mockReset().mockResolvedValue({ ok: true, data: { proposals: [] } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
});

describe('membership picker', () => {
  it('replaces private fields with two labelled choices and no error alert', async () => {
    display();
    await openPicker();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByLabelText(t('ar', 'deviceDiscountApproval.phone'))).toBeNull();
    expect(screen.queryByLabelText(t('ar', 'deviceDiscountApproval.pin'))).toBeNull();
    const select = screen.getByLabelText(
      t('ar', 'deviceDiscountApproval.membership'),
    ) as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      t('ar', 'deviceDiscountApproval.membership'),
      `${t('ar', 'roles.business_manager')} — ${t('ar', 'deviceDiscountApproval.scopeBusiness')}`,
      `Custom AR — ${t('ar', 'deviceDiscountApproval.scopeBranch')}`,
    ]);
    const approve = screen.getByRole('button', { name: t('ar', 'deviceDiscountApproval.approve') });
    expect(approve.matches(':disabled')).toBe(true);
    fireEvent.change(select, { target: { value: m2 } });
    expect(approve.matches(':disabled')).toBe(false);
  });

  it('retries approval once with the same private input and the chosen membership', async () => {
    display();
    await openPicker();
    pickSecondMembership();

    expect(await screen.findByText(t('ar', 'deviceDiscountApproval.approved'))).not.toBeNull();
    expect(calls.decide.mock.calls[1]?.[1]).toEqual({
      ...firstBody(),
      approver_membership_id: m2,
    });
    await waitFor(() => expect(calls.read.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('carries the rejection reason into the membership retry', async () => {
    display();
    await openPicker('reject', 'Too much');
    pickSecondMembership('reject');

    expect(await screen.findByText(t('ar', 'deviceDiscountApproval.rejected'))).not.toBeNull();
    expect(calls.decide.mock.calls[1]?.[1]).toEqual({
      ...firstBody(),
      reason: 'Too much',
      approver_membership_id: m2,
    });
  });

  it('shows a repeated membership response as a failure without another picker', async () => {
    display();
    await openPicker();
    calls.decide.mockResolvedValueOnce(membershipFailure());
    pickSecondMembership();

    expect((await screen.findByRole('alert')).textContent).toContain('pick AR');
    expect(screen.queryByLabelText(t('ar', 'deviceDiscountApproval.membership'))).toBeNull();
    expect(calls.decide).toHaveBeenCalledTimes(2);
  });
});

describe('clearing the held decision', () => {
  it('cancel drops the picker and never resends after reopening', async () => {
    display();
    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'deviceDiscountApproval.cancel') }));

    expect(screen.queryByText(t('ar', 'deviceDiscountApproval.membershipPrompt'))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'deviceDiscountApproval.choose') }));
    expectEmptyForm();
    expect(calls.decide).toHaveBeenCalledOnce();
  });

  it('operator change drops the picker and private input', async () => {
    const { setOperator } = display();
    await openPicker();
    setOperator('1:op-b');

    expect(screen.queryByText(t('ar', 'deviceDiscountApproval.membershipPrompt'))).toBeNull();
    expect(screen.queryByLabelText(t('ar', 'deviceDiscountApproval.membership'))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'deviceDiscountApproval.choose') }));
    expectEmptyForm();
    expect(calls.decide).toHaveBeenCalledOnce();
  });

  it('a late membership response after operator change stores and shows nothing', async () => {
    let resolve: (value: CallResult<unknown>) => void = () => undefined;
    calls.decide.mockReturnValueOnce(
      new Promise<CallResult<unknown>>((done) => {
        resolve = done;
      }),
    );
    const { setOperator } = display();
    await submitDecision();
    setOperator('1:op-b');
    await act(async () => {
      resolve(membershipFailure());
    });

    expect(screen.queryByText(t('ar', 'deviceDiscountApproval.membershipPrompt'))).toBeNull();
    expect(screen.queryByLabelText(t('ar', 'deviceDiscountApproval.membership'))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'deviceDiscountApproval.choose') }));
    expectEmptyForm();
    expect(calls.decide).toHaveBeenCalledOnce();
  });

  it('drops the pick when the proposal leaves and returns to the list', async () => {
    const { client } = display();
    await openPicker();
    calls.read.mockResolvedValueOnce({ items: [], next_cursor: null });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['device-discount-proposals', branchId] });
    });
    await screen.findByText(t('ar', 'deviceDiscountApproval.empty'));

    expect(screen.queryByText(t('ar', 'deviceDiscountApproval.membershipPrompt'))).toBeNull();
    expect(screen.queryByLabelText(t('ar', 'deviceDiscountApproval.membership'))).toBeNull();
    calls.read.mockResolvedValueOnce({ items: [fixture], next_cursor: null });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['device-discount-proposals', branchId] });
    });
    await screen.findByRole('heading', { level: 3, name: 'Dye AR' });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'deviceDiscountApproval.choose') }));
    expectEmptyForm();
    expect(calls.decide).toHaveBeenCalledOnce();
  });
});

describe('unreadable membership details', () => {
  it('shows the server message and no picker', async () => {
    calls.decide.mockResolvedValueOnce(decideFailure());
    display();
    await submitDecision();

    expect((await screen.findByRole('alert')).textContent).toContain('pick AR');
    expect(screen.queryByLabelText(t('ar', 'deviceDiscountApproval.membership'))).toBeNull();
  });
});
