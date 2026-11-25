import type { ClaimedEvent, Database, DeliveryOutcome, Tx } from '@pospay/db';
import { createLogger } from '@pospay/observability';
import { describe, expect, it, vi } from 'vitest';

import {
  createCommissionReminderDelivery,
  createCommissionReminderScheduleConsumer,
  type CommissionReminderSchedule,
} from '../../modules/commissions/index.ts';
import { createDeliverer } from '../deliver.ts';

const COMPANY = '01990000-0000-7000-8000-0000000000a0';
const event = (eventType: string): ClaimedEvent => ({
  companyId: COMPANY,
  id: '01990000-0000-7000-8000-000000000001',
  aggregateType: 'company',
  aggregateId: COMPANY,
  eventType,
  payload: {},
  attempt: 1,
});

/** قاعدة وهمية بتسجّل كل علامة استهلاك اتكتبت (insert … returning) بترتيبها مع تسجيل Redis. */
const harness = (register: CommissionReminderSchedule['register']) => {
  const trail: string[] = [];
  const tx = {
    execute: async () => {
      trail.push('consumed-mark');
      return [{ first: 1 }];
    },
  } as unknown as Tx;
  const app: Pick<Database, 'withTenant'> = { withTenant: async (_company, fn) => fn(tx) };
  const schedule = {
    register: vi.fn(async (companyId: string) => {
      trail.push('redis-register');
      return register(companyId);
    }),
  } as unknown as CommissionReminderSchedule;
  const logger = createLogger('silent');
  const deliverer = createDeliverer(app, [createCommissionReminderScheduleConsumer()], logger, {
    knownEventTypes: ['CompanyCreated', 'ServiceLineChanged'],
  });
  const delivery = createCommissionReminderDelivery<ClaimedEvent, DeliveryOutcome>(
    schedule,
    logger,
  );
  return { trail, schedule, run: (e: ClaimedEvent) => delivery(e, deliverer) };
};

describe('commissions.reminder-schedule consumer', () => {
  it('is registered for CompanyCreated only, with the ADR-0061 consumer id', () => {
    const consumer = createCommissionReminderScheduleConsumer();
    expect(consumer).toMatchObject({
      id: 'commissions.reminder-schedule',
      eventTypes: ['CompanyCreated'],
    });
  });

  it('writes the consumed mark only after the Redis registration succeeded (CM-57b)', async () => {
    const { trail, run } = harness(async () => ({ registered: true }));
    expect(await run(event('CompanyCreated'))).toEqual({ delivered: true });
    expect(trail).toEqual(['redis-register', 'consumed-mark']);
  });

  it('returns a retryable failure with no consumed mark when Redis registration fails', async () => {
    const { trail, run } = harness(async () => ({ registered: false, error: 'REDIS_DOWN' }));
    expect(await run(event('CompanyCreated'))).toEqual({
      delivered: false,
      error: 'REDIS_DOWN',
      retryInMs: 2000,
    });
    expect(trail).toEqual(['redis-register']);
  });

  it('repairs the schedule on a commission input event without blocking its projection', async () => {
    const { trail, run } = harness(async () => ({ registered: false, error: 'REDIS_DOWN' }));
    const outcome = await run(event('ServiceLineChanged'));
    expect(trail).toEqual(['redis-register']);
    expect(outcome).toEqual({ delivered: true });
  });
});
