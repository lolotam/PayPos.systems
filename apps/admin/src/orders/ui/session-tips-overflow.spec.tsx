import type { SessionTips } from '@pospay/contracts';
import { serviceSessionErrors, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { sessionTipsPath } from '../api/use-session-tips';
import { id, scope } from '../model/session-recording-result.fixture';
import type { TipSourceLine } from '../model/session-tip-source';
import { SessionTipsLauncher } from './session-tips-launcher';

const api = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ PUT: api.put, GET: api.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const HUGE = '60000000000.000';
const lines: readonly TipSourceLine[] = [
  {
    status: 'ACTIVE',
    net: '8.000',
    performers: [
      { employee_id: id(6), share_bps: 10000, name_ar: null, name_en: 'Ada' },
      { employee_id: id(7), share_bps: 10000, name_ar: null, name_en: 'Bea' },
    ],
  },
];
const empty: SessionTips = { revision: 0, tips: [], total_cash: '0.000', total_card: '0.000' };

function box(name: string, kind: 'cashAmount' | 'cardAmount') {
  return screen.getByLabelText(`${name} ${t('en', `sessionTips.${kind}`)}`);
}
function renderTips() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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
async function openTips() {
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  await screen.findByLabelText(t('en', 'sessionTips.total'));
}
function assertTooLarge() {
  expect(screen.getByRole('alert').textContent).toContain(
    serviceSessionErrors.TIP_TOTAL_TOO_LARGE.message_en,
  );
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByText(t('en', 'sessionTips.amountInvalid'))).toBeNull();
  expect(screen.getByRole('list', { name: t('en', 'sessionTips.suggestion') }).textContent).toBe(
    '',
  );
  const apply = screen.getByRole('button', { name: t('en', 'sessionTips.useSuggestion') });
  expect((apply as HTMLButtonElement).disabled).toBe(true);
}
async function refuseSave() {
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(api.put).not.toHaveBeenCalled();
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function show(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function hide(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  api.put.mockReset();
  api.get.mockReset();
  api.get.mockImplementation((path: string) =>
    Promise.resolve(
      path === sessionTipsPath
        ? { data: empty, response: { status: 200 } }
        : {
            error: { code: 'SESSION_NOT_FOUND', message_ar: 'x', message_en: 'x' },
            response: { status: 404 },
          },
    ),
  );
});

it('refuses two cash amounts that only overflow together', async () => {
  renderTips();
  await openTips();
  fireEvent.change(box('Ada', 'cashAmount'), { target: { value: HUGE } });
  fireEvent.change(box('Bea', 'cashAmount'), { target: { value: HUGE } });
  assertTooLarge();
  await refuseSave();
});

it('refuses one cash amount and one card amount that only overflow together', async () => {
  renderTips();
  await openTips();
  fireEvent.change(box('Ada', 'cashAmount'), { target: { value: HUGE } });
  fireEvent.change(box('Ada', 'cardAmount'), { target: { value: HUGE } });
  assertTooLarge();
  await refuseSave();
});
