import { beforeEach, expect, it, vi } from 'vitest';
import { createOtpSender } from './bullmq-otp-sender.ts';

const resources = vi.hoisted(() => ({
  connection: { status: 'ready', on: vi.fn(), ping: vi.fn(), get: vi.fn(), disconnect: vi.fn() },
  queue: { add: vi.fn(), close: vi.fn(), waitUntilReady: vi.fn() },
  redisOptions: vi.fn(),
  queueOptions: vi.fn(),
}));
vi.mock('ioredis', () => ({
  Redis: vi.fn(function (_url: string, options: unknown) {
    resources.redisOptions(options);
    return resources.connection;
  }),
}));
vi.mock('bullmq', () => ({
  Queue: vi.fn(function (name: string, options: unknown) {
    resources.queueOptions(name, options);
    return resources.queue;
  }),
}));
const ids = {
  challengeId: '00000000-0000-7000-8000-000000000001',
  attemptId: '00000000-0000-7000-8000-000000000002',
};
beforeEach(() => {
  vi.clearAllMocks();
  resources.connection.status = 'ready';
  resources.queue.add.mockResolvedValue({});
  resources.queue.close.mockResolvedValue(undefined);
});

it('enqueues only ids with one attempt, a stable identity and no offline transport replay', async () => {
  const transport = createOtpSender('redis://synthetic.invalid');
  await transport.sender.enqueue(ids, new Date(Date.now() + 200));
  expect(resources.redisOptions).toHaveBeenCalledWith(
    expect.objectContaining({
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      commandTimeout: 30,
    }),
  );
  expect(resources.queue.add).toHaveBeenCalledWith(
    'staff-otp',
    { challenge_id: ids.challengeId, attempt_id: ids.attemptId },
    expect.objectContaining({
      attempts: 1,
      jobId: `staff-otp-${ids.challengeId}-${ids.attemptId}`,
      removeOnComplete: true,
      removeOnFail: true,
    }),
  );
});

it('a job created despite lost acknowledgment drains the producer and returns only finite uncertainty', async () => {
  const durableJobs: unknown[] = [];
  resources.queue.add.mockImplementationOnce(async (_name, data) => {
    durableJobs.push(data);
    throw new Error('SYNTHETIC_LOST_ACKNOWLEDGMENT');
  });
  let finishClose: () => void = () => undefined;
  resources.queue.close.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishClose = resolve;
      }),
  );
  const transport = createOtpSender('redis://synthetic.invalid');
  let completed = false;
  const operation = transport.sender.enqueue(ids, new Date(Date.now() + 200)).catch((error) => {
    completed = true;
    return error;
  });
  await vi.waitFor(() => expect(resources.queue.close).toHaveBeenCalledOnce());
  expect(completed).toBe(false);
  expect(resources.connection.disconnect).toHaveBeenCalledOnce();
  finishClose();
  expect((await operation).message).toBe('OTP_ENQUEUE_UNKNOWN');
  expect(durableJobs).toEqual([{ challenge_id: ids.challengeId, attempt_id: ids.attemptId }]);
  expect(resources.queue.add).toHaveBeenCalledOnce();
});

it('a late deadline or unavailable connection never begins enqueue', async () => {
  const transport = createOtpSender('redis://synthetic.invalid');
  await expect(transport.sender.enqueue(ids, new Date(Date.now() + 20))).rejects.toThrow(
    'OTP_ENQUEUE_UNAVAILABLE',
  );
  resources.connection.status = 'end';
  await expect(transport.sender.enqueue(ids, new Date(Date.now() + 200))).rejects.toThrow(
    'OTP_ENQUEUE_UNAVAILABLE',
  );
  expect(resources.queue.add).not.toHaveBeenCalled();
});

it('recreates transport for a later request without replaying the uncertain job', async () => {
  const transport = createOtpSender('redis://synthetic.invalid');
  resources.queue.add.mockRejectedValueOnce(new Error('SYNTHETIC_ABORT'));
  await expect(transport.sender.enqueue(ids, new Date(Date.now() + 200))).rejects.toThrow(
    'OTP_ENQUEUE_UNKNOWN',
  );
  await transport.ready();
  expect(resources.redisOptions).toHaveBeenCalledTimes(2);
  expect(resources.queueOptions).toHaveBeenCalledTimes(2);
  expect(resources.queue.add).toHaveBeenCalledOnce();
  const next = {
    challengeId: '00000000-0000-7000-8000-000000000003',
    attemptId: '00000000-0000-7000-8000-000000000004',
  };
  await transport.sender.enqueue(next, new Date(Date.now() + 200));
  expect(resources.queue.add).toHaveBeenCalledTimes(2);
  expect(resources.queue.add.mock.calls[1]?.[1]).toEqual({
    challenge_id: next.challengeId,
    attempt_id: next.attemptId,
  });
  await transport.close();
  await expect(transport.ready()).rejects.toThrow('OTP_ENQUEUE_UNAVAILABLE');
});

it('a failed queue cleanup does not permanently poison later transport readiness', async () => {
  const transport = createOtpSender('redis://synthetic.invalid');
  resources.queue.add.mockRejectedValueOnce(new Error('SYNTHETIC_ABORT'));
  resources.queue.close.mockRejectedValueOnce(new Error('SYNTHETIC_CLOSE_FAILED'));
  await expect(transport.sender.enqueue(ids, new Date(Date.now() + 200))).rejects.toThrow();
  await transport.ready();
  expect(resources.redisOptions).toHaveBeenCalledTimes(2);
  expect(resources.queue.add).toHaveBeenCalledOnce();
  await transport.close();
});
