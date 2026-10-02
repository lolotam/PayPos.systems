import { randomBytes, randomUUID } from 'node:crypto';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { expect, it, vi } from 'vitest';
import {
  FakeChannel,
  notificationRedisOptions,
  createProviderMessageDigest,
} from '@pospay/notifications';
import { createReservedOtpWorker } from '../jobs/reserved-otp-worker.ts';
import { SendStaffOtp } from '../use-cases/send-staff-otp/send-staff-otp.ts';
import { createOtpChannel } from '../persistence/otp-channel.adapter.ts';
import { redisSendAdmission } from '../persistence/redis-send-admission.ts';
import type { OtpExecution, OtpPending } from '../ports/otp-execution.port.ts';

function execution(rows: Map<string, OtpPending>): OtpExecution {
  return {
    pending: async (id) => rows.get(id) ?? null,
    timeout: async () => 'FAILED',
    claim: async (id) => {
      const row = rows.get(id);
      if (row?.status !== 'PENDING') return false;
      rows.set(id, { ...row, status: 'SENDING' });
      return true;
    },
    materialize: async (id) => {
      const row = rows.get(id);
      return row?.status === 'SENDING'
        ? { phone: '+99900000001', code: String(7).padStart(6, '0'), deadline: row.sendDeadline }
        : null;
    },
    finish: async (id, _attempt, _execution, result) => {
      const row = rows.get(id);
      if (row !== undefined) rows.set(id, { ...row, status: result.status });
    },
    readiness: async () => undefined,
    close: async () => undefined,
  };
}

function useCase(redis: Redis, submitted: number[]) {
  const rows = new Map<string, OtpPending>();
  const now = () => new Date();
  const fake = new FakeChannel(now, {
    beforeSubmission: () => {
      submitted.push(performance.now());
    },
  });
  const capability = { available: () => true, ready: async () => true };
  const channel = createOtpChannel(
    fake,
    {
      names: { ar: 'synthetic_ar', en: 'synthetic_en' },
      components: {
        ar: [{ type: 'body' }, { type: 'button', sub_type: 'url', index: '0' }],
        en: [{ type: 'body' }, { type: 'button', sub_type: 'url', index: '0' }],
      },
    },
    capability,
    createProviderMessageDigest('synthetic'.repeat(8), 'synthetic-h'),
    now,
  );
  const send = new SendStaffOtp(
    execution(rows),
    capability,
    redisSendAdmission(redis, 1000),
    channel,
    { now },
    { newId: randomUUID },
    { pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
  );
  return { rows, send, fake };
}

function jobs(rows: Map<string, OtpPending>, count: number) {
  return Array.from({ length: count }, () => {
    const challengeId = randomUUID(),
      attemptId = randomUUID(),
      createdAt = new Date();
    rows.set(challengeId, {
      id: attemptId,
      challengeId,
      recipientHash: randomBytes(32),
      locale: 'ar',
      providerTemplateName: 'synthetic_ar',
      status: 'PENDING',
      preparationDeadline: new Date(createdAt.getTime() + 200),
      sendDeadline: new Date(createdAt.getTime() + 300000),
    });
    return {
      name: 'staff-otp',
      data: { challenge_id: challengeId, attempt_id: attemptId },
      opts: { attempts: 1, jobId: `otp-${challengeId}-${attemptId}` },
    };
  });
}

function tenantCapacity(connection: ReturnType<typeof notificationRedisOptions>, prefix: string) {
  let release: () => void = () => undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let busy = 0,
    occupied: () => void = () => undefined;
  const full = new Promise<void>((resolve) => {
    occupied = resolve;
  });
  const worker = new Worker(
    'notifications-send',
    async () => {
      busy++;
      if (busy === 8) occupied();
      await blocked;
      busy--;
    },
    { connection, prefix, concurrency: 8 },
  );
  return { worker, full, release, busy: () => busy };
}

function capacityHarness() {
  const password = encodeURIComponent(process.env['REDIS_PASSWORD'] ?? '');
  const url = process.env['REDIS_URL'] ?? `redis://:${password}@127.0.0.1:6379`;
  const prefix = `test-otp-capacity-${randomUUID()}`;
  const connection = notificationRedisOptions(url);
  const redis = new Redis(url, { keyPrefix: `${prefix}:admission:` });
  const submitted: number[] = [],
    f = useCase(redis, submitted);
  const tenant = tenantCapacity(connection, prefix);
  const otp = createReservedOtpWorker(f.send, url, { prefix, onError: vi.fn() });
  const tenantQueue = new Queue('notifications-send', { connection, prefix });
  const queue = new Queue('notifications-otp', { connection, prefix });
  // Forty independently awaited jobs attach one queue-close listener each.
  queue.setMaxListeners(50);
  const events = new QueueEvents('notifications-otp', { connection, prefix });
  return {
    redis,
    f,
    tenant,
    otp,
    tenantQueue,
    queue,
    events,
    submitted,
    close: async () => {
      tenant.release();
      await Promise.all([tenant.worker.close(), otp.close(), events.close()]);
      await Promise.all([
        queue.obliterate({ force: true }),
        tenantQueue.obliterate({ force: true }),
      ]);
      await Promise.all([queue.close(), tenantQueue.close(), redis.quit()]);
    },
  };
}

it('reserved concurrency four submits a 40-recipient pilot within five seconds while all eight tenant slots stay occupied', async () => {
  const h = capacityHarness();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.all([
      h.tenant.worker.waitUntilReady(),
      h.otp.waitUntilReady(),
      h.events.waitUntilReady(),
      h.redis.ping(),
    ]);
    await h.tenantQueue.addBulk(
      Array.from({ length: 32 }, () => ({ name: 'synthetic-tenant', data: {} })),
    );
    await Promise.race([
      h.tenant.full,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('PILOT_CAPACITY_TIMEOUT')), 4000);
      }),
    ]);
    clearTimeout(timer);
    expect(h.tenant.busy()).toBe(8);
    const accepted = performance.now();
    const queued = await h.queue.addBulk(jobs(h.f.rows, 40));
    await Promise.all(queued.map((job) => job.waitUntilFinished(h.events, 5000)));
    expect(h.submitted).toHaveLength(40);
    expect(Math.max(...h.submitted) - accepted).toBeLessThanOrEqual(5000);
    expect(h.tenant.busy()).toBe(8);
    expect(h.otp.opts.concurrency).toBe(4);
    expect(h.otp.opts.maxStalledCount).toBe(0);
    await h.queue.add('staff-otp', queued[0]?.data, { attempts: 1 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.f.fake.calls).toBe(40);
  } finally {
    clearTimeout(timer);
    await h.close();
  }
});
