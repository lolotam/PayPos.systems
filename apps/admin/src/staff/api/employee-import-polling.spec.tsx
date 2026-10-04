import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { useEmployeeImport } from './use-employee-import';

const client = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => client }));

it('polls an accepted preview and stops on both terminal states', async () => {
  const previewId = '01930000-0000-7000-8000-000000000001';
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  let status: 'commit_requested' | 'committed' | 'failed' = 'commit_requested';
  client.POST.mockResolvedValue({ data: { preview_id: previewId } });
  client.GET.mockImplementation(async (path: string) => ({
    data: path.endsWith('template')
      ? {
          file_name: 'employees.xlsx',
          content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content_base64: 'UEsD',
        }
      : {
          preview_id: previewId,
          status,
          created_count: status === 'committed' ? 2 : 0,
          error_code: null,
        },
  }));
  const { result, unmount } = renderHook(() => useEmployeeImport('company', 'business', 'user'), {
    wrapper,
  });
  await act(async () => {
    await result.current.commit.mutateAsync(previewId);
  });
  await waitFor(() => expect(result.current.status.data?.status).toBe('commit_requested'));
  const query = queryClient
    .getQueryCache()
    .find({ queryKey: ['employee-import-status', 'company', 'business', 'user', previewId] });
  if (query === undefined || query.observers[0] === undefined)
    throw new Error('Missing status observer');
  const interval = query.observers[0].options.refetchInterval as (
    current: typeof query,
  ) => number | false;
  expect(interval(query)).toBe(1000);
  status = 'committed';
  await act(async () => {
    await result.current.status.refetch();
  });
  expect(interval(query)).toBe(false);
  status = 'failed';
  await act(async () => {
    await result.current.status.refetch();
  });
  expect(interval(query)).toBe(false);
  unmount();
  queryClient.clear();
});
