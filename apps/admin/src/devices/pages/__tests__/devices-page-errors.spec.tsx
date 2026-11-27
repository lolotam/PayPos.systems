import { t, type MessageKey } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DevicesPage } from '../devices-page';
import {
  ACTIVE_DEVICE,
  BRANCHES,
  PENDING_DEVICE,
  SCOPE,
  page,
  refusal,
  type GetOptions,
} from './devices-fixtures';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));

vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

const MESSAGES = {
  issue: { ar: 'تعذر إصدار الكود', en: 'The code could not be issued' },
  approve: { ar: 'تعذرت الموافقة', en: 'The approval failed' },
  refuse: { ar: 'تعذر الرفض', en: 'The refusal failed' },
  remove: { ar: 'تعذر الشيل', en: 'The removal failed' },
};

type Failing = 'pairing-code' | 'approve' | 'revoke';

function failPost(failing: Failing, message: { ar: string; en: string }): void {
  api.POST.mockImplementation(async (path: string) =>
    path.endsWith(failing) ? refusal(message) : { data: undefined, response: { status: 204 } },
  );
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <DevicesPage scope={SCOPE} branches={BRANCHES} onBranch={vi.fn()} />
    </QueryClientProvider>,
  );
  return view;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function regions(locale: 'ar' | 'en') {
  const find = (key: MessageKey) => screen.findByRole('region', { name: t(locale, key) });
  const pending = await find('devices.pendingTitle');
  const active = await find('devices.activeTitle');
  await within(pending).findByText(PENDING_DEVICE.label);
  await within(active).findByText(ACTIVE_DEVICE.label);
  return { pairing: await find('devices.pairingTitle'), pending, active };
}

function alertTexts(region: HTMLElement): (string | null)[] {
  return within(region)
    .queryAllByRole('alert')
    .map((alert) => alert.textContent);
}

async function expectAlerts(region: HTMLElement, expected: string[]): Promise<void> {
  await waitFor(() => {
    expect(alertTexts(region)).toEqual(expected);
  });
}

async function confirmInDialog(locale: 'ar' | 'en', confirmKey: MessageKey): Promise<void> {
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: t(locale, confirmKey) }));
  await flush();
}

beforeEach(() => {
  state.locale = 'en';
  api.GET.mockReset();
  api.POST.mockReset();
  api.GET.mockImplementation(async (path: string, options: GetOptions) =>
    path.endsWith('/devices')
      ? options.params.query.status === 'active'
        ? page([ACTIVE_DEVICE])
        : page([PENDING_DEVICE])
      : page([]),
  );
});

describe.each(['ar', 'en'] as const)(
  'a refused action is shown in its own section — %s',
  (locale) => {
    beforeEach(() => {
      state.locale = locale;
    });

    it('a refused pairing code is shown next to the code only', async () => {
      failPost('pairing-code', MESSAGES.issue);
      const view = setup();
      const { pairing, pending, active } = await regions(locale);

      fireEvent.click(
        within(pairing).getByRole('button', { name: t(locale, 'devices.generateCode') }),
      );
      await flush();

      await expectAlerts(pairing, [MESSAGES.issue[locale]]);
      expect(alertTexts(pending)).toEqual([]);
      expect(alertTexts(active)).toEqual([]);
      view.unmount();
    });

    it('a refused approval is shown in the pending section only', async () => {
      failPost('approve', MESSAGES.approve);
      const view = setup();
      const { pairing, pending, active } = await regions(locale);

      fireEvent.click(within(pending).getByRole('button', { name: t(locale, 'devices.approve') }));
      await flush();

      await expectAlerts(pending, [MESSAGES.approve[locale]]);
      expect(alertTexts(active)).toEqual([]);
      expect(alertTexts(pairing)).toEqual([]);
      view.unmount();
    });

    it('a refused refusal is shown in the pending section only', async () => {
      failPost('revoke', MESSAGES.refuse);
      const view = setup();
      const { pending, active } = await regions(locale);

      fireEvent.click(within(pending).getByRole('button', { name: t(locale, 'devices.refuse') }));
      await confirmInDialog(locale, 'devices.refuseConfirm');

      await expectAlerts(pending, [MESSAGES.refuse[locale]]);
      expect(alertTexts(active)).toEqual([]);
      view.unmount();
    });

    it('a refused removal is shown in the active section only', async () => {
      failPost('revoke', MESSAGES.remove);
      const view = setup();
      const { pending, active } = await regions(locale);

      fireEvent.click(within(active).getByRole('button', { name: t(locale, 'devices.remove') }));
      await confirmInDialog(locale, 'devices.removeConfirm');

      await expectAlerts(active, [MESSAGES.remove[locale]]);
      expect(alertTexts(pending)).toEqual([]);
      view.unmount();
    });
  },
);

describe('a stale decision error', () => {
  it('is replaced by the error of the next decision, not shown beside it', async () => {
    api.POST.mockImplementation(async (path: string) =>
      path.endsWith('approve') ? refusal(MESSAGES.approve) : refusal(MESSAGES.refuse),
    );
    const view = setup();
    const { pending } = await regions('en');

    fireEvent.click(within(pending).getByRole('button', { name: t('en', 'devices.refuse') }));
    await confirmInDialog('en', 'devices.refuseConfirm');
    await expectAlerts(pending, [MESSAGES.refuse.en]);

    fireEvent.click(within(pending).getByRole('button', { name: t('en', 'devices.approve') }));
    await flush();

    await expectAlerts(pending, [MESSAGES.approve.en]);
    view.unmount();
  });

  it('disappears when the next decision succeeds', async () => {
    failPost('revoke', MESSAGES.refuse);
    const view = setup();
    const { pending } = await regions('en');

    fireEvent.click(within(pending).getByRole('button', { name: t('en', 'devices.refuse') }));
    await confirmInDialog('en', 'devices.refuseConfirm');
    await expectAlerts(pending, [MESSAGES.refuse.en]);

    api.POST.mockResolvedValue({ data: undefined, response: { status: 204 } });
    fireEvent.click(within(pending).getByRole('button', { name: t('en', 'devices.approve') }));
    await flush();

    await expectAlerts(pending, []);
    view.unmount();
  });
});
