import { createDatabase, type ClaimedEvent, type Database, type Tx } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  COMMISSION_LINE_IDS,
  COMMISSION_LINE_TENANTS,
  commissionLineEvent,
  seedCommissionLineTenants,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import type { OutboxConsumer } from '../../../outbox/consumer.ts';
import {
  onCommissionInputEvent,
  type CommissionInputUseCases,
} from '../events/handlers/on-commission-input-event.handler.ts';
import { createCommissionLineProjectionScope } from '../persistence/commission-line-projection.scope.ts';
import { fakeBusinessTimeZone } from './commission-line-projection-time-zone.ts';
import { ProjectServiceLines } from '../use-cases/project-service-lines/project-service-lines.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let deliver: (event: ClaimedEvent) => Promise<unknown>;
const ids = systemUuidV7();
const { A } = COMMISSION_LINE_TENANTS;
const businessTimeZone = fakeBusinessTimeZone(A.business);
const clock = { now: () => new Date('2026-12-05T09:00:00Z') };
const eventTypes = ['ServiceSessionRecorded', 'ServiceSessionLinesAdded', 'ServiceLineChanged'];

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  const consumer = createTestCommissionInputsConsumer({
    ids,
    clock,
    businessTimeZone,
  });
  deliver = createDeliverer(db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

beforeEach(async () => {
  await owner`DELETE FROM commission_lines`;
  await owner`DELETE FROM commission_line_heads`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
});

const event = (
  type: 'ServiceSessionRecorded' | 'ServiceSessionLinesAdded' | 'ServiceLineChanged',
  row: Record<string, unknown> = {},
) => commissionLineEvent(A, ids, type, row);
const projection = async () => ({
  heads: await owner`SELECT * FROM commission_line_heads ORDER BY line_id`,
  lines: await owner`SELECT * FROM commission_lines ORDER BY line_id,employee_id`,
});

function seededPermutations(events: readonly ClaimedEvent[]): ClaimedEvent[][] {
  let state = 501;
  const random = () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
  return Array.from({ length: 6 }, () => {
    const shuffled = [...events];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      const displaced = shuffled[index] as ClaimedEvent;
      shuffled[index] = shuffled[other] as ClaimedEvent;
      shuffled[other] = displaced;
    }
    return shuffled;
  });
}

it('CM-21 duplicate, reordered and replayed deliveries converge to the ordered projection', async () => {
  const recorded = event('ServiceSessionRecorded');
  const edited = event('ServiceLineChanged', {
    revision: 2, net: '12.345', previousNet: '10.001', changeKind: 'PRICE_DISCOUNT_EDIT',
  });
  const performers = event('ServiceLineChanged', {
    revision: 3,
    changeKind: 'PERFORMERS_CHANGE',
    performers: [
      { employee_id: COMMISSION_LINE_IDS.secondEmployee, share_bps: 7000 },
      { employee_id: COMMISSION_LINE_IDS.thirdEmployee, share_bps: 3000 },
    ],
  });
  const sequence = [recorded, edited, performers, { ...edited }, { ...recorded }];
  for (const claimed of sequence) await deliver(claimed);
  const expected = await projection();
  for (const permutation of seededPermutations(sequence)) {
    await owner`DELETE FROM commission_lines`;
    await owner`DELETE FROM commission_line_heads`;
    await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
    for (const claimed of permutation) await deliver(claimed);
    expect(await projection()).toEqual(expected);
  }
});

it('CM-22a a failure after replacement rolls back rows and mark, then redelivery projects once', async () => {
  const failing: OutboxConsumer = {
    id: 'commissions.project-inputs',
    eventTypes,
    handle: async (tx: Tx, claimed: ClaimedEvent) => {
      const scope = createCommissionLineProjectionScope(tx, businessTimeZone);
      const failingScope = {
        ...scope,
        reopenReviewed: async () => {
          throw new Error('injected post-projection failure');
        },
      };
      const unusedUseCase = {
        execute: async () => {
          throw new Error('unused in lines test');
        },
      } as unknown as CommissionInputUseCases['tips'] & CommissionInputUseCases['salary'];
      await onCommissionInputEvent(
        {
          lines: new ProjectServiceLines(failingScope, clock, ids),
          tips: unusedUseCase,
          salary: unusedUseCase,
        },
        claimed,
      );
    },
  };
  const failingDelivery = createDeliverer(db, [failing], createLogger('silent'), {
    knownEventTypes: eventTypes,
  });
  const recorded = event('ServiceSessionRecorded');
  expect(await failingDelivery(recorded)).toMatchObject({ delivered: false });
  expect(await owner`SELECT line_id FROM commission_line_heads`).toEqual([]);
  expect(await owner`SELECT line_id FROM commission_lines`).toEqual([]);
  expect(await owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`).toEqual([]);
  expect(await deliver(recorded)).toEqual({ delivered: true });
  expect(await owner`SELECT line_id FROM commission_line_heads`).toHaveLength(1);
  expect(await owner`SELECT line_id FROM commission_lines`).toHaveLength(1);
  expect(await owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`).toHaveLength(1);
});
