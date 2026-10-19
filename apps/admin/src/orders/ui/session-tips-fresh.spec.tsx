import type { SessionTips } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { sessionTipsKey, sessionTipsPath } from '../api/use-session-tips';
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

function tipped(revision: number, amount: string): SessionTips {
  return {
    revision,
    tips: [{ employee_id: id(6), method: 'CASH', amount }],
    total_cash: amount,
    total_card: '0.000',
  };
}

function renderTips(client: QueryClient) {
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

it('refetches tips on open even when the cached read is still fresh', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 }, mutations: { retry: false } },
  });
  client.setQueryData(sessionTipsKey(scope, id(12)), tipped(1, '1.000'));
  api.get.mockImplementation((path: string) =>
    Promise.resolve(
      path === sessionTipsPath
        ? { data: tipped(2, '2.500'), response: { status: 200 } }
        : {
            error: { code: 'SESSION_NOT_FOUND', message_ar: 'x', message_en: 'x' },
            response: { status: 404 },
          },
    ),
  );
  renderTips(client);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  expect(await screen.findByDisplayValue('2.500')).toBeTruthy();
  expect(screen.queryByDisplayValue('1.000')).toBeNull();
});
