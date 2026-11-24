import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { InvitationsPage } from './invitations-page';

// الشاشة الكاملة بالـ hooks الحقيقية وعميل API مزيّف: الرابط بيتعرض مرة واحدة ومش بيفضل في أي
// كاش بعد الإخفاء (P1-e)، والبوابة المقفولة بتشيل النموذج (P2-b)، والقائمة بصفحات من غير تكرار
// وبزر إعادة الإصدار لمن يستحقه بس وبأدوار مترجمة (P2-c).
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: api.get, POST: api.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const LINK = 'http://api.test/v1/auth/reset-password/secret-token?callbackURL=x';
const COMPANY = '01920000-0000-7000-8000-0000000000c9';
const item = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  role_code: 'accountant',
  scope_type: 'COMPANY',
  scope_id: COMPANY,
  state: 'PENDING',
  link_issued_at: null,
  created_at: '2026-11-24T08:00:00.000Z',
  can_reissue: false,
  ...overrides,
});
let client: QueryClient;

const renderPage = () =>
  render(
    <QueryClientProvider client={client}>
      <InvitationsPage
        companyId={COMPANY}
        userId="user-1"
        choices={{ businesses: [], branches: [] }}
      />
    </QueryClientProvider>,
  );

const cachesJson = () =>
  JSON.stringify([
    client
      .getQueryCache()
      .getAll()
      .map((query) => query.state),
    client
      .getMutationCache()
      .getAll()
      .map((mutation) => mutation.state),
  ]);

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  api.get.mockReset();
  api.post.mockReset();
});
afterEach(() => client.clear());

it('shows the link once, never keeps it in a cache, and hides it for good on dismissal', async () => {
  api.get.mockResolvedValue({ data: { items: [], next_cursor: null } });
  api.post.mockResolvedValue({ data: { invitation_id: 'inv-1', set_password_link: LINK } });
  renderPage();
  fireEvent.change(await screen.findByLabelText(t('en', 'invitations.emailLabel')), {
    target: { value: 'ahmed@example.test' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.nameLabel')), {
    target: { value: 'Ahmed' },
  });
  fireEvent.click(screen.getByLabelText(t('en', 'invitations.confirmTick')));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'invitations.submit') }));
  expect((await screen.findByText(LINK)).tagName).toBe('CODE');
  // gcTime: 0 + reset: لما الـ mutation يتفصل عن المراقب بيتشال من الكاش بالرابط اللي فيه.
  await waitFor(() => expect(cachesJson()).not.toContain('secret-token'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'invitations.dismiss') }));
  expect(screen.queryByText(LINK)).toBeNull();
  expect(cachesJson()).not.toContain('secret-token');
});

it('renders the closed-gate notice and no form when the API answers NOT_READY', async () => {
  api.get.mockResolvedValue({ error: { status: 503, code: 'NOT_READY' } });
  renderPage();
  expect((await screen.findByRole('status')).textContent).toBe(t('en', 'invitations.notReady'));
  expect(screen.queryByLabelText(t('en', 'invitations.emailLabel'))).toBeNull();
});

it('pages the list without duplicates, labels the role, and offers the new link only where the API allows', async () => {
  api.get.mockImplementation(
    async (_url: string, init: { params: { query: { cursor?: string } } }) => ({
      data:
        init.params.query.cursor === undefined
          ? {
              items: [
                item('01920000-0000-7000-8000-000000000001', { can_reissue: true }),
                item('01920000-0000-7000-8000-000000000002'),
              ],
              next_cursor: '01920000-0000-7000-8000-000000000002',
            }
          : {
              items: [
                item('01920000-0000-7000-8000-000000000003', {
                  role_code: 'branch_manager',
                  scope_type: 'BRANCH',
                }),
              ],
              next_cursor: null,
            },
    }),
  );
  renderPage();
  const table = await screen.findByRole('table');
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  expect(within(table).getAllByText(t('en', 'invitations.roleAccountant'))).toHaveLength(2);
  expect(
    within(table).getAllByRole('button', { name: t('en', 'invitations.reissue') }),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'invitations.loadMore') }));
  await waitFor(() =>
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4),
  );
  const grown = within(screen.getByRole('table'));
  expect(grown.getByText(t('en', 'invitations.roleBranchManager'))).toBeTruthy();
  expect(grown.getByText(t('en', 'invitations.scopeBranch'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('en', 'invitations.loadMore') })).toBeNull();
});
