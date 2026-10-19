import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { sessionTipsPath } from '../api/use-session-tips';
import { id, scope } from '../model/session-recording-result.fixture';
import type { TipSourceLine } from '../model/session-tip-source';
import { SessionTipsLauncher } from './session-tips-launcher';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: api.get, PUT: api.put }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@pospay/i18n', async (importOriginal) => {
  const actual = await importOriginal<{ normalizeKwdInput: (text: string) => string }>();
  return { ...actual, normalizeKwdInput: (text: string) => text.trim() };
});

const lines: readonly TipSourceLine[] = [
  {
    status: 'ACTIVE',
    net: '8.000',
    performers: [{ employee_id: id(6), share_bps: 10000, name_ar: null, name_en: 'Ada' }],
  },
];
const empty = { revision: 0, tips: [], total_cash: '0.000', total_card: '0.000' };

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function show(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function hide(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  api.get.mockReset();
  api.put.mockReset();
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

it('sends a three-decimal amount when the typed text has fewer places', async () => {
  api.put.mockResolvedValue({
    data: {
      revision: 1,
      tips: [{ employee_id: id(6), method: 'CASH', amount: '1.500' }],
      total_cash: '1.500',
      total_card: '0.000',
    },
    response: { status: 200 },
  });
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
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  await screen.findByLabelText(t('en', 'sessionTips.total'));
  fireEvent.change(screen.getByLabelText(`${'Ada'} ${t('en', 'sessionTips.cashAmount')}`), {
    target: { value: '1.5' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
  expect(api.put.mock.calls[0]?.[1].body.tips).toEqual([
    { employee_id: id(6), method: 'CASH', amount: '1.500' },
  ]);
});
