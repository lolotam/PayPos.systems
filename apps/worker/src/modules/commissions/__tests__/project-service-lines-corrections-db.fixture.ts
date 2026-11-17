import { createDatabase, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach } from 'vitest';

import {
  COMMISSION_LINE_IDS,
  COMMISSION_LINE_TENANTS,
  commissionLineEvent,
  seedCommissionLineTenants,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { insertCommissionPlanVersion } from '../../../../../../packages/db/test/commission-plan-version-fixtures.ts';
import {
  insertCommissionAttachment,
  insertCommissionLine,
  walkCommissionStatement,
} from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import type { OutboxConsumer } from '../../../outbox/consumer.ts';
import type { CommissionInputUseCases } from '../events/handlers/on-commission-input-event.handler.ts';
import { onCommissionInputEvent } from '../events/handlers/on-commission-input-event.handler.ts';
import { createCommissionCorrectionScope } from '../persistence/commission-correction.scope.ts';
import { createCommissionLineProjectionScope } from '../persistence/commission-line-projection.scope.ts';
import { ProjectServiceLines } from '../use-cases/project-service-lines/project-service-lines.ts';
import { fakeBusinessTimeZone } from './commission-line-projection-time-zone.ts';

export const ids = systemUuidV7();
export const { A } = COMMISSION_LINE_TENANTS;
export const SOURCE_PERIOD = '2026-10';
export const TARGET_PERIOD = '2026-11';
export const CURRENT = '2026-12-05T09:00:00Z';
export const FOLLOW_PLAN = { kind: 'FOLLOW_PLAN' } as const;
export const businessTimeZone = fakeBusinessTimeZone(A.business);

let testDb: TestDatabase;
export let owner: postgres.Sql;
export let db: Database;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

beforeEach(async () => {
  await owner`DELETE FROM commission_corrections`;
  await owner`DELETE FROM commission_period_generations`;
  await owner`DELETE FROM commission_statement_attachments`;
  await owner`DELETE FROM commission_statement_lines`;
  await owner`DELETE FROM commission_statements`;
  await owner`DELETE FROM commission_service_overrides`;
  await owner`DELETE FROM commission_plan_versions`;
  await owner`DELETE FROM commission_salaries`;
  await owner`DELETE FROM commission_lines`;
  await owner`DELETE FROM commission_line_heads`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
});

export function consumerWithClock(clock: { now: () => Date }): OutboxConsumer {
  return createTestCommissionInputsConsumer({ ids, clock, businessTimeZone });
}

export function deliverWith(consumer: OutboxConsumer, event: ClaimedEvent) {
  return createDeliverer(db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  })(event);
}

export function deliverAt(now: string, event: ClaimedEvent) {
  return deliverWith(consumerWithClock({ now: () => new Date(now) }), event);
}

export function lineEvent(
  eventType: 'ServiceSessionRecorded' | 'ServiceSessionLinesAdded' | 'ServiceLineChanged',
  row: Record<string, unknown> = {},
): ClaimedEvent {
  return commissionLineEvent(A, ids, eventType, {
    businessDate: `${SOURCE_PERIOD}-15`,
    net: '200.000',
    ruleSnapshot: FOLLOW_PLAN,
    ...row,
  });
}

export function changed(row: Record<string, unknown> = {}): ClaimedEvent {
  return lineEvent('ServiceLineChanged', {
    revision: 2,
    previousNet: '200.000',
    changeKind: 'LINE_CANCELLED',
    ...row,
  });
}

interface ClosedMonthOptions {
  readonly status?: 'APPROVED' | 'PAID';
  readonly employees?: readonly string[];
  readonly ruleSnapshot?: Record<string, unknown>;
  readonly withPlan?: boolean;
  readonly frozenAmount?: string;
}

export async function seedClosedMonth(options: ClosedMonthOptions = {}): Promise<string> {
  const employees = options.employees ?? [A.employee];
  const recorded = lineEvent('ServiceSessionRecorded', {
    ruleSnapshot: options.ruleSnapshot ?? FOLLOW_PLAN,
  });
  const initial = await deliverAt(CURRENT, recorded);
  if (!initial.delivered) throw new Error('the source projection did not deliver');
  const statementId = await walkCommissionStatement(db, {
    tenant: A,
    period: SOURCE_PERIOD,
    ids,
    to: options.status ?? 'APPROVED',
    afterApproved: async (tx, id) => {
      await insertCommissionLine(tx, A, id, ids, {
        kind: 'COMMISSION',
        lineId: COMMISSION_LINE_IDS.lineA,
        sessionId: COMMISSION_LINE_IDS.sessionA,
        serviceId: A.service,
        customerId: A.customer,
        sourceRef: `line:${COMMISSION_LINE_IDS.lineA}`,
        amount: options.frozenAmount ?? '10.000',
        sourceBranchId: A.branch,
        sourceBusinessDate: `${SOURCE_PERIOD}-15`,
        businessDate: `${SOURCE_PERIOD}-15`,
        attachedBranchIds: [A.branch],
      });
      for (const employeeId of employees) {
        await insertCommissionAttachment(tx, A, id, ids, { employeeId });
      }
    },
  });
  for (const employeeId of employees) {
    await owner`INSERT INTO commission_salaries(
      company_id,id,business_id,employee_id,effective_from,amount,revision)
      VALUES(${A.company},${ids.newId()},${A.business},${employeeId},'2026-01-01'::date,'500.000',1)`;
    if (options.withPlan === false) continue;
    await db.withTenant(A.company, async (tx) => {
      await insertCommissionPlanVersion(tx, A, ids, {
        employeeId,
        effectiveFrom: '2026-10-01',
        plan: {
          base: { enabled: true, calc: { kind: 'PCT', bps: 500 } },
          tiers: { enabled: false },
          package_sale: { enabled: false },
        },
      });
    });
  }
  return statementId;
}

export function failingCorrectionsConsumer(): OutboxConsumer {
  const clock = { now: () => new Date(CURRENT) };
  const standard = consumerWithClock(clock);
  return {
    id: standard.id,
    eventTypes: standard.eventTypes,
    handle: async (tx, event) => {
      const corrections = createCommissionCorrectionScope(tx, ids, clock);
      const unused = {
        execute: async () => {
          throw new Error('unused line-only use case');
        },
      } as unknown as CommissionInputUseCases['tips'] & CommissionInputUseCases['salary'];
      await onCommissionInputEvent(
        {
          lines: new ProjectServiceLines(
            createCommissionLineProjectionScope(tx, businessTimeZone),
            clock,
            ids,
            {
              ...corrections,
              insertCorrections: async () => {
                throw new Error('injected correction insert failure');
              },
            },
          ),
          tips: unused,
          salary: unused,
        },
        event,
      );
    },
  };
}

export const corrections = () => owner`SELECT employee_id,source_period,target_period,
  target_statement_id,source_ref,kind,amount,previous_amount,new_amount,generation,event_id
  FROM commission_corrections ORDER BY employee_id,generation,source_ref`;
export const generations = () => owner`SELECT employee_id,period,generation
  FROM commission_period_generations ORDER BY employee_id,period`;
export const marks = () => owner`SELECT event_id FROM consumed_events
  WHERE consumer_id='commissions.project-inputs' ORDER BY event_id`;
export const heads = () => owner`SELECT line_id,revision,status,period
  FROM commission_line_heads ORDER BY line_id`;
export const frozenLines = (statementId: string) => owner`SELECT employee_id,source_ref,kind,
  amount,previous_amount,new_amount,source_period FROM commission_statement_lines
  WHERE statement_id=${statementId} ORDER BY employee_id,source_ref`;
export const statementStatus = (period: string) => owner`SELECT period,status,reviewed_by,
  reviewed_at FROM commission_statements WHERE company_id=${A.company} AND period=${period}`;
