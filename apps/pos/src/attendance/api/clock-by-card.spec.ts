import { expect, it, vi } from 'vitest';
import { clockByCard } from './clock-by-card';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ staffApiClient: () => ({ POST: post }) }));

it.each([
  [401, 'signed-out'],
  [403, 'refused'],
  [400, 'invalid'],
  [404, 'invalid'],
  [422, 'invalid'],
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

it('maps a conflict and an outage away from a bad card, and shows a simple wait', async () => {
  const signal = new AbortController().signal;
  post.mockResolvedValue({ response: new Response(null, { status: 409 }), error: {} });
  expect(await clockByCard('SYNTHETIC-CARD', signal)).toEqual({ kind: 'unavailable' });
  post.mockResolvedValue({ response: new Response(null, { status: 503 }), error: {} });
  expect(await clockByCard('SYNTHETIC-CARD', signal)).toEqual({ kind: 'unavailable' });
  post.mockResolvedValue({
    response: new Response(null, { status: 429, headers: { 'retry-after': 'Wed, 21 Oct 2015 07:28:00 GMT' } }),
    error: {},
  });
  expect(await clockByCard('SYNTHETIC-CARD', signal)).toEqual({ kind: 'limited' });
  post.mockResolvedValue({
    response: new Response(null, { status: 429, headers: { 'retry-after': '42' } }),
    error: {},
  });
  expect(await clockByCard('SYNTHETIC-CARD', signal)).toEqual({ kind: 'limited', retryAfter: 42 });
});
