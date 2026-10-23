import type { ClaimedEvent } from '@pospay/db';
import {
  FakePushChannel,
  generateVapidKeyPair,
  vapidKeyId,
  WebPushChannel,
} from '@pospay/notifications';
import { createLogger } from '@pospay/observability';
import type { Queue } from 'bullmq';
import { expect, it } from 'vitest';

import {
  bindPushChannel,
  startPushCapability,
  type PushCapability,
  type PushQueue,
  type PushStartupOptions,
} from '../push-startup.module.ts';

const pair = generateVapidKeyPair();
const other = generateVapidKeyPair();
const ENV = {
  VAPID_PUBLIC_KEY: pair.publicKey,
  VAPID_PRIVATE_KEY: pair.privateKey,
  VAPID_SUBJECT: 'mailto:ops@pospay.systems',
};
const CONFIGURATION = {
  publicKey: pair.publicKey,
  privateKey: pair.privateKey,
  subject: ENV.VAPID_SUBJECT,
  keyId: vapidKeyId(pair.publicKey),
};

const lines: string[] = [];
const logger = createLogger('info', {
  events: ['staff push capability'],
  destination: {
    write: (line: string) => {
      lines.push(line);
    },
  },
});

const options = (env: NodeJS.ProcessEnv): PushStartupOptions => ({
  env,
  production: false,
  logger,
  clock: { now: () => new Date('2026-10-23T10:00:00Z') },
  ids: { newId: () => '01920000-0000-7000-8000-0000000000b1' },
  database: { withTenant: async () => undefined } as unknown as PushStartupOptions['database'],
  redisUrl: 'redis://127.0.0.1:6379',
  redis: { eval: async () => 1 } as unknown as PushStartupOptions['redis'],
});

const queue = (over: Partial<PushQueue> = {}): PushQueue => ({
  queue: { add: async () => ({ id: 'job' }) } as unknown as Pick<Queue, 'add'>,
  ready: async () => undefined,
  stop: async () => undefined,
  close: async () => undefined,
  ...over,
});

const claimed = (over: Partial<ClaimedEvent> = {}): ClaimedEvent => ({
  id: '01920000-0000-7000-8000-0000000000c1',
  companyId: '01920000-0000-7000-8000-0000000000a1',
  aggregateType: 'push_attempt',
  aggregateId: '01920000-0000-7000-8000-0000000000b1',
  eventType: 'PushSendAuthorized',
  payload: {
    company_id: '01920000-0000-7000-8000-0000000000a1',
    attempt_id: '01920000-0000-7000-8000-0000000000b1',
  },
  attempt: 1,
  ...over,
});

it('an unconfigured environment stays disabled and keeps the push authorizations in the outbox', async () => {
  lines.length = 0;
  const capability = await startPushCapability(options({}));
  expect(capability.enabled).toBe(false);
  const text = lines.join('');
  expect(text).toContain('DISABLED');
  expect(text).toContain('NOT_CONFIGURED');
  let handed = 0;
  const transport = capability.transport(async () => {
    handed += 1;
    return { delivered: true as const };
  });
  expect(await transport(claimed({ eventType: 'NotificationFailed' }))).toEqual({
    delivered: true,
  });
  expect(handed).toBe(1);
  const pushEvent = await transport(claimed());
  expect(pushEvent).toMatchObject({ delivered: false, error: 'PUSH_DISABLED' });
  if (!pushEvent.delivered) expect(pushEvent.retryInMs).toBe(5000);
  expect(handed).toBe(1);
});

it('a pair that does not match stays disabled and the log carries no key', async () => {
  lines.length = 0;
  const capability = await startPushCapability(
    options({ ...ENV, VAPID_PRIVATE_KEY: other.privateKey }),
  );
  expect(capability.enabled).toBe(false);
  const text = lines.join('');
  expect(text).toContain('KEY_MISMATCH');
  expect(text).not.toContain(pair.privateKey);
  expect(text).not.toContain(pair.publicKey);
});

it('a ready pair enables the capability and logs the key id', async () => {
  lines.length = 0;
  let starts = 0;
  const capability = await startPushCapability(options(ENV), async () => {
    starts += 1;
    return queue();
  });
  expect(capability.enabled).toBe(true);
  expect(starts).toBe(1);
  const text = lines.join('');
  expect(text).toContain('READY');
  expect(text).toContain(CONFIGURATION.keyId);
  expect(text).not.toContain(pair.privateKey);
});

it('a queue that cannot get ready disables the capability and closes what was opened', async () => {
  lines.length = 0;
  let closed = 0;
  const capability = await startPushCapability(options(ENV), async () =>
    queue({
      ready: async () => {
        throw new Error('redis connection refused');
      },
      close: async () => {
        closed += 1;
      },
    }),
  );
  expect(capability.enabled).toBe(false);
  expect(closed).toBe(1);
  const text = lines.join('');
  expect(text).toContain('UNAVAILABLE');
  expect(text).toContain('SETUP_FAILED');
});

it('a disabled capability stops and closes without touching anything', async () => {
  const capability: PushCapability = await startPushCapability(options({}));
  await capability.stop();
  await capability.close(true);
  expect(capability.enabled).toBe(false);
});

it('binds a real channel in production even when the mode is fake', () => {
  const channel = bindPushChannel(
    { NOTIFICATIONS_MODE: 'fake' },
    true,
    { now: () => new Date('2026-10-23T10:00:00Z') },
    CONFIGURATION,
  );
  expect(channel).toBeInstanceOf(WebPushChannel);
});

it('binds the fake channel outside production when the mode is fake', () => {
  const channel = bindPushChannel(
    { NOTIFICATIONS_MODE: 'fake' },
    false,
    { now: () => new Date('2026-10-23T10:00:00Z') },
    CONFIGURATION,
  );
  expect(channel).toBeInstanceOf(FakePushChannel);
});

it('binds a real channel outside production without a mode', () => {
  const channel = bindPushChannel(
    {},
    false,
    { now: () => new Date('2026-10-23T10:00:00Z') },
    CONFIGURATION,
  );
  expect(channel).toBeInstanceOf(WebPushChannel);
});
