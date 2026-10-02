import { expect, it, vi } from 'vitest';
import { notificationQueue } from '../jobs/notification-queue.ts';

const resource = vi.hoisted(() => ({ disconnect: vi.fn(), close: vi.fn() }));
vi.mock('ioredis', () => ({
  Redis: class {
    on() {}
    disconnect = resource.disconnect;
  },
}));
vi.mock('bullmq', () => ({
  Queue: class {
    close = resource.close;
  },
}));

it('force-close disconnects the owned socket before waiting for a hung BullMQ cleanup', async () => {
  let complete: (() => void) | undefined;
  resource.close.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const queue = notificationQueue(
    'synthetic',
    { host: 'synthetic.invalid', port: 6379, db: 0 },
    vi.fn(),
  );
  const closing = queue.close(true);
  expect(resource.disconnect).toHaveBeenCalledOnce();
  complete?.();
  await closing;
  expect(resource.disconnect).toHaveBeenCalledTimes(2);
});
