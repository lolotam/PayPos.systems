import type { RecordSessionTipsInput } from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { id, scope } from '../model/session-recording-result.fixture';
import { useRecordSessionTips, type UnresolvedTip } from './use-record-session-tips';

const api = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ PUT: api.put }) }));

const body: RecordSessionTipsInput = {
  expected_revision: 0,
  tips: [{ employee_id: id(6), method: 'CASH', amount: '6.000' }],
};
const saved = {
  data: { revision: 1, tips: body.tips, total_cash: '6.000', total_card: '0.000' },
  response: { status: 200 },
};
const attempt = { sessionId: id(12), body };

function harness() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => {
      const memory = useRef(new Map<string, UnresolvedTip>());
      return useRecordSessionTips(scope, memory);
    },
    { wrapper },
  );
}
function keyOf(index: number) {
  return api.put.mock.calls[index]?.[1].params.header['Idempotency-Key'] as string;
}
function sent(index: number) {
  return api.put.mock.calls[index]?.[1].body as RecordSessionTipsInput;
}

beforeEach(() => {
  api.put.mockReset();
});

it('replays the retained key and the same money strings after a network error', async () => {
  api.put.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(saved);
  const hook = harness();
  await expect(hook.result.current.mutateAsync(attempt)).rejects.toThrow('offline');
  await hook.result.current.mutateAsync(attempt);
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
  expect(keyOf(1)).toBe(keyOf(0));
  expect(sent(0)).toEqual(body);
  expect(sent(1)).toEqual(body);
  expect(typeof sent(0).tips[0]?.amount).toBe('string');
  expect(typeof sent(0).expected_revision).toBe('number');
});

it('mints a new key after a definitive 422 for the same body', async () => {
  api.put
    .mockResolvedValueOnce({
      error: { code: 'TIP_NO_CHANGE', message_ar: 'a', message_en: 'b' },
      response: { status: 422 },
    })
    .mockResolvedValueOnce(saved);
  const hook = harness();
  await expect(hook.result.current.mutateAsync(attempt)).rejects.toMatchObject({
    code: 'TIP_NO_CHANGE',
  });
  await hook.result.current.mutateAsync(attempt);
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
  expect(keyOf(1)).not.toBe(keyOf(0));
  expect(sent(1).tips[0]?.amount).toBe('6.000');
});
