import { formatInstant, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DevicesPage } from '../devices-page';
import {
  ACTIVE_DEVICE,
  ACTIVE_DEVICE_NEVER_SEEN,
  APPROVED_DEVICE,
  BRANCHES,
  PENDING_DEVICE,
  POLLED_DEVICE,
  SCOPE,
  SECOND_BRANCH,
  SECOND_BRANCH_PENDING_DEVICE,
  SECOND_PENDING_DEVICE,
  TIMEZONE,
  page,
  type GetOptions,
} from './devices-fixtures';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));

vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

let pendingItems: unknown[] = [];
let activeItems: unknown[] = [];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.fn();
  const tree = (scope: typeof SCOPE, onBranch: (branchId: string) => void) => (
    <QueryClientProvider client={client}>
      <DevicesPage scope={scope} branches={BRANCHES} onBranch={onBranch} />
    </QueryClientProvider>
  );
  const onBranch = (branchId: string) => {
    spy(branchId);
    view.rerender(tree({ ...SCOPE, branchId }, onBranch));
  };
  const view = render(tree(SCOPE, onBranch));
  return { client, onBranch: spy, close: () => view.unmount() };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  state.locale = 'en';
  api.GET.mockReset();
  api.POST.mockReset();
  pendingItems = [PENDING_DEVICE];
  activeItems = [ACTIVE_DEVICE];
  api.GET.mockImplementation(async (path: string, options: GetOptions) =>
    path.endsWith('/devices')
      ? options.params.query.status === 'active'
        ? page(activeItems)
        : page(pendingItems)
      : page([]),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the devices screen — the lists', () => {
  it.each(['ar', 'en'] as const)('shows the branch devices in %s', async (locale) => {
    state.locale = locale;
    const view = setup();

    expect(screen.getByRole('heading', { name: t(locale, 'devices.title') })).toBeTruthy();
    const pending = await screen.findByRole('region', { name: t(locale, 'devices.pendingTitle') });
    expect(await within(pending).findByText('Waiting till')).toBeTruthy();
    expect(within(pending).getByTestId('pending-device-check-code').textContent).toBe('K7QP');
    expect(
      within(pending).getByText(
        formatInstant(new Date(PENDING_DEVICE.created_at), locale, TIMEZONE),
        { exact: false },
      ),
    ).toBeTruthy();
    const active = await screen.findByRole('region', { name: t(locale, 'devices.activeTitle') });
    expect(await within(active).findByText('Front till')).toBeTruthy();
    expect(within(active).getByText(t(locale, 'devices.statusActive'))).toBeTruthy();
    view.close();
  });

  it('shows the active device that never called, and the one that did', async () => {
    api.GET.mockImplementation(async (path: string, options: GetOptions) =>
      path.endsWith('/devices')
        ? options.params.query.status === 'active'
          ? page([ACTIVE_DEVICE, ACTIVE_DEVICE_NEVER_SEEN])
          : page([PENDING_DEVICE])
        : page([]),
    );
    const view = setup();

    const active = await screen.findByRole('region', { name: t('en', 'devices.activeTitle') });
    expect(await within(active).findByText(t('en', 'devices.neverSeen'))).toBeTruthy();
    expect(
      within(active).getByText(
        formatInstant(new Date(ACTIVE_DEVICE.last_seen_at ?? ''), 'en', TIMEZONE),
      ),
    ).toBeTruthy();
    view.close();
  });
});

describe('the devices screen — the pairing code', () => {
  it('issues a code and shows it with its countdown and the cancellation note', async () => {
    api.POST.mockResolvedValue({
      data: { code: 'ABCD2345', expires_at: new Date(Date.now() + 600_000).toISOString() },
      response: { status: 201 },
    });
    const view = setup();

    fireEvent.click(screen.getByRole('button', { name: t('en', 'devices.generateCode') }));
    expect(await screen.findByTestId('pairing-code-value')).toHaveProperty(
      'textContent',
      'ABCD2345',
    );
    expect(screen.getByTestId('pairing-code-countdown').textContent).toBe('10:00');
    expect(screen.getByText(t('en', 'devices.replacesPreviousHint'))).toBeTruthy();
    view.close();
  });

  it('polls the pending list every five seconds and shows a device that registered meanwhile', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-26T10:00:00Z') });
    api.POST.mockResolvedValue({
      data: { code: 'ABCD2345', expires_at: '2026-11-26T10:10:00.000Z' },
      response: { status: 201 },
    });
    const view = setup();
    await flush();
    const pending = screen.getByRole('region', { name: t('en', 'devices.pendingTitle') });
    expect(within(pending).queryByText('Front Counter iPad')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: t('en', 'devices.generateCode') }));
    await flush();
    pendingItems = [PENDING_DEVICE, POLLED_DEVICE];

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await flush();

    expect(within(pending).getByText('Front Counter iPad')).toBeTruthy();
    expect(within(pending).getByText('W9M4')).toBeTruthy();
    view.close();
  });
});

describe('the devices screen — the code expiry', () => {
  it('stops polling and says the code expired once the time is up', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-26T10:00:00Z') });
    api.POST.mockResolvedValue({
      data: { code: 'ABCD2345', expires_at: '2026-11-26T10:10:00.000Z' },
      response: { status: 201 },
    });
    const view = setup();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: t('en', 'devices.generateCode') }));
    await flush();

    await act(async () => {
      vi.advanceTimersByTime(11 * 60_000);
      await Promise.resolve();
    });
    await flush();

    expect(screen.getByText(t('en', 'devices.codeExpired'))).toBeTruthy();
    expect(screen.queryByTestId('pairing-code-countdown')).toBeNull();

    const callsAtExpiry = api.GET.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(api.GET.mock.calls.length).toBe(callsAtExpiry);
    view.close();
  });
});

describe('the devices screen — the pending list', () => {
  it('refreshes the list and follows its cursor', async () => {
    api.GET.mockImplementation(async (path: string, options: GetOptions) =>
      path.endsWith('/devices')
        ? options.params.query.status === 'active'
          ? page([ACTIVE_DEVICE])
          : options.params.query.cursor === undefined
            ? page([PENDING_DEVICE], 'next-page')
            : page([SECOND_PENDING_DEVICE])
        : page([]),
    );
    const view = setup();

    const pending = await screen.findByRole('region', { name: t('en', 'devices.pendingTitle') });
    expect(await within(pending).findByText('Waiting till')).toBeTruthy();
    expect(screen.queryByText('Second till')).toBeNull();

    fireEvent.click(within(pending).getByRole('button', { name: t('en', 'devices.loadMore') }));
    expect(await screen.findByText('Second till')).toBeTruthy();

    api.GET.mockImplementation(async (path: string, options: GetOptions) =>
      path.endsWith('/devices')
        ? options.params.query.status === 'active'
          ? page([ACTIVE_DEVICE])
          : page([SECOND_PENDING_DEVICE])
        : page([]),
    );
    fireEvent.click(within(pending).getByRole('button', { name: t('en', 'devices.refresh') }));
    await waitFor(() => {
      expect(screen.queryByText('Waiting till')).toBeNull();
    });
    expect(screen.getByText('Second till')).toBeTruthy();
    view.close();
  });
});

async function regions() {
  return {
    pending: await screen.findByRole('region', { name: t('en', 'devices.pendingTitle') }),
    active: await screen.findByRole('region', { name: t('en', 'devices.activeTitle') }),
  };
}

describe('the devices screen — the pending decisions', () => {
  it('approving moves the device from the pending list to the active list', async () => {
    api.POST.mockResolvedValue({ data: undefined, response: { status: 204 } });
    const view = setup();

    const { pending, active } = await regions();
    await within(pending).findByText('Waiting till');
    pendingItems = [];
    activeItems = [ACTIVE_DEVICE, APPROVED_DEVICE];
    fireEvent.click(within(pending).getByRole('button', { name: t('en', 'devices.approve') }));

    await waitFor(() => {
      expect(within(pending).queryByText('Waiting till')).toBeNull();
    });
    expect(within(pending).getByText(t('en', 'devices.pendingEmpty'))).toBeTruthy();
    expect(await within(active).findByText('Waiting till')).toBeTruthy();
    const approveCall = api.POST.mock.calls.find((call) => String(call[0]).endsWith('/approve'));
    expect(approveCall?.[1]?.params?.path?.deviceId).toBe(PENDING_DEVICE.id);
    view.close();
  });

  it('asks before refusing a device, and cancelling leaves the list as it was', async () => {
    const view = setup();

    const { pending } = await regions();
    await within(pending).findByText('Waiting till');
    fireEvent.click(within(pending).getByRole('button', { name: t('en', 'devices.refuse') }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Waiting till')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: t('en', 'devices.cancel') }));
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(pending).getByText('Waiting till')).toBeTruthy();
    expect(api.POST).not.toHaveBeenCalled();
    view.close();
  });

  it('refusing removes the device from the pending list', async () => {
    api.POST.mockResolvedValue({ data: undefined, response: { status: 204 } });
    const view = setup();

    const { pending } = await regions();
    await within(pending).findByText('Waiting till');
    fireEvent.click(within(pending).getByRole('button', { name: t('en', 'devices.refuse') }));
    pendingItems = [];
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: t('en', 'devices.refuseConfirm'),
      }),
    );

    await waitFor(() => {
      expect(within(pending).queryByText('Waiting till')).toBeNull();
    });
    expect(within(pending).getByText(t('en', 'devices.pendingEmpty'))).toBeTruthy();
    view.close();
  });
});

describe('the devices screen — the active list', () => {
  it('warns before removing an active device, then it leaves the active list', async () => {
    api.POST.mockResolvedValue({ data: undefined, response: { status: 204 } });
    const view = setup();

    const { pending, active } = await regions();
    await within(active).findByText('Front till');
    fireEvent.click(within(active).getByRole('button', { name: t('en', 'devices.remove') }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Front till')).toBeTruthy();
    expect(within(dialog).getByText(t('en', 'devices.removeLead'))).toBeTruthy();
    activeItems = [];
    fireEvent.click(within(dialog).getByRole('button', { name: t('en', 'devices.removeConfirm') }));

    await waitFor(() => {
      expect(within(active).queryByText('Front till')).toBeNull();
    });
    expect(within(active).getByText(t('en', 'devices.activeEmpty'))).toBeTruthy();
    expect(within(pending).getByText('Waiting till')).toBeTruthy();
    view.close();
  });
});

describe('the devices screen — the access', () => {
  it('shows a permission notice when the branch refuses the read', async () => {
    api.GET.mockResolvedValue({
      error: { code: 'FORBIDDEN', message_ar: 'ممنوع', message_en: 'Forbidden' },
      response: { status: 403 },
    });
    const view = setup();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('en', 'devices.forbidden'));
    expect(screen.queryByRole('button', { name: t('en', 'devices.generateCode') })).toBeNull();
    view.close();
  });

  it('switches the branch the manager is looking at', async () => {
    api.GET.mockImplementation(async (path: string, options: GetOptions) =>
      path.endsWith('/devices')
        ? options.params.query.status === 'active'
          ? page([])
          : page(
              options.params.path?.branchId === SECOND_BRANCH.id
                ? [SECOND_BRANCH_PENDING_DEVICE]
                : [PENDING_DEVICE],
            )
        : page([]),
    );
    const view = setup();
    const pending = await screen.findByRole('region', { name: t('en', 'devices.pendingTitle') });
    expect(await within(pending).findByText('Waiting till')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(t('en', 'devices.branchLabel')), {
      target: { value: SECOND_BRANCH.id },
    });

    expect(view.onBranch).toHaveBeenCalledWith(SECOND_BRANCH.id);
    expect(await screen.findByText('Garden till')).toBeTruthy();
    expect(screen.queryByText('Waiting till')).toBeNull();
    view.close();
  });
});
