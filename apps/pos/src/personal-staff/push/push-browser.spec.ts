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

function stubSubscribe(subscribe: (key: Uint8Array) => Promise<unknown>): void {
  vi.stubGlobal('navigator', {
    serviceWorker: { ready: Promise.resolve({ pushManager: { subscribe } }) },
  });
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

it('unsubscribes a subscription that arrives after its deadline', async () => {
  const { subscription, unsubscribe } = fakeSubscription();
  let arrive: (value: typeof subscription) => void = () => undefined;
  stubSubscribe(
    () =>
      new Promise<typeof subscription>((resolve) => {
        arrive = resolve;
      }),
  );

  const pending = subscribeWithDeadline(new Uint8Array([1]), 10);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(await pending).toBeNull();

  arrive(subscription);
  await tick();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it('unsubscribes a late subscription when the newer attempt failed', async () => {
  const { subscription, unsubscribe } = fakeSubscription();
  const resolvers: ((value: typeof subscription) => void)[] = [];
  let calls = 0;
  stubSubscribe(() => {
    calls += 1;
    if (calls > 1) return Promise.reject(new Error('SYNTHETIC_SUBSCRIBE_FAILURE'));
    return new Promise<typeof subscription>((resolve) => {
      resolvers.push(resolve);
    });
  });

  const first = subscribeWithDeadline(new Uint8Array([1]), 10);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(await first).toBeNull();

  expect(await subscribeWithDeadline(new Uint8Array([2]), 100)).toBeNull();
  resolvers[0]?.(subscription);
  await tick();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it('keeps a late subscription when a newer attempt succeeded', async () => {
  const { subscription, unsubscribe } = fakeSubscription();
  const resolvers: ((value: typeof subscription) => void)[] = [];
  stubSubscribe(
    () =>
      new Promise<typeof subscription>((resolve) => {
        resolvers.push(resolve);
      }),
  );

  const first = subscribeWithDeadline(new Uint8Array([1]), 10);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(await first).toBeNull();

  const second = subscribeWithDeadline(new Uint8Array([2]), 100);
  await tick();
  resolvers[1]?.(subscription);
  expect(await second).not.toBeNull();

  resolvers[0]?.(subscription);
  await tick();
  expect(unsubscribe).not.toHaveBeenCalled();
});

it('returns null when the subscribe fails before the deadline', async () => {
  stubSubscribe(() => Promise.reject(new Error('SYNTHETIC_SUBSCRIBE_FAILURE')));

  expect(await subscribeWithDeadline(new Uint8Array([1]), 100)).toBeNull();
});
