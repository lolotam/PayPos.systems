import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SessionModule from '@/session/api/use-session';
import type * as WorkspaceModule from '@/workspace/model/workspace-provider';
import { WorkspaceProvider } from '@/workspace/model/workspace-provider';

import { frameState, selectBusiness } from '../frames/frame-test-support';
import { ApprovalsInboxHost } from './approvals-inbox-host';
import { useApprovalInbox, useApprovalKinds } from './use-approval-kinds';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock(
  'next/navigation',
  async () => (await import('../frames/frame-test-support')).navigationMock,
);
vi.mock(
  '@/shared/locale/locale-context',
  async () => (await import('../frames/frame-test-support')).localeMock,
);
vi.mock(
  './use-visible-page-ids',
  async () => (await import('../frames/frame-test-support')).visibleMock,
);
// القارئ الحقيقي لمساحة العمل والهوية بيتستعملوا بس في اختبارات الانقطاع، والباقي بيظل على المحاكي.
const toggles = vi.hoisted(() => ({ useRealWorkspace: false, useRealIdentity: false }));
vi.mock('@/workspace/model/workspace-provider', async () => {
  const actual = await vi.importActual<typeof WorkspaceModule>('@/workspace/model/workspace-provider');
  const support = await import('../frames/frame-test-support');
  return {
    ...actual,
    useWorkspace: () =>
      toggles.useRealWorkspace ? actual.useWorkspace() : support.workspaceMock.useWorkspace(),
  };
});
const identity = vi.hoisted(() => ({
  userId: 'user-1' as string | null,
  status: 'settled' as 'pending' | 'failed' | 'settled',
}));
vi.mock('@/session/api/use-session', async () => {
  const actual = await vi.importActual<typeof SessionModule>('@/session/api/use-session');
  return {
    ...actual,
    useSessionIdentity: (enabled: boolean) =>
      toggles.useRealIdentity ? actual.useSessionIdentity(enabled) : identity,
  };
});
const getSession = vi.hoisted(() => vi.fn());
vi.mock('@/session/api/browser-client', () => ({ browserAuthClient: () => ({ getSession }) }));

const EXCEPTIONS = '/v1/businesses/{businessId}/branches/{branchId}/attendance-exceptions';
const bodies: Record<string, unknown> = {
  '/v1/businesses/{businessId}/leave-requests': {
    items: [],
    next_cursor: null,
    request_branch_ids: [],
  },
  '/v1/businesses/{businessId}/attendance-change-requests': {
    can_decide_any: true,
    can_request: false,
    items: [],
    next_cursor: null,
  },
  [EXCEPTIONS]: { items: [], next_cursor: null },
};

function renderKinds<T = ReturnType<typeof useApprovalKinds>>(
  hook: () => T = useApprovalKinds as () => T,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(hook, { wrapper });
}

beforeEach(() => {
  identity.userId = 'user-1';
  identity.status = 'settled';
  toggles.useRealWorkspace = false;
  toggles.useRealIdentity = false;
  api.GET.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue({ error: { status: 401 } });
  selectBusiness('restaurant');
  frameState.visible = [
    'dashboard',
    'leave-approvals',
    'attendance-requests',
    'attendance-exceptions',
  ];
});

it('lists nothing while the page reads are still loading', () => {
  api.GET.mockReturnValue(new Promise(() => undefined));
  expect(renderKinds().result.current).toEqual([]);
});

it('does not link a user who is refused attendance exceptions to that page', async () => {
  api.GET.mockImplementation((path: string) =>
    Promise.resolve(
      path === EXCEPTIONS
        ? { error: { code: 'FORBIDDEN' }, response: { status: 403 } }
        : { data: bodies[path], response: { status: 200 } },
    ),
  );
  const { result } = renderKinds();
  await waitFor(() => expect(result.current).toHaveLength(2));
  expect(result.current.map((kind) => kind.href)).toEqual(['/staff/attendance-requests', '/leave']);
});

it('lists all three kinds once every page read succeeds', async () => {
  api.GET.mockImplementation((path: string) =>
    Promise.resolve({ data: bodies[path], response: { status: 200 } }),
  );
  const { result } = renderKinds();
  await waitFor(() => expect(result.current).toHaveLength(3));
});

describe('the inbox state', () => {
  const answerExcept = (path: string, status: number, code?: string) =>
    api.GET.mockImplementation((requested: string) =>
      Promise.resolve(
        requested === path
          ? { error: code === undefined ? undefined : { code }, response: { status } }
          : { data: bodies[requested], response: { status: 200 } },
      ),
    );

  it('is loading while the reads run', () => {
    api.GET.mockReturnValue(new Promise(() => undefined));
    expect(renderKinds(useApprovalInbox).result.current.state).toBe('loading');
  });

  it('is failed, and still lists the other kinds, when a read fails other than by refusal', async () => {
    answerExcept(EXCEPTIONS, 500, 'BOOM');
    const { result } = renderKinds(useApprovalInbox);
    await waitFor(() => expect(result.current.state).toBe('failed'));
    expect(result.current.kinds).toHaveLength(2);
  });

  it('treats a refusal with an empty body as a refusal, not as a failure', async () => {
    answerExcept(EXCEPTIONS, 403);
    const { result } = renderKinds(useApprovalInbox);
    await waitFor(() => expect(result.current.kinds).toHaveLength(2));
    expect(result.current.state).toBe('settled');
  });

  it('is failed, not empty, when the workspace itself failed to load', () => {
    frameState.workspace = { status: 'error', message: 'down', companies: [], choose: vi.fn() };
    const { result } = renderKinds(useApprovalInbox);
    expect(result.current).toEqual({ kinds: [], state: 'failed' });
  });

  it.each([
    ['failed', 'failed'],
    ['pending', 'loading'],
  ] as const)('maps the user identity read "%s" to the inbox state "%s"', (status, expected) => {
    identity.userId = null;
    identity.status = status;
    expect(renderKinds(useApprovalInbox).result.current.state).toBe(expected);
  });

  it('settles with no kinds when every read is refused', async () => {
    api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
    const { result } = renderKinds(useApprovalInbox);
    await waitFor(() => expect(result.current.state).toBe('settled'));
    expect(result.current.kinds).toEqual([]);
  });

  it('settles without waiting for the reads a missing branch turns off', async () => {
    if (frameState.workspace?.status === 'ready') frameState.workspace.branch = undefined;
    answerExcept('none', 200, 'NONE');
    const { result } = renderKinds(useApprovalInbox);
    await waitFor(() => expect(result.current.kinds).toHaveLength(1));
    expect(result.current.state).toBe('settled');
  });
});

/** يرسم الصندوق على عميل واحد، زي ما الإطار بركّبه. */
function renderInbox(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ApprovalsInboxHost />
    </QueryClientProvider>,
  );
}

/**
 * رفض محفوظ من زيارة سابقة ما يُقدَّم دليلاً: إعادة التحقق موقوفة بالاتصال، فالحالة «تعذّر التحقق»
 * مش «مفيش قوائم»، والقراءة المخزَّنة من قبل ما تكفي.
 */
async function ignoresCachedRefusal(): Promise<void> {
  api.GET.mockImplementation((path: string) =>
    Promise.resolve({ data: bodies[path], response: { status: 200 } }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const firstVisit = renderInbox(client);
  await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(3));
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  await act(() => client.refetchQueries());
  await waitFor(() => expect(screen.getByText(t('en', 'adminNav.approvalsInboxEmpty'))).toBeTruthy());
  firstVisit.unmount();
  onlineManager.setOnline(false);
  renderInbox(client);
  expect((await screen.findByRole('alert')).textContent).toBe(t('en', 'adminNav.approvalsInboxFailed'));
  expect(screen.queryByText(t('en', 'adminNav.approvalsInboxEmpty'))).toBeNull();
  expect(screen.queryAllByRole('link')).toHaveLength(0);
}

const WORKSPACES = '/v1/me/workspaces';
const WORKSPACE_COMPANY = {
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

/** رد مساحة العمل والقوائم مع بعض، زي ما السيرفر بيجاوب على المسارات دي. */
function answerWorkspacesAndLists(path: string): { data?: unknown; response: { status: number } } {
  if (path === WORKSPACES) {
    return {
      data: { companies: [WORKSPACE_COMPANY], capabilities: { staff_access: false } },
      response: { status: 200, ok: true },
    };
  }
  return { data: bodies[path], response: { status: 200 } };
}

/**
 * قراءة مساحة العمل موقوفة بالاتصال: الصندوق يقول «تعذّر التحقق» بدل ما يفضل «جارٍ التحميل» للأبد،
 * ويفحص القوائم من جديد لما يرجع الاتصال.
 */
async function failsWhenTheWorkspaceReadIsPaused(): Promise<void> {
  toggles.useRealWorkspace = true;
  onlineManager.setOnline(false);
  api.GET.mockImplementation((path: string) => Promise.resolve(answerWorkspacesAndLists(path)));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <DirectionProvider dir="ltr">
      <QueryClientProvider client={client}>
        <WorkspaceProvider>
          <ApprovalsInboxHost />
        </WorkspaceProvider>
      </QueryClientProvider>
    </DirectionProvider>,
  );
  expect((await screen.findByRole('alert')).textContent).toBe(t('en', 'adminNav.approvalsInboxFailed'));
  expect(screen.queryByRole('status')).toBeNull();
  act(() => onlineManager.setOnline(true));
  await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(3));
  expect(screen.queryByRole('alert')).toBeNull();
}

/**
 * زائر مجهول محفوظ: إعادة التحقق موقوفة بالاتصال وما فيش معرّف، فالهوية «تعذّر» مش «مستقرة بلا
 * مستخدم»، والصندوق يقول «تعذّر التحقق» بدل ما يقول «مفيش قوائم».
 */
async function failsWhenTheAnonymousIdentityIsPaused(): Promise<void> {
  toggles.useRealIdentity = true;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['session', 'user'], null);
  onlineManager.setOnline(false);
  renderInbox(client);
  expect((await screen.findByRole('alert')).textContent).toBe(t('en', 'adminNav.approvalsInboxFailed'));
  expect(screen.queryByText(t('en', 'adminNav.approvalsInboxEmpty'))).toBeNull();
}

/**
 * مستخدم مسجّل محفوظ مع قوائم ما جاوبتش من التركيب: القراءة كلها موقوفة، فالحالة «تعذّر التحقق»
 * مش «جارٍ التحميل».
 */
async function failsWhenNoListAnsweredSinceMount(): Promise<void> {
  toggles.useRealIdentity = true;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['session', 'user'], { id: 'user-1', email: 'u@example.test', name: 'U' });
  onlineManager.setOnline(false);
  renderInbox(client);
  expect((await screen.findByRole('alert')).textContent).toBe(t('en', 'adminNav.approvalsInboxFailed'));
  expect(screen.queryByRole('status')).toBeNull();
}

describe('the inbox while the connection is down', () => {
  afterEach(() => onlineManager.setOnline(true));

  it('says the lists could not be checked instead of loading forever, then lists them when the connection returns', async () => {
    onlineManager.setOnline(false);
    api.GET.mockImplementation((path: string) =>
      Promise.resolve({ data: bodies[path], response: { status: 200 } }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ApprovalsInboxHost />
      </QueryClientProvider>,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      t('en', 'adminNav.approvalsInboxFailed'),
    );
    expect(screen.queryByRole('status')).toBeNull();
    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(3));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not trust a cached success while the re-check is paused offline, and lists again when the connection returns', async () => {
    api.GET.mockImplementation((path: string) =>
      Promise.resolve({ data: bodies[path], response: { status: 200 } }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const visit = () =>
      render(
        <QueryClientProvider client={client}>
          <ApprovalsInboxHost />
        </QueryClientProvider>,
      );
    const firstVisit = visit();
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(3));
    firstVisit.unmount();
    onlineManager.setOnline(false);
    visit();
    expect((await screen.findByRole('alert')).textContent).toBe(
      t('en', 'adminNav.approvalsInboxFailed'),
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(3));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not trust a cached refusal while the re-check is paused offline', ignoresCachedRefusal);
  it('fails when the workspace read is paused offline, and lists again when it returns', failsWhenTheWorkspaceReadIsPaused);
  it('fails when the cached identity is anonymous and the re-check is paused offline', failsWhenTheAnonymousIdentityIsPaused);
  it('fails when no list answered since the mount', failsWhenNoListAnsweredSinceMount);
});
