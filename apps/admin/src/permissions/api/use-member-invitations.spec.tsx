import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { useMemberInvitations } from './use-member-invitations';

// الرابط بيتسلّم مرة واحدة: بعد ما الصفحة تقراه من النداء وتعمل reset، ما يبقىش في أي
// mutation cache ولا query cache — ولا بيستخدم مفتاح React (P1-e).
const state = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
}));

vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({
    POST: state.post,
    GET: state.get,
  }),
}));

const LINK = 'http://api.test/v1/auth/reset-password/secret-token';

let lastLink: string | null = null;
let statusLine = '';
let inviteRef: { reset: () => void } | null = null;
const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

function Harness() {
  const { invite } = useMemberInvitations('company-1', 'user-1');
  inviteRef = invite;
  statusLine = `status=${invite.status} isPending=${String(invite.isPending)} isError=${String(invite.isError)} error=${String(invite.error)}`;
  return (
    <button
      type="button"
      onClick={() => {
        lastLink = 'clicked';
        invite.mutate(
          {
            email: 'ahmed@example.test',
            name: 'Ahmed',
            role: 'accountant',
            scope: { type: 'COMPANY', id: 'company-1' },
            email_confirmed: true,
          },
          {
            onSuccess: (result) => {
              lastLink = result.set_password_link;
              invite.reset();
            },
            onError: (error) => {
              lastLink = `error: ${String(error)}`;
            },
          },
        );
      }}
    >
      invite
    </button>
  );
}

it('the one-time link never survives in the mutation or query caches', async () => {
  state.post.mockResolvedValue({ data: { invitation_id: 'inv-1', set_password_link: LINK } });
  state.get.mockResolvedValue({ data: { items: [], next_cursor: null } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'invite' }));
  await waitFor(() => expect(lastLink).not.toBe('clicked'), { timeout: 4000 });
  expect(statusLine).not.toContain('isPending=true');
  expect(lastLink).toBe(LINK);
  // بعد القراءة والـ reset (و gcTime: 0): الرابط مش في أي mutation ولا query — الكاش فاضي منه.
  const mutationPayloads = client
    .getMutationCache()
    .getAll()
    .map((mutation) => JSON.stringify(mutation.state));
  for (const payload of mutationPayloads) expect(payload).not.toContain(LINK);
  expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.state))).not.toContain(
    LINK,
  );
  expect(inviteRef).not.toBeNull();
  inviteRef?.reset();
});
