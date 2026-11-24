import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { DirectionProvider } from '@pospay/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '@/shared/api/query-client';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { useWorkspace, WorkspaceProvider } from './workspace-provider';
import { WorkspaceBody } from '../ui/workspace-body';

// الشركة عندها نشاط وفرع عشان الوكيل (WorkspaceBody) يرسم محتوى الصفحة العادي: شركة بلا
// أنشطة بتفتح شاشة أول نشاط في مكان الوكيل (spec 078)، وده مش اللي الاختبارات دي بتقيسه.
const COMPANY = {
  id: '01920000-0000-7000-8000-0000000000c1',
  name_ar: null,
  name_en: 'Provider Company',
  role_code: 'owner',
  scope: 'COMPANY',
  businesses: [
    {
      id: '01920000-0000-7000-8000-0000000000d1',
      name_ar: null,
      name_en: 'Provider Business',
      business_type: 'retail',
      country: 'KW',
      branches: [
        {
          id: '01920000-0000-7000-8000-0000000000e1',
          name_ar: null,
          name_en: 'Provider Branch',
          effective_timezone: 'Asia/Kuwait',
          is_active: true,
        },
      ],
    },
  ],
};

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function WorkspaceProbe() {
  const workspace = useWorkspace();
  return (
    <div>
      <span data-testid="ws-status">{workspace.status}</span>
      {workspace.status === 'ready' ? (
        <span data-testid="ws-company">{workspace.company.name_en}</span>
      ) : null}
    </div>
  );
}

function renderProvider(client: QueryClient) {
  return render(
    <DirectionProvider dir="ltr">
      <LocaleProvider locale="en" setLocale={() => undefined}>
        <QueryClientProvider client={client}>
          <WorkspaceProvider>
            <WorkspaceBody>
              <WorkspaceProbe />
            </WorkspaceBody>
          </WorkspaceProvider>
        </QueryClientProvider>
      </LocaleProvider>
    </DirectionProvider>,
  );
}

/** قراءة أولى ناجحة بالشركة، وبعدها إعادة جلب بتلبي بتابع الفشل المعطى. */
async function readThenRefetchWith(failure: () => Response): Promise<void> {
  const client = createQueryClient();
  let reads = 0;
  mockFetch.mockImplementation(async () => {
    reads += 1;
    if (reads === 1) return jsonResponse({ companies: [COMPANY] }, 200);
    return failure();
  });
  renderProvider(client);
  await screen.findByTestId('ws-company');
  await act(async () => {
    await client.refetchQueries({ queryKey: ['me', 'workspaces'] });
  });
}

describe('WorkspaceProvider refresh failures', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('a failed first read still shows the error state and no page content', async () => {
    mockFetch.mockImplementation(async () =>
      jsonResponse(
        { code: 'UNEXPECTED', message_ar: 'Synthetic refusal (ar fixture)', message_en: 'First read failed fixture' },
        500,
      ),
    );
    renderProvider(createQueryClient());
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.getByText('First read failed fixture')).not.toBeNull();
    expect(screen.queryByTestId('ws-status')).toBeNull();
  });

  it('a refetch failing with 401 shows the error state and drops the page content', async () => {
    await readThenRefetchWith(() =>
      jsonResponse(
        { code: 'UNAUTHORIZED', message_ar: 'Synthetic refusal (ar fixture)', message_en: 'Access refused fixture' },
        401,
      ),
    );
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.getByText('Access refused fixture')).not.toBeNull();
    expect(screen.queryByTestId('ws-status')).toBeNull();
  });

  it('a refetch failing with 403 shows the error state and drops the page content', async () => {
    await readThenRefetchWith(() =>
      jsonResponse(
        { code: 'FORBIDDEN', message_ar: 'Synthetic refusal (ar fixture)', message_en: 'Access removed fixture' },
        403,
      ),
    );
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.getByText('Access removed fixture')).not.toBeNull();
    expect(screen.queryByTestId('ws-status')).toBeNull();
  });

  it('a refetch failing with 401 and an empty body still shows the error state and drops the page content', async () => {
    await readThenRefetchWith(() => new Response(null, { status: 401 }));
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.queryByTestId('ws-status')).toBeNull();
  });

  it('a refetch failing with 403 and an empty body still shows the error state and drops the page content', async () => {
    await readThenRefetchWith(() => new Response(null, { status: 403 }));
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.queryByTestId('ws-status')).toBeNull();
  });

  it('a refetch failing with 500 keeps the selected company and shows no error', async () => {
    await readThenRefetchWith(() =>
      jsonResponse(
        { code: 'UNEXPECTED', message_ar: 'Synthetic refusal (ar fixture)', message_en: 'Refetch failed fixture' },
        500,
      ),
    );
    expect(screen.getByTestId('ws-status').textContent).toBe('ready');
    expect(screen.getByTestId('ws-company').textContent).toBe('Provider Company');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Refetch failed fixture')).toBeNull();
  });

  it('a refetch failing with a network error keeps the selected company', async () => {
    await readThenRefetchWith(() => {
      throw new TypeError('network died');
    });
    expect(screen.getByTestId('ws-status').textContent).toBe('ready');
    expect(screen.getByTestId('ws-company').textContent).toBe('Provider Company');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
