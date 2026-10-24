import { afterEach, expect, it, vi } from 'vitest';

import { subscribeWithDeadline } from './push-browser';

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeSubscription() {
  const unsubscribe = vi.fn(async () => true);
  return {
    unsubscribe,
    subscription: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/late',
      unsubscribe,
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/late' }),
    },
  };
}

it('unsubscribes a subscription that arrives after its deadline', async () => {
  const { subscription, unsubscribe } = fakeSubscription();
  let arrive: (value: typeof subscription) => void = () => undefined;
  const subscribe = vi.fn(
    () =>
      new Promise<typeof subscription>((resolve) => {
        arrive = resolve;
      }),
  );
  vi.stubGlobal('navigator', {
    serviceWorker: { ready: Promise.resolve({ pushManager: { subscribe } }) },
  });

  const pending = subscribeWithDeadline(new Uint8Array([1]), 10);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(await pending).toBeNull();

  arrive(subscription);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it('keeps a late subscription when a newer attempt started', async () => {
  const { subscription, unsubscribe } = fakeSubscription();
  const resolvers: ((value: typeof subscription) => void)[] = [];
  const subscribe = vi.fn(
    () =>
      new Promise<typeof subscription>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  vi.stubGlobal('navigator', {
    serviceWorker: { ready: Promise.resolve({ pushManager: { subscribe } }) },
  });

  const first = subscribeWithDeadline(new Uint8Array([1]), 10);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(await first).toBeNull();

  void subscribeWithDeadline(new Uint8Array([2]), 100);
  resolvers[0]?.(subscription);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(unsubscribe).not.toHaveBeenCalled();
});

it('returns null when the subscribe fails before the deadline', async () => {
  const subscribe = vi.fn(async () => {
    throw new Error('SYNTHETIC_SUBSCRIBE_FAILURE');
  });
  vi.stubGlobal('navigator', {
    serviceWorker: { ready: Promise.resolve({ pushManager: { subscribe } }) },
  });

  expect(await subscribeWithDeadline(new Uint8Array([1]), 100)).toBeNull();
});
