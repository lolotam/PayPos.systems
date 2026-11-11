import {
  appendServiceSessionLinesInput,
  appendServiceSessionLinesResponse,
  cancelServiceLineInput,
  cancelServiceLineResponseFull,
  changeLinePerformersInput,
  changeLinePerformersResponseFull,
  editServiceLineInput,
  editServiceLineResponseFull,
  recordServiceSessionInput,
  recordServiceSessionResponse,
  serviceLineChanged,
  serviceSessionLinesAdded,
  serviceSessionRecorded,
} from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';
import { createLogger } from '@pospay/observability';
import { sql } from 'drizzle-orm';
import { expect, inject } from 'vitest';
import { editFixture, type EditFixture } from '../../test/service-line-edit.fixture.ts';
import { AT, ids, must } from '../../test/service-session.fixture.ts';
import { createCommissionInputsConsumer } from '../../../worker/src/modules/commissions/index.ts';
import { businessCalendar, businessTimeZone } from '../../../worker/src/modules/tenancy/index.ts';
import { createDeliverer } from '../../../worker/src/outbox/deliver.ts';

export { ids, must, createDeliverer, createLogger };
export async function journeyFixture() {
  const base: { fixture?: EditFixture } = {};
  const clock = { now: () => base.fixture?.clock.now() ?? AT };
  const f = await editFixture({ ordersClock: clock });
  base.fixture = f;
  try {
    await f.db.ping();
    const { runId } = inject('pg');
    const databaseRows = await f.h.owner<{ name: string }[]>`SELECT current_database() AS name`;
    const databaseName = must(databaseRows[0]).name;
    expect(databaseName.startsWith(`pospay_test_${runId}_`)).toBe(true);
    const consumer = createCommissionInputsConsumer({
      ids,
      clock,
      businessTimeZone,
      employeeBusiness: async () => null,
      businessCalendar,
    });
    const deliver = createDeliverer(f.db, [consumer], createLogger('silent'), {
      knownEventTypes: consumer.eventTypes,
    });
    return { ...f, runId, databaseName, consumer, deliver, clock, close: () => closeFixture(f) };
  } catch (error) {
    try {
      await closeFixture(f);
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'Journey setup and cleanup failed', {
        cause: cleanup,
      });
    }
    throw error;
  }
}
export type JourneyFixture = Awaited<ReturnType<typeof journeyFixture>>;
async function closeFixture(f: EditFixture) {
  const failures: unknown[] = [];
  try {
    await f.db.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    await f.h.close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) throw new AggregateError(failures, 'Journey fixture cleanup failed');
}
type Send = JourneyFixture['h']['send'];
export interface SavedRequest {
  method: Parameters<Send>[0];
  url: string;
  options: Parameters<Send>[2];
  response: Awaited<ReturnType<Send>>;
}
async function save(
  f: JourneyFixture,
  method: SavedRequest['method'],
  url: string,
  body: object,
  status: number,
) {
  const options = { cookie: f.ownerCookie, company: f.company, key: ids.newId(), body };
  const response = await f.h.send(method, url, options);
  expect(response.status, response.text).toBe(status);
  return { method, url, options, response };
}
export async function recordJourney(f: JourneyFixture) {
  // عكس ترتيب الهويات في الطلب يثبت أن فلس التعادل يخص أصغر employee_id، لا أول منفّذ في الإدخال.
  const [low, high] = f.employees.slice(0, 2).sort();
  const shared = {
    ...f.line(must(f.services[0]), '25.001'),
    performers: [
      { employee_id: must(high), share_bps: 5000 },
      { employee_id: must(low), share_bps: 5000 },
    ],
  };
  const body = recordServiceSessionInput.parse({
    customer_id: f.customer,
    occurred_at: '2026-10-14T21:30:00.000Z',
    lines: [shared, f.line(must(f.services[1]), '7.125')],
  });
  const recorded = await save(f, 'POST', f.base, body, 201);
  const session = recordServiceSessionResponse.parse(recorded.response.body).session;
  const sharedLine = must(session.lines.find((line) => line.service_id === f.services[0]));
  const pctLine = must(session.lines.find((line) => line.service_id === f.services[1]));
  return { session, sharedLine, pctLine, low: must(low), high: must(high), requests: [recorded] };
}
export type Recording = Awaited<ReturnType<typeof recordJourney>>;
export async function appendJourney(f: JourneyFixture, journey: Recording) {
  const body = appendServiceSessionLinesInput.parse({
    lines: [f.line(must(f.services[2]), '0.000'), f.line(must(f.services[3]), '15.000')],
  });
  const request = await save(f, 'POST', `${f.base}/${journey.session.id}/lines`, body, 201);
  const appended = appendServiceSessionLinesResponse.parse(request.response.body);
  journey.requests.push(request);
  return appended;
}
export async function changeJourney(f: JourneyFixture, journey: Recording) {
  const url = `${f.base}/${journey.session.id}/lines/${journey.sharedLine.id}`;
  const edit = await save(
    f,
    'PATCH',
    url,
    editServiceLineInput.parse({
      price: '27.001',
      discount: { kind: 'AMOUNT', amount: '0.000' },
      expected_revision: 1,
      reason: 'Synthetic journey edit',
    }),
    200,
  );
  const changed = await save(
    f,
    'PUT',
    `${url}/performers`,
    changeLinePerformersInput.parse({
      performers: [{ employee_id: must(f.employees[2]), share_bps: 10000 }],
      expected_revision: 2,
      reason: 'Synthetic journey reassignment',
    }),
    200,
  );
  const cancel = await save(
    f,
    'POST',
    `${url}/cancellation`,
    cancelServiceLineInput.parse({
      expected_revision: 3,
      reason: 'Synthetic journey cancellation',
    }),
    200,
  );
  journey.requests.push(edit, changed, cancel);
  return [
    editServiceLineResponseFull.parse(edit.response.body).line,
    changeLinePerformersResponseFull.parse(changed.response.body).line,
    cancelServiceLineResponseFull.parse(cancel.response.body).line,
  ];
}
export async function savedEvents(f: JourneyFixture, sessionId: string): Promise<ClaimedEvent[]> {
  const rows = await f.h.owner<ClaimedEvent[]>`
    SELECT company_id AS "companyId", id, aggregate_type AS "aggregateType", aggregate_id AS "aggregateId",
      event_type AS "eventType", payload, 1 AS attempt FROM outbox
    WHERE company_id=${f.company} AND aggregate_id=${sessionId}
      AND event_type IN ('ServiceSessionRecorded','ServiceSessionLinesAdded','ServiceLineChanged') ORDER BY seq`;
  for (const event of rows) {
    const schema =
      event.eventType === 'ServiceSessionRecorded'
        ? serviceSessionRecorded
        : event.eventType === 'ServiceSessionLinesAdded'
          ? serviceSessionLinesAdded
          : serviceLineChanged;
    // التحقق لا يستبدل payload: كائن الصف الأصلي نفسه هو اللي يدخل createDeliverer.
    schema.parse(event.payload);
  }
  return [...rows];
}
export async function projection(f: JourneyFixture) {
  return f.db.withTenant(f.company, async (tx) => ({
    heads: [
      ...(await tx.execute(
        sql`SELECT * FROM commission_line_heads WHERE company_id=${f.company} ORDER BY line_id`,
      )),
    ],
    rows: [
      ...(await tx.execute(
        sql`SELECT * FROM commission_lines WHERE company_id=${f.company} ORDER BY line_id,employee_id`,
      )),
    ],
    marks: [
      ...(await tx.execute(sql`SELECT event_id,consumer_id FROM consumed_events
      WHERE company_id=${f.company} AND consumer_id=${f.consumer.id} ORDER BY event_id`)),
    ],
  }));
}
export async function producerState(f: JourneyFixture, sessionId: string) {
  return f.db.withTenant(f.company, async (tx) => ({
    events: [
      ...(await f.h.owner`SELECT * FROM outbox
        WHERE company_id=${f.company} AND aggregate_id=${sessionId} ORDER BY seq`),
    ],
    lines: [
      ...(await tx.execute(
        sql`SELECT * FROM service_lines WHERE company_id=${f.company} AND session_id=${sessionId} ORDER BY id`,
      )),
    ],
    edits: [
      ...(await tx.execute(
        sql`SELECT * FROM service_line_edits WHERE company_id=${f.company} ORDER BY line_id,revision`,
      )),
    ],
    performers: [
      ...(await tx.execute(
        sql`SELECT * FROM service_line_performer_changes WHERE company_id=${f.company} ORDER BY line_id,revision`,
      )),
    ],
    cancellations: [
      ...(await tx.execute(
        sql`SELECT * FROM service_line_cancellations WHERE company_id=${f.company} ORDER BY line_id,revision`,
      )),
    ],
  }));
}
export async function consume(f: JourneyFixture, events: readonly ClaimedEvent[]) {
  for (const event of events) expect(await f.deliver(event)).toEqual({ delivered: true });
}
export async function completeJourney(f: JourneyFixture) {
  const journey = await recordJourney(f);
  const appended = await appendJourney(f, journey);
  const changes = await changeJourney(f, journey);
  const events = await savedEvents(f, journey.session.id);
  expect(events).toHaveLength(5);
  return { ...journey, appended, changes, events };
}

export function expectedRow(
  fixture: JourneyFixture,
  journey: Recording,
  line: Recording['sharedLine'],
  employee: string,
) {
  const rule = line.rule_snapshot;
  const shared = line.id === journey.sharedLine.id;
  return {
    company_id: fixture.company,
    business_id: fixture.business,
    line_id: line.id,
    branch_id: fixture.branch,
    employee_id: employee,
    service_id: line.service_id,
    occurred_at: new Date('2026-10-14T21:30:00.000Z'),
    recorded_at: fixture.clock.now(),
    business_date: '2026-10-15',
    period: '2026-10',
    net: line.net,
    net_share: shared ? (employee === journey.low ? '12.501' : '12.500') : line.net,
    share_bps: shared ? 5000 : 10000,
    rule_kind: rule.kind,
    rule_pct_bps: rule.kind === 'PCT' ? rule.value : null,
    rule_fixed_amount: rule.kind === 'FIXED' ? rule.value : null,
    counts: line.counts_snapshot,
    status: 'ACTIVE',
  };
}

export function assertLineSnapshots(lines: readonly Recording['sharedLine'][]) {
  expect(lines.map((line) => line.rule_snapshot.kind)).toEqual([
    'FOLLOW_PLAN',
    'PCT',
    'ZERO',
    'FIXED',
  ]);
  expect(lines.map((line) => line.rule_snapshot)).toEqual([
    { kind: 'FOLLOW_PLAN' },
    { kind: 'PCT', value: 1000 },
    { kind: 'ZERO' },
    { kind: 'FIXED', value: '2.500' },
  ]);
  expect(lines.map((line) => line.counts_snapshot)).toEqual([true, false, true, true]);
}
