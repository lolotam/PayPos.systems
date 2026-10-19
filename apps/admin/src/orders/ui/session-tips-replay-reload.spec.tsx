import type { SessionTips } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { sessionTipsPath } from '../api/use-session-tips';
import { id, scope } from '../model/session-recording-result.fixture';
import type { TipSourceLine } from '../model/session-tip-source';
import { SessionTipsLauncher } from './session-tips-launcher';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: api.get, PUT: api.put }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const lines: readonly TipSourceLine[] = [
  {
    status: 'ACTIVE',
    net: '8.000',
    performers: [{ employee_id: id(6), share_bps: 10000, name_ar: null, name_en: 'Ada' }],
  },
];

function ok(data: SessionTips) {
  return { data, response: { status: 200 } };
}
function tipped(revision: number, amount: string): SessionTips {
  return {
    revision,
    tips: [{ employee_id: id(6), method: 'CASH', amount }],
    total_cash: amount,
    total_card: '0.000',
  };
}
function missing() {
  return {
    error: { code: 'SESSION_NOT_FOUND', message_ar: 'x', message_en: 'x' },
    response: { status: 404 },
  };
}
function cashBox() {
  return screen.getByLabelText(`${'Ada'} ${t('en', 'sessionTips.cashAmount')}`) as HTMLInputElement;
}
function rowLocked() {
  const group = cashBox().closest('fieldset');
  if (!(group instanceof HTMLFieldSetElement)) throw new Error('missing tip row');
  return group.disabled;
}

function installReads() {
  let reads = 0;
  api.get.mockImplementation((path: string) => {
    if (path !== sessionTipsPath) return Promise.resolve(missing());
    reads += 1;
    if (reads === 1) return Promise.resolve(ok(tipped(2, '1.000')));
    if (reads === 2) return Promise.reject(new Error('reload failed'));
    return Promise.resolve(ok(tipped(5, '7.000')));
  });
}

function renderTips() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <SessionTipsLauncher
        scope={scope}
        sessionId={id(12)}
        lines={lines}
        online
        onAccessDenied={() => undefined}
      />
    </QueryClientProvider>,
  );
}

async function loseTheSave() {
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  expect(await screen.findByDisplayValue('1.000')).toBeTruthy();
  fireEvent.change(cashBox(), { target: { value: '4.000' } });
  fireEvent.change(screen.getByLabelText(t('en', 'sessionTips.reason')), {
    target: { value: 'because' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  expect(await screen.findByText(t('en', 'sessionTips.outcomeUnknown'))).toBeTruthy();
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function show(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function hide(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  api.get.mockReset();
  api.put.mockReset();
});

it('keeps the typed tip frozen when the replay cannot reload the current set', async () => {
  installReads();
  api.put.mockRejectedValueOnce(new Error('offline'));
  api.put.mockResolvedValueOnce(ok(tipped(1, '1.000')));
  renderTips();
  await loseTheSave();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.retrySame') }));
  expect(
    await screen.findByRole('button', { name: t('en', 'sessionTips.reloadCurrent') }),
  ).toBeTruthy();
  expect(screen.queryByText(t('en', 'sessionTips.saved'))).toBeNull();
  expect(cashBox().value).toBe('4.000');
  expect(rowLocked()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.reloadCurrent') }));
  expect(await screen.findByDisplayValue('7.000')).toBeTruthy();
  expect(screen.queryByText(t('en', 'sessionTips.saved'))).toBeNull();
  expect(screen.queryByDisplayValue('1.000')).toBeNull();
  expect(rowLocked()).toBe(false);
});
