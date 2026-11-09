import {
  editServiceLineInput,
  editServiceLineResponseFull,
  recordServiceSessionResponse,
  serviceLineChanged,
  serviceSessionRecorded,
} from '@pospay/contracts';
import { parseMoney } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';
import {
  appendJourney,
  assertLineSnapshots,
  changeJourney,
  expectedRow,
  consume,
  ids,
  journeyFixture,
  must,
  producerState,
  projection,
  recordJourney,
  savedEvents,
  type JourneyFixture,
  type Recording,
} from './commission-line-producer-journey.fixture.ts';

let f: JourneyFixture | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});

it('real HTTP record and append project exact shares, snapshots, date and identities', async () => {
  f = await journeyFixture();
  await f.h
    .owner`UPDATE services SET counts_toward_threshold=false WHERE company_id=${f.company} AND id=${must(f.services[1])}`;
  const journey = await recordJourney(f);
  const appended = await appendJourney(f, journey);
  expect(journey.session.business_date).toBe('2026-10-15');
  expect(journey.session.business_timezone).toBe('Asia/Kuwait');
  expect(journey.sharedLine.performers.map((p) => p.employee_id)).toEqual([
    journey.high,
    journey.low,
  ]);
  const events = await savedEvents(f, journey.session.id);
  expect(events.map((event) => event.eventType)).toEqual([
    'ServiceSessionRecorded',
    'ServiceSessionLinesAdded',
  ]);
  expect(
    serviceSessionRecorded.parse(must(events[0]).payload).lines.map((line) => line.line_id),
  ).toEqual(journey.session.lines.map((line) => line.id));
  for (const event of events)
    expect(event).toMatchObject({
      companyId: f.company,
      aggregateId: journey.session.id,
      aggregateType: 'service_session',
      attempt: 1,
    });
  // تغيير الكتالوج بعد الحفظ يكشف أي قراءة للقاعدة الحالية بدل اللقطة التاريخية في الحدث.
  await f.h.owner`UPDATE services SET commission_rule_kind='ZERO',commission_pct_bps=NULL,
    commission_fixed_amount=NULL,counts_toward_threshold=false WHERE company_id=${f.company}`;
  await consume(f, events);
  const stored = await projection(f);
  const lines = [...journey.session.lines, ...appended.added_lines];
  expect(lines.map((line) => line.net)).toEqual(['25.001', '7.125', '0.000', '15.000']);
  expect(journey.session.total_net).toBe('32.126');
  expect(appended.session.total_net).toBe('47.126');
  expect(stored.heads).toHaveLength(4);
  expect(stored.rows).toHaveLength(5);
  expect(stored.marks.map((mark) => mark['event_id']).sort()).toEqual(
    events.map((event) => event.id).sort(),
  );
  for (const line of lines) assertInitialLine(f, journey, line, stored);

  expect(
    stored.rows
      .filter((row) => row['line_id'] === journey.sharedLine.id)
      .map((row) => [row['employee_id'], row['net_share']]),
  ).toEqual([
    [journey.low, '12.501'],
    [journey.high, '12.500'],
  ]);
  assertLineSnapshots(lines);
}, 120_000);

it('HTTP revisions replace shares through cancellation; original request and consumer replays cannot resurrect revision 1', async () => {
  f = await journeyFixture();
  const journey = await recordJourney(f);
  await appendJourney(f, journey);
  await consume(f, await savedEvents(f, journey.session.id));
  const initial = await projection(f);
  const siblings = initial.rows.filter((row) => row['line_id'] !== journey.sharedLine.id);
  const siblingHeads = initial.heads.filter((head) => head['line_id'] !== journey.sharedLine.id);
  const changes = await changeJourney(f, journey);
  expect([journey.sharedLine.revision, ...changes.map((line) => line.revision)]).toEqual([
    1, 2, 3, 4,
  ]);
  const events = await savedEvents(f, journey.session.id);
  expect(events).toHaveLength(5);
  await assertRevisions(f, journey, events, siblings, siblingHeads);

  const final = await projection(f);
  expect(final.heads).toHaveLength(4);
  expect(final.rows).toHaveLength(4);
  expect(final.marks).toHaveLength(5);
  const producer = await producerState(f, journey.session.id);
  expect(producer.edits.map((row) => row['revision'])).toEqual([2]);
  expect(producer.performers.map((row) => row['revision'])).toEqual([3]);
  expect(producer.cancellations.map((row) => row['revision'])).toEqual([4]);
  for (const request of journey.requests) {
    const replay = await f.h.send(request.method, request.url, request.options);
    expect(replay.status).toBe(request.response.status);
    expect(replay.body).toEqual(request.response.body);
    expect(replay.text).toBe(request.response.text);
  }
  expect(
    recordServiceSessionResponse.parse(must(journey.requests[0]).response.body).session.lines[0]
      ?.revision,
  ).toBe(1);
  expect(await producerState(f, journey.session.id)).toEqual(producer);
  await consume(f, [...events, must(events[0]), ...events]);
  expect(await projection(f)).toEqual(final);
  expect(await savedEvents(f, journey.session.id)).toEqual(events);
}, 120_000);

it('unauthorized, stale and foreign-scope HTTP refusals leave producer history and projection unchanged; RLS hides raw foreign rows', async () => {
  f = await journeyFixture();
  const { journey, root, producer, projected, currentRevision } = await prepareStaleBaseline(f);
  const operations = [
    {
      method: 'PATCH' as const,
      suffix: '',
      body: { price: '27.001', discount: { kind: 'AMOUNT', amount: '0.000' } },
    },
    {
      method: 'PUT' as const,
      suffix: '/performers',
      body: { performers: [{ employee_id: must(f.employees[2]), share_bps: 10000 }] },
    },
    { method: 'POST' as const, suffix: '/cancellation', body: {} },
  ];
  for (const operation of operations) {
    const variants = refusalVariants(f, root);
    for (const variant of variants) {
      const response = await f.h.send(operation.method, `${variant.url}${operation.suffix}`, {
        cookie: variant.cookie,
        company: variant.company,
        key: ids.newId(),
        body: {
          ...operation.body,
          expected_revision: variant.revision,
          reason: 'Synthetic refused mutation',
        },
      });
      expect(response.status, response.text).toBe(variant.status);
      expect(response.body['code']).toBe(variant.code);
      // النسخة الأقدم تُرفض بسبب سطر اتغيّر فعلاً: واحدة أقدم من المرصودة، مش رقم غريب.
      if (variant.code === 'SESSION_LINE_REVISION_STALE') {
        expect(variant.revision).toBe(1);
        expect(variant.revision).toBeLessThan(currentRevision);
        expect(currentRevision).toBe(2);
        expect(response.body['details']).toMatchObject({ current_revision: currentRevision });
      }
      expect(await producerState(f, journey.session.id)).toEqual(producer);
      expect(await projection(f)).toEqual(projected);
    }
  }
  await f.db.withTenant(f.otherCompany, async (tx) => {
    const role = await tx.execute(
      sql`SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`,
    );
    expect(role[0]).toEqual({ role: 'pospay_app', rolsuper: false, rolbypassrls: false });
    expect(
      await tx.execute(
        sql`SELECT * FROM commission_line_heads WHERE company_id=${must(f).company}`,
      ),
    ).toHaveLength(0);
    expect(
      await tx.execute(sql`SELECT * FROM commission_lines WHERE company_id=${must(f).company}`),
    ).toHaveLength(0);
  });
}, 120_000);

async function prepareStaleBaseline(fixture: JourneyFixture) {
  const journey = await recordJourney(fixture);
  await appendJourney(fixture, journey);
  const selected = journey.sharedLine;
  expect(selected.revision).toBe(1);
  expect(selected.status).toBe('ACTIVE');
  const root = `${fixture.base}/${journey.session.id}/lines/${selected.id}`;
  const response = await fixture.h.send('PATCH', root, {
    cookie: fixture.ownerCookie,
    company: fixture.company,
    key: ids.newId(),
    body: editServiceLineInput.parse({
      price: '27.001',
      discount: { kind: 'AMOUNT', amount: '0.000' },
      expected_revision: 1,
      reason: 'Synthetic baseline edit',
    }),
  });
  expect(response.status, response.text).toBe(200);
  const edited = editServiceLineResponseFull.parse(response.body);
  expect(edited.line.id).toBe(selected.id);
  expect(edited.line.session_id).toBe(journey.session.id);
  expect(edited.line.revision).toBe(2);
  expect(edited.line.status).toBe('ACTIVE');
  const currentRevision = edited.line.revision;
  const events = await savedEvents(fixture, journey.session.id);
  const changed = events.filter((event) => event.eventType === 'ServiceLineChanged');
  expect(changed).toHaveLength(1);
  const payload = serviceLineChanged.parse(must(changed[0]).payload);
  expect(payload.line_id).toBe(selected.id);
  expect(payload.session_id).toBe(journey.session.id);
  expect(payload.revision).toBe(currentRevision);
  expect(payload.status).toBe('ACTIVE');
  expect(payload.change?.previous.revision).toBe(1);
  await consume(fixture, events);
  const producer = await producerState(fixture, journey.session.id);
  const projected = await projection(fixture);
  expect(producer.lines.find((row) => row['id'] === selected.id)).toMatchObject({
    revision: currentRevision,
    status: 'ACTIVE',
  });
  expect(projected.heads.find((head) => head['line_id'] === selected.id)).toMatchObject({
    revision: currentRevision,
    status: 'ACTIVE',
  });
  return { journey, root, producer, projected, currentRevision };
}

function assertInitialLine(
  fixture: JourneyFixture,
  journey: Recording,
  line: Recording['sharedLine'],
  stored: Awaited<ReturnType<typeof projection>>,
) {
  expect(stored.heads.find((head) => head['line_id'] === line.id)).toEqual({
    company_id: fixture.company,
    business_id: fixture.business,
    line_id: line.id,
    session_id: journey.session.id,
    branch_id: fixture.branch,
    service_id: line.service_id,
    customer_id: fixture.customer,
    revision: 1,
    status: 'ACTIVE',
    business_date: '2026-10-15',
    period: '2026-10',
  });
  const shares = stored.rows.filter((row) => row['line_id'] === line.id);
  expect(shares.reduce((sum, row) => sum + parseMoney(String(row['net_share'])), 0n)).toBe(
    parseMoney(line.net),
  );
  expect(shares).toHaveLength(line.performers.length);
  for (const row of shares)
    expect({
      ...row,
      occurred_at: new Date(String(row['occurred_at'])),
      recorded_at: new Date(String(row['recorded_at'])),
    }).toEqual(expectedRow(fixture, journey, line, String(row['employee_id'])));
}

async function assertRevisions(
  fixture: JourneyFixture,
  journey: Recording,
  events: Awaited<ReturnType<typeof savedEvents>>,
  siblings: Awaited<ReturnType<typeof projection>>['rows'],
  siblingHeads: Awaited<ReturnType<typeof projection>>['heads'],
) {
  for (const [index, event] of events.slice(2).entries()) {
    const payload = serviceLineChanged.parse(event.payload);
    expect(payload.revision).toBe(index + 2);
    expect(payload.net).toBe('27.001');
    await consume(fixture, [event]);
    const stored = await projection(fixture);
    expect(stored.heads.find((head) => head['line_id'] === journey.sharedLine.id)).toMatchObject({
      revision: index + 2,
      status: index === 2 ? 'CANCELLED' : 'ACTIVE',
    });
    const shares = stored.rows.filter((row) => row['line_id'] === journey.sharedLine.id);
    expect(shares).toHaveLength(index === 0 ? 2 : 1);
    expect(shares.map((row) => [row['employee_id'], row['net_share'], row['status']])).toEqual(
      index === 0
        ? [
            [journey.low, '13.501', 'ACTIVE'],
            [journey.high, '13.500', 'ACTIVE'],
          ]
        : [[must(fixture.employees[2]), '27.001', index === 2 ? 'CANCELLED' : 'ACTIVE']],
    );
    expect(stored.rows.filter((row) => row['line_id'] !== journey.sharedLine.id)).toEqual(siblings);
    expect(stored.heads.filter((head) => head['line_id'] !== journey.sharedLine.id)).toEqual(
      siblingHeads,
    );
  }
}

function refusalVariants(fixture: JourneyFixture, root: string) {
  return [
    {
      url: root,
      cookie: fixture.cookie,
      company: fixture.company,
      revision: 1,
      status: 403,
      code: 'FORBIDDEN',
    },
    {
      url: root,
      cookie: fixture.ownerCookie,
      company: fixture.company,
      revision: 1,
      status: 409,
      code: 'SESSION_LINE_REVISION_STALE',
    },
    {
      url: root.replace(fixture.branch, fixture.secondBranch),
      cookie: fixture.ownerCookie,
      company: fixture.company,
      revision: 1,
      status: 403,
      code: 'FORBIDDEN',
    },
    {
      url: root
        .replace(fixture.business, fixture.foreignBusiness)
        .replace(fixture.branch, fixture.foreignBranch),
      cookie: fixture.ownerCookie,
      company: fixture.company,
      revision: 1,
      status: 403,
      code: 'FORBIDDEN',
    },
    {
      url: root,
      cookie: fixture.ownerCookie,
      company: fixture.otherCompany,
      revision: 1,
      status: 403,
      code: 'FORBIDDEN',
    },
  ];
}
