import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  packageEntitlementDetailStatement,
  readPackageEntitlementDetail,
} from '../queries/package-entitlement-detail.query.ts';
import { ids, must } from './session.fixture.ts';
import { performersFixture, type PerformersFixture } from './line-performers.helpers.ts';
import { runCancel } from './line-cancel.helpers.ts';
import { packageLine, seedPackage } from './package-redemption.fixture.ts';

let f: PerformersFixture;

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];
const supportingIndexes: Record<string, readonly string[]> = {
  package_redemptions: [
    'package_redemptions_component_fk_idx',
    'package_redemptions_slot_fk_idx',
    'package_redemptions_line_fk_idx',
    'package_redemptions_business_id_key',
    'package_redemptions_pkey',
  ],
  service_lines: ['service_lines_business_id_key', 'service_lines_pkey'],
  service_sessions: ['service_sessions_business_id_key', 'service_sessions_pkey'],
};

function read(entitlementId: string) {
  return f.db.withTenant(f.company, (tx) =>
    readPackageEntitlementDetail(tx, f.company, f.business, entitlementId),
  );
}

function recordPackage(entitlementId: string, occurredAt: string, count = 1) {
  const lines = Array.from({ length: count }, () => packageLine(f, entitlementId));
  return f.create.execute({
    ...f.context(ids.newId()),
    input: { ...f.body(lines), occurred_at: occurredAt },
  });
}

function expectSupportingIndexes(plan: PlanNode[]) {
  for (const table of Object.keys(supportingIndexes)) {
    const scans = plan.filter((node) => node['Relation Name'] === table);
    expect(scans.length).toBeGreaterThan(0);
    expect(scans.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
    expect(plan.some((node) => (node['Index Name'] ?? '').startsWith(table + '_'))).toBe(true);
  }
}

beforeAll(async () => {
  f = await performersFixture();
});

afterAll(async () => {
  await f?.close();
});

it('returns redemptions newest visit first, then descending slot ordinal, with visit business dates', async () => {
  const seeded = await seedPackage(f, { sessions: 3, expiresOn: '2026-12-30' });
  await recordPackage(seeded.entitlement, '2026-10-10T08:00:00.000Z', 2);
  await recordPackage(seeded.entitlement, '2026-10-12T08:00:00.000Z');

  const detail = must(await read(seeded.entitlement));
  expect(detail.redemptions.map((row) => [row.ordinal, row.visit_business_date])).toEqual([
    [3, '2026-10-12'],
    [2, '2026-10-10'],
    [1, '2026-10-10'],
  ]);
  expect(detail.redemptions.map((row) => row.component_id)).toEqual([
    seeded.component,
    seeded.component,
    seeded.component,
  ]);
  for (const redemption of detail.redemptions) {
    expect(redemption.id).toEqual(expect.any(String));
    expect(redemption.redeemed_at).toEqual(expect.any(String));
    expect(redemption.reversed_at).toBeNull();
  }
});

it('shows a reversal and breaks same-visit ordinal ties by redemption id after slot reuse', async () => {
  const seeded = await seedPackage(f, { sessions: 1, expiresOn: '2026-12-30' });
  const recorded = await recordPackage(seeded.entitlement, '2026-10-14T08:00:00.000Z');
  const line = must(recorded.session.lines[0]);
  await runCancel(f, recorded.session.id, line.id);
  await f.append.execute({
    ...f.context(ids.newId()),
    sessionId: recorded.session.id,
    input: { lines: [packageLine(f, seeded.entitlement)] },
  });

  const redemptions = must(await read(seeded.entitlement)).redemptions;
  expect(redemptions.map((row) => row.ordinal)).toEqual([1, 1]);
  expect(redemptions.map((row) => row.visit_business_date)).toEqual(['2026-10-14', '2026-10-14']);
  expect(redemptions.map((row) => row.id)).toEqual(redemptions.map((row) => row.id).sort());
  const reversed = must(redemptions.find((row) => row.reversed_at !== null));
  expect(Number.isNaN(Date.parse(must(reversed.reversed_at)))).toBe(false);
  expect(redemptions.filter((row) => row.reversed_at === null)).toHaveLength(1);
});

it('returns an empty history for unused entitlements and never leaks another customer\'s redemptions', async () => {
  const otherCustomer = ids.newId();
  await f.h.owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES(${f.company},${otherCustomer},'Synthetic other customer','+999999997321','en',now(),now())`;
  const used = await seedPackage(f, { sessions: 1, expiresOn: '2026-12-30' });
  const unused = await seedPackage(f, { sessions: 1, expiresOn: '2026-12-30' });
  const foreign = await seedPackage(f, {
    sessions: 1, expiresOn: '2026-12-30', customerId: otherCustomer,
  });
  await recordPackage(used.entitlement, '2026-10-14T08:00:00.000Z');

  expect(must(await read(used.entitlement)).redemptions).toHaveLength(1);
  expect(must(await read(unused.entitlement)).redemptions).toEqual([]);
  expect(must(await read(foreign.entitlement)).redemptions).toEqual([]);
});

it('uses redemption, line and session indexes without sequential scans below 200 ms on 30 visits', async () => {
  const seeded = await seedPackage(f, { sessions: 30, expiresOn: '2026-12-30' });
  for (let visit = 0; visit < 30; visit += 1) {
    const minute = String(visit).padStart(2, '0');
    await recordPackage(seeded.entitlement, `2026-10-14T08:${minute}:00.000Z`);
  }
  expect(must(await read(seeded.entitlement)).redemptions).toHaveLength(30);
  await f.h.owner.unsafe('ANALYZE package_redemptions, service_lines, service_sessions');

  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const started = Date.now();
    const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${packageEntitlementDetailStatement(
        f.company,
        f.business,
        seeded.entitlement,
      )}`,
    );
    expect(Date.now() - started).toBeLessThan(200);
    const plan = nodes(must(must(rows[0])['QUERY PLAN'][0]).Plan);
    expectSupportingIndexes(plan);
  });
}, 120_000);
