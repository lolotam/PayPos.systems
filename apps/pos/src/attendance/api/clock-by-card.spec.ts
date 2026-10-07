import { expect, it, vi } from 'vitest';
import { clockByCard } from './clock-by-card';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ staffApiClient: () => ({ POST: post }) }));

it.each([
  [401, 'signed-out'],
  [403, 'refused'],
  [404, 'invalid'],
] as const)(
  'distinguishes operator/device rejection %s from a card rejection',
  async (status, kind) => {
    post.mockResolvedValue({ response: new Response(null, { status }), error: {} });
    const signal = new AbortController().signal;
    expect(await clockByCard('SYNTHETIC-CARD', signal)).toEqual({ kind });
    expect(post).toHaveBeenCalledWith(
      '/v1/devices/me/clock-by-card',
      expect.objectContaining({ signal, cache: 'no-store' }),
    );
  },
);
