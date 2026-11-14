import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';
import type * as DeviceDiscountCalls from '../api/device-discount-calls';
import { DeviceDiscountReadError } from '../api/device-discount-calls';
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

const secondPageFixture: DeviceProposal = {
  ...fixture,
  id: '01923f66-3d2b-7c00-8000-000000000003',
  service_name_ar: 'Oil Bath AR',
  service_name_en: 'Oil Bath',
};

function display(onRejected = vi.fn().mockResolvedValue(undefined)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onRejected,
    ...render(
      <QueryClientProvider client={client}>
        <DirectionProvider dir="rtl">
          <LocaleProvider locale="ar" setLocale={() => undefined}>
            <DeviceDiscountApprovals branchId={branchId} onRejected={onRejected} />
          </LocaleProvider>
        </DirectionProvider>
      </QueryClientProvider>,
    ),
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

function mockDecideFailure(
  status: number,
  code: string,
  message_ar: string,
  message_en: string,
) {
  calls.decide.mockResolvedValueOnce({
    ok: false,
    failure: {
      kind: 'http',
      status,
      envelope: { code, message_ar, message_en },
    },
  });
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
});

describe('reading the list', () => {
  it('shows service, four amounts with currency, percent, names, and time left with no phone number', async () => {
    display();
    expect(await screen.findByRole('heading', { level: 3, name: 'Dye AR' })).not.toBeNull();
    const currency = t('ar', 'deviceDiscountApproval.currency');
    expect(screen.getAllByText(`25.000 ${currency}`)).toHaveLength(2);
    expect(screen.getByText(`5.000 ${currency}`)).not.toBeNull();
    expect(screen.getByText(`20.000 ${currency}`)).not.toBeNull();
    expect(screen.getByText('20.00%')).not.toBeNull();
    expect(screen.getByText('Mona AR')).not.toBeNull();
    expect(screen.getByText('Sara')).not.toBeNull();
    const timeLeft = t('ar', 'deviceDiscountApproval.timeLeft')
      .replace('{hours}', '3')
      .replace('{minutes}', '20');
    expect(screen.getByText(timeLeft)).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/\+?\d{8,}/);
  });

  it('shows the empty message when the proposal list is empty', async () => {
    calls.read.mockResolvedValueOnce({ items: [], next_cursor: null });
    display();
    expect(await screen.findByText(t('ar', 'deviceDiscountApproval.empty'))).not.toBeNull();
  });

  it('shows load error on read failure and reloads card when retry is clicked', async () => {
    calls.read.mockRejectedValueOnce(new DeviceDiscountReadError(false));
    calls.read.mockResolvedValueOnce({ items: [fixture], next_cursor: null });
    display();
    expect(await screen.findByText(t('ar', 'deviceDiscountApproval.loadError'))).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'deviceDiscountApproval.retry') }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Dye AR' })).not.toBeNull();
    expect(calls.read).toHaveBeenCalledTimes(2);
  });

  it('calls onRejected when read is refused with FORBIDDEN, but not on network failure', async () => {
    const onRejectedForbidden = vi.fn().mockResolvedValue(undefined);
    calls.read.mockRejectedValueOnce(new DeviceDiscountReadError(true));
    display(onRejectedForbidden);
    await waitFor(() => expect(onRejectedForbidden).toHaveBeenCalledOnce());

    const onRejectedNetwork = vi.fn().mockResolvedValue(undefined);
    calls.read.mockRejectedValueOnce(new DeviceDiscountReadError(false));
    display(onRejectedNetwork);
    await screen.findByText(t('ar', 'deviceDiscountApproval.loadError'));
    expect(onRejectedNetwork).not.toHaveBeenCalled();
  });

  it('shows more button when next_cursor is present and loads the second page card', async () => {
    calls.read.mockResolvedValueOnce({ items: [fixture], next_cursor: 'cursor-2' });
    calls.read.mockResolvedValueOnce({ items: [secondPageFixture], next_cursor: null });
    display();
    expect(await screen.findByRole('heading', { level: 3, name: 'Dye AR' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'deviceDiscountApproval.more') }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Oil Bath AR' })).not.toBeNull();
    expect(calls.read).toHaveBeenLastCalledWith('cursor-2', expect.any(AbortSignal));
  });
});

describe('approving and rejecting', () => {
  it('approves with phone and PIN, shows approved status, sends exact body, and re-reads list', async () => {
    calls.decide.mockResolvedValueOnce({
      ok: true,
      data: { proposals: [{ id: fixture.id, status: 'APPROVED', expires_at: fixture.expires_at }] },
    });
    display();
    await chooseAndFill('+96550000001', '1234');
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'deviceDiscountApproval.approve') }));

    expect(await screen.findByText(t('ar', 'deviceDiscountApproval.approved'))).not.toBeNull();
    expect(calls.decide).toHaveBeenCalledWith('approve', {
      proposal_ids: [fixture.id],
      terms_hashes: [fixture.terms_hash],
      phone: '+96550000001',
      pin: '1234',
    });
    expect('reason' in (calls.decide.mock.calls[0]?.[1] ?? {})).toBe(false);
    await waitFor(() => expect(calls.read).toHaveBeenCalledTimes(2));
  });

  it('rejects with trimmed reason, shows rejected status, and sends reason in body', async () => {
    calls.decide.mockResolvedValueOnce({
      ok: true,
      data: { proposals: [{ id: fixture.id, status: 'REJECTED', expires_at: fixture.expires_at }] },
    });
    display();
    await chooseAndFill('+96550000001', '1234');
    fireEvent.change(screen.getByLabelText(t('ar', 'deviceDiscountApproval.reason')), {
      target: { value: '  discount too big  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'deviceDiscountApproval.reject') }));

    expect(await screen.findByText(t('ar', 'deviceDiscountApproval.rejected'))).not.toBeNull();
    expect(calls.decide).toHaveBeenCalledWith('reject', {
      proposal_ids: [fixture.id],
      terms_hashes: [fixture.terms_hash],
      phone: '+96550000001',
      pin: '1234',
      reason: 'discount too big',
    });
  });
});

describe('refusal messages', () => {
  it('shows wrong-PIN message and clears the PIN input on PIN_INVALID (401)', async () => {
    mockDecideFailure(401, 'PIN_INVALID', 'Wrong PIN AR', 'Wrong PIN');
    display();
    await submitApproval();

    expect((await screen.findByRole('alert')).textContent).toContain(
      t('ar', 'deviceDiscountApproval.pinInvalid'),
    );
    expect(
      (screen.getByLabelText(t('ar', 'deviceDiscountApproval.pin')) as HTMLInputElement).value,
    ).toBe('');
  });

  it('shows lock message on PIN_LOCKED (423)', async () => {
    mockDecideFailure(423, 'PIN_LOCKED', 'Locked AR', 'Locked');
    display();
    await submitApproval();

    expect((await screen.findByRole('alert')).textContent).toContain(
      t('ar', 'deviceDiscountApproval.locked'),
    );
  });

  it('shows busy message on TOO_MANY_REQUESTS (429)', async () => {
    mockDecideFailure(429, 'TOO_MANY_REQUESTS', 'Busy AR', 'Busy');
    display();
    await submitApproval();

    expect((await screen.findByRole('alert')).textContent).toContain(
      t('ar', 'deviceDiscountApproval.busy'),
    );
  });

  it('keeps message_ar visible after DISCOUNT_PROPOSAL_NOT_PENDING (409) removes card from list', async () => {
    calls.read
      .mockResolvedValueOnce({ items: [fixture], next_cursor: null })
      .mockResolvedValueOnce({ items: [], next_cursor: null });
    mockDecideFailure(409, 'DISCOUNT_PROPOSAL_NOT_PENDING', 'Not pending AR', 'Not pending');
    display();
    await submitApproval();

    expect(await screen.findByText(t('ar', 'deviceDiscountApproval.empty'))).not.toBeNull();
    expect(screen.queryByRole('heading', { level: 3, name: 'Dye AR' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Not pending AR');
  });

  it('shows message_ar on DISCOUNT_APPROVER_LIMIT_TOO_LOW (403)', async () => {
    mockDecideFailure(403, 'DISCOUNT_APPROVER_LIMIT_TOO_LOW', 'Limit too low AR', 'Limit too low');
    display();
    await submitApproval();

    expect((await screen.findByRole('alert')).textContent).toContain('Limit too low AR');
  });
});

describe('offline and validation', () => {
  it('shows wrong-PIN message on 3-digit PIN and sends nothing', async () => {
    display();
    await chooseAndFill('+96550000001', '123');
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'deviceDiscountApproval.approve') }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      t('ar', 'deviceDiscountApproval.pinInvalid'),
    );
    expect(calls.decide).not.toHaveBeenCalled();
  });

  it('disables controls and displays offline notice while offline without sending', async () => {
    display();
    await screen.findByRole('heading', { level: 3, name: 'Dye AR' });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'deviceDiscountApproval.choose') }));
    act(() => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
    });

    expect(await screen.findByText(t('ar', 'deviceDiscountApproval.offline'))).not.toBeNull();
    expect(
      screen.getByLabelText(t('ar', 'deviceDiscountApproval.phone')).matches(':disabled'),
    ).toBe(true);
    expect(
      screen
        .getByRole('button', {
          name: t('ar', 'deviceDiscountApproval.approve'),
        })
        .matches(':disabled'),
    ).toBe(true);
    expect(
      screen
        .getByRole('button', {
          name: t('ar', 'deviceDiscountApproval.reject'),
        })
        .matches(':disabled'),
    ).toBe(true);
    expect(calls.decide).not.toHaveBeenCalled();
  });
});
