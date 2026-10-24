import { afterEach, expect, it, vi } from 'vitest';

import { subscribeWithDeadline } from './push-browser';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('unsubscribes a subscription that arrives after its deadline', async () => {
  const unsubscribe = vi.fn(async () => true);
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/late',
    unsubscribe,
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/late' }),
  };
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
