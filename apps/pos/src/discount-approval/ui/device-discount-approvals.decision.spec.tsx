import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { type ReactNode, useLayoutEffect } from 'react';
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

function renderTree(
  client: QueryClient,
  operatorKey: string,
  onRejected: () => Promise<void>,
  probe?: ReactNode,
) {
  return (
    <QueryClientProvider client={client}>
      <DirectionProvider dir="rtl">
        <LocaleProvider locale="ar" setLocale={() => undefined}>
          {probe}
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

function display(initialKey = '0:op-a', commitLog?: CommitNotice[]) {
  const onRejected = vi.fn().mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (operatorKey: string) =>
    renderTree(
      client,
      operatorKey,
      onRejected,
      commitLog ? <CommitProbe key={operatorKey} log={commitLog} /> : undefined,
    );
  const view = render(tree(initialKey));
  const setOperator = (key: string) => {
    view.rerender(tree(key));
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

function chooseButton(): HTMLElement {
  return screen.getByRole('button', { name: t('ar', 'deviceDiscountApproval.choose') });
}

function decidingButtons(): HTMLElement[] {
  return screen.getAllByRole('button', { name: t('ar', 'deviceDiscountApproval.deciding') });
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

// يسجّل حالة الـ DOM وقت كل commit سببه رندر الأب — الـ commits اللي سببها تغيير حالة
// داخلي (زي نتيجة طلب متأخرة) مش بتعدّي من هنا، فبتتأكد منها بـ assertion صريح على الدوم.
type CommitNotice = { approved: boolean; alert: boolean };

function CommitProbe({ log }: { log: CommitNotice[] }) {
  useLayoutEffect(() => {
    log.push({
      approved: screen.queryByText(t('ar', 'deviceDiscountApproval.approved')) !== null,
      alert: screen.queryAllByRole('alert').length > 0,
    });
  });
  return null;
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

describe('prior-operator feedback during replacement (#1063)', () => {
  it('drops an approved notice from the first committed render after operator replacement', async () => {
    const commits: CommitNotice[] = [];
    const { setOperator } = display('0:op-a', commits);
    await submitApproval();
    expect(await screen.findByText(t('ar', 'deviceDiscountApproval.approved'))).not.toBeNull();

    const before = commits.length;
    setOperator('1:op-b');

    // أول commit بعد التبديل — الدوم نفسه نضيف، مش بس الـ commits اللي بعده.
    expect(screen.queryByText(t('ar', 'deviceDiscountApproval.approved'))).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(commits.length).toBeGreaterThan(before);
    expect(commits.slice(before).every((commit) => !commit.approved && !commit.alert)).toBe(true);
  });

  it('drops an invalid-PIN alert from the first committed render after operator replacement', async () => {
    const commits: CommitNotice[] = [];
    calls.decide.mockResolvedValueOnce(decideFailure(401, 'PIN_INVALID', 'x', 'x'));
    const { setOperator } = display('0:op-a', commits);
    await submitApproval();
    expect((await screen.findByRole('alert')).textContent).toContain(
      t('ar', 'deviceDiscountApproval.pinInvalid'),
    );

    const before = commits.length;
    setOperator('1:op-b');

    // أول commit بعد التبديل — الدوم نفسه نضيف، مش بس الـ commits اللي بعده.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(commits.length).toBeGreaterThan(before);
    expect(commits.slice(before).every((commit) => !commit.approved && !commit.alert)).toBe(true);
  });

  it('still refreshes the list when a stale verdict resolves after operator replacement', async () => {
    const pending = deferredDecide();
    const { setOperator } = display();
    await submitApproval();
    setOperator('1:op-b');
    const readsBefore = calls.read.mock.calls.length;
    await act(async () => {
      pending.resolve(decideFailure(409, 'DISCOUNT_PROPOSAL_CHANGED', 'x', 'x'));
    });

    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => {
      expect(calls.read.mock.calls.length).toBeGreaterThan(readsBefore);
    });
  });
});

describe('operator replacement while the previous request hangs (#1129)', () => {
  it('keeps the new operator enabled, lets it decide, and ignores the old request result', async () => {
    const oldRequest = deferredDecide();
    const newRequest = deferredDecide();
    const { setOperator } = display();
    await submitApproval();
    // طلب المشغّل الأول شغّال فعلاً — الشاشة بتقول "جاري تنفيذ القرار" وأزراره مقفولة.
    await waitFor(() => {
      expect(decidingButtons()).toHaveLength(2);
    });
    expect(chooseButton().matches(':disabled')).toBe(true);

    setOperator('1:op-b');

    // أزرار المشغّل التاني مفتوحة على طول — الطلب المعلّق ما بيقفلهاش.
    expect(chooseButton().matches(':disabled')).toBe(false);

    // والمشغّل التاني يقرر من غير ما يستنى الطلب المعلّق.
    await chooseAndFill('+96550000002', '4321');
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'deviceDiscountApproval.approve') }));
    await waitFor(() => {
      expect(decidingButtons()).toHaveLength(2);
    });
    expect(calls.decide).toHaveBeenCalledTimes(2);

    // نتيجة المشغّل الأول المتأخرة ما بتمسحش حالة المشغّل التاني ولا بتظهرله.
    await act(async () => {
      oldRequest.resolve({ ok: true, data: { proposals: [] } });
    });
    expect(decidingButtons()).toHaveLength(2);
    expect(screen.queryByText(t('ar', 'deviceDiscountApproval.approved'))).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    // ولما طلب المشغّل التاني يخلص، النتيجة بتظهر ليه هو.
    await act(async () => {
      newRequest.resolve({ ok: true, data: { proposals: [] } });
    });
    expect(await screen.findByText(t('ar', 'deviceDiscountApproval.approved'))).not.toBeNull();
  });
});
