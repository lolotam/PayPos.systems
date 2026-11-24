import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { InvitationsPage } from './invitations-page';

// الشاشة الكاملة بالـ hooks الحقيقية وعميل API مزيّف: الرابط بيتعرض مرة واحدة ومش في أي كاش
// لا أثناء الطلب ولا عند التسليم (P1-e)، والبوابة المقفولة بتشيل النموذج (P2-b)، والقائمة بصفحات من غير تكرار
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

const holdPost = () => {
  let settle: (value: unknown) => void = () => undefined;
  api.post.mockImplementation(() => new Promise((resolve) => (settle = resolve)));
  return (value: unknown) => settle(value);
};

it('keeps the email and the link out of both caches while the request is in flight and at hand-over', async () => {
  api.get.mockResolvedValue({ data: { items: [], next_cursor: null } });
  const answer = holdPost();
  renderPage();
  fireEvent.change(await screen.findByLabelText(t('en', 'invitations.emailLabel')), {
    target: { value: 'ahmed@example.test' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.nameLabel')), {
    target: { value: 'Ahmed' },
  });
  fireEvent.click(screen.getByLabelText(t('en', 'invitations.confirmTick')));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'invitations.submit') }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  // الطلب لسه ماردش: الإيميل مش في كاش الـ queries ولا الـ mutations.
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  expect(cachesJson()).not.toContain('ahmed@example.test');
  answer({ data: { invitation_id: 'inv-1', set_password_link: LINK } });
  expect((await screen.findByText(LINK)).tagName).toBe('CODE');
  // لحظة التسليم: الرابط ظاهر في الصفحة بس، والكاشين من غير رابط ولا إيميل.
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  expect(cachesJson()).not.toContain('secret-token');
  expect(cachesJson()).not.toContain('ahmed@example.test');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'invitations.dismiss') }));
  expect(screen.queryByText(LINK)).toBeNull();
});

it('keeps the re-issued link out of both caches in flight and at hand-over', async () => {
  const id = '01920000-0000-7000-8000-000000000001';
  api.get.mockResolvedValue({
    data: { items: [item(id, { can_reissue: true })], next_cursor: null },
  });
  const answer = holdPost();
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'invitations.reissue') }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  answer({ data: { invitation_id: id, set_password_link: LINK } });
  expect((await screen.findByText(LINK)).tagName).toBe('CODE');
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  expect(cachesJson()).not.toContain('secret-token');
});

it('renders the closed-gate notice and no form when the API answers NOT_READY', async () => {
  api.get.mockResolvedValue({ error: { status: 503, code: 'NOT_READY' } });
  renderPage();
  // الرسالة بتظهر كمان وهو لسه بيحمّل، فمفيش حكم على النموذج قبل ما الـ 503 يترد ويخلص الاستعلام.
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  await api.get.mock.results[0]?.value;
  await waitFor(() =>
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((query) => query.state.fetchStatus === 'idle'),
    ).toBe(true),
  );
  expect(screen.getByRole('status').textContent).toBe(t('en', 'invitations.notReady'));
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
