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

const calls = vi.hoisted(() => ({
  read: vi.fn(),
  decide: vi.fn(),
}));

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

function display(initialKey = '0:op-a') {
  const onRejected = vi.fn().mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(renderTree(client, initialKey, onRejected));
  const setOperator = (key: string) => {
    view.rerender(renderTree(client, key, onRejected));
  };
  return {
    onRejected,
    setOperator,
    ...view,
  };
}

async function chooseAndFill(phone = '+96550000001', pin = '1234') {
  fireEvent.click(await screen.findByRole('button', { name: t('ar', 'deviceDiscountApproval.choose') }));
  fireEvent.change(screen.getByLabelText(t('ar', 'deviceDiscountApproval.phone')), {
    target: { value: phone },
  });
  fireEvent.change(screen.getByLabelText(t('ar', 'deviceDiscountApproval.pin')), {
    target: { value: pin },
  });
}

async function submitApproval(phone = '+96550000001', pin = '1234') {
  await chooseAndFill(phone, pin);
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'deviceDiscountApproval.approve') }));
}

export function decideFailure(
  status: number,
  code: string,
  message_ar: string,
  message_en: string,
  details?: unknown,
): CallResult<unknown> {
  return {
    ok: false,
    failure: {
      kind: 'http',
      status,
      envelope: {
        code,
        message_ar,
        message_en,
        ...(details !== undefined ? { details } : {}),
      },
    },
  };
}

function deferredDecide() {
  let resolve: (value: CallResult<unknown>) => void = () => undefined;
  const promise = new Promise<CallResult<unknown>>((done) => {
    resolve = done;
  });
  calls.decide.mockReturnValueOnce(promise);
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T10:00:00.000Z'));
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  calls.read.mockResolvedValue({ items: [fixture], next_cursor: null });
  calls.decide.mockResolvedValue({ ok: true, data: { proposals: [] } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
});

describe('late result after an operator change (#1059)', () => {
  it('ignores late approval after operator changes and refreshes list', async () => {
    const pending = deferredDecide();
    const { setOperator } = display();
    await submitApproval();
    setOperator('1:op-b');
    await act(async () => {
      pending.resolve({ ok: true, data: { proposals: [] } });
    });

    expect(screen.queryByText(t('ar', 'deviceDiscountApproval.approved'))).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => {
      expect(calls.read.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const chooseButton = screen.getByRole('button', {
      name: t('ar', 'deviceDiscountApproval.choose'),
    });
    expect(chooseButton.matches(':disabled')).toBe(false);
  });

  it('ignores late refusal after operator changes', async () => {
    const pending = deferredDecide();
    const { setOperator } = display();
    await submitApproval();
    setOperator('1:op-b');
    await act(async () => {
      pending.resolve(decideFailure(401, 'PIN_INVALID', 'x', 'x'));
    });

    expect(screen.queryByText(t('ar', 'deviceDiscountApproval.pinInvalid'))).toBeNull();
  });

  it('shows approved status when resolving approval without operator change', async () => {
    const pending = deferredDecide();
    display();
    await submitApproval();
    await act(async () => {
      pending.resolve({ ok: true, data: { proposals: [] } });
    });

    expect(await screen.findByText(t('ar', 'deviceDiscountApproval.approved'))).not.toBeNull();
  });
});
