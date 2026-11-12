import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  packageEntitlementDetailStatement,
  readPackageEntitlementDetail,
} from '../queries/package-entitlement-detail.query.ts';
import { ids, must, type SessionFixture } from './session.fixture.ts';
import { packageLine } from './package-redemption.fixture.ts';
import {
  CURRENT_EXPIRY,
  extensionBody,
  NEXT_EXPIRY,
  packageExtensionFixture,
  postExtension,
  seedForeignCompanyPackage,
  seedSecondBusinessPackage,
  seedSoldPackage,
  type PackageExtensionFixture,
} from './package-extension.fixture.ts';

let fixture: PackageExtensionFixture;
let f: SessionFixture;

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];
const fresh = () => seedSoldPackage(f, { sessions: 2, expiresOn: CURRENT_EXPIRY });
const read = (entitlementId: string, businessId = f.business, companyId = f.company) =>
  f.db.withTenant(companyId, (tx) =>
    readPackageEntitlementDetail(tx, companyId, businessId, entitlementId),
  );

beforeAll(async () => {
  fixture = await packageExtensionFixture();
  f = fixture.f;
});

beforeEach(() => {
  fixture.setAt(new Date('2026-10-15T08:00:00.000Z'));
});

afterAll(async () => {
  await f?.close();
});

it('returns an empty extension history when no extension exists', async () => {
  expect(must(await read(fixture.sold.entitlement)).extensions).toEqual([]);
});

it('returns two extensions newest first with exactly the public fields and UTC dates', async () => {
  const seeded = await fresh();
  const reason = 'Synthetic private extension reason';
  expect((await postExtension(f, seeded.entitlement, {
    body: extensionBody({ reason }),
  })).status).toBe(201);
  fixture.setAt(new Date('2026-10-16T08:00:00.000Z'));
  expect((await postExtension(f, seeded.entitlement, {
    body: extensionBody({ expected_expires_on: NEXT_EXPIRY, new_expires_on: '2027-02-28' }),
  })).status).toBe(201);

  const detail = must(await read(seeded.entitlement));
  expect(detail.extensions.map((row) => row.previous_expires_on))
    .toEqual([NEXT_EXPIRY, CURRENT_EXPIRY]);
  expect(detail.extensions.map((row) => row.new_expires_on))
    .toEqual(['2027-02-28', NEXT_EXPIRY]);
  for (const row of detail.extensions) {
    expect(Object.keys(row).sort())
      .toEqual(['extended_at', 'id', 'new_expires_on', 'previous_expires_on']);
    expect(row.previous_expires_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(row.new_expires_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(row.extended_at.endsWith('Z')).toBe(true);
    expect(Number.isNaN(Date.parse(row.extended_at))).toBe(false);
  }
  const serialized = JSON.stringify(detail);
  expect(serialized).not.toContain(reason);
  expect(serialized).not.toContain(f.membership);
  expect(serialized).not.toContain('extended_by');
});

it('breaks equal extended_at ties by ascending id', async () => {
  const seeded = await fresh();
  const at = '2026-10-17T08:00:00.000Z';
  const extensionIds = [ids.newId(), ids.newId()].sort();
  for (const [index, id] of extensionIds.entries()) {
    const previous = index === 0 ? CURRENT_EXPIRY : NEXT_EXPIRY;
    const next = index === 0 ? NEXT_EXPIRY : '2027-02-28';
    await f.h.owner.begin(async (tx) => {
      await tx`INSERT INTO package_extensions
        (company_id,id,business_id,entitlement_id,branch_id,previous_expires_on,new_expires_on,reason,
          extended_by,extended_by_membership_id,extended_at)
        VALUES(${f.company},${id},${f.business},${seeded.entitlement},${f.branch},${previous},${next},
          'Synthetic timestamp tie',${f.userId},${f.membership},${at})`;
      await tx`UPDATE package_entitlements SET expires_on=${next}
        WHERE company_id=${f.company} AND business_id=${f.business} AND id=${seeded.entitlement}`;
    });
  }
  const detail = must(await read(seeded.entitlement));
  expect(detail.extensions.map((row) => row.id)).toEqual(extensionIds);
  expect(detail.extensions.map((row) => row.extended_at)).toEqual([at, at]);
});

it('never leaks extensions from another entitlement, business or company', async () => {
  const own = await fresh();
  const other = await fresh();
  const otherBusiness = await seedSecondBusinessPackage(f);
  const foreign = await seedForeignCompanyPackage(f);
  const ownResponse = await postExtension(f, own.entitlement);
  const otherResponse = await postExtension(f, other.entitlement);
  expect(ownResponse.status).toBe(201);
  expect(otherResponse.status).toBe(201);

  const businessExtensionId = ids.newId();
  await f.h.owner.begin(async (tx) => {
    await tx`INSERT INTO package_extensions
      (company_id,id,business_id,entitlement_id,branch_id,previous_expires_on,new_expires_on,reason,
        extended_by,extended_by_membership_id,extended_at)
      VALUES(${f.company},${businessExtensionId},${f.secondBusiness},${otherBusiness.entitlement},
        ${f.secondBranch},${CURRENT_EXPIRY},${NEXT_EXPIRY},'Synthetic business isolation',
        ${f.userId},${f.membership},'2026-10-15T08:00:00.000Z')`;
    await tx`UPDATE package_entitlements SET expires_on=${NEXT_EXPIRY}
      WHERE company_id=${f.company} AND business_id=${f.secondBusiness} AND id=${otherBusiness.entitlement}`;
  });

  const [foreignMembership] = await f.h.owner`SELECT id FROM memberships
    WHERE company_id=${f.otherCompany} AND user_id=${f.userId} AND scope_type='COMPANY'`;
  const foreignMembershipId = must(foreignMembership)['id'] as string;
  const foreignExtensionId = ids.newId();
  await f.h.owner.begin(async (tx) => {
    await tx`INSERT INTO package_extensions
      (company_id,id,business_id,entitlement_id,branch_id,previous_expires_on,new_expires_on,reason,
        extended_by,extended_by_membership_id,extended_at)
      VALUES(${f.otherCompany},${foreignExtensionId},${f.foreignBusiness},${foreign.entitlement},
        ${f.foreignBranch},${CURRENT_EXPIRY},${NEXT_EXPIRY},'Synthetic company isolation',
        ${f.userId},${foreignMembershipId},'2026-10-15T08:00:00.000Z')`;
    await tx`UPDATE package_entitlements SET expires_on=${NEXT_EXPIRY}
      WHERE company_id=${f.otherCompany} AND business_id=${f.foreignBusiness} AND id=${foreign.entitlement}`;
  });

  const detail = must(await read(own.entitlement));
  expect(detail.extensions.map((row) => row.id)).toEqual([ownResponse.body['id']]);
  const serialized = JSON.stringify(detail.extensions);
  for (const id of [other.entitlement, otherBusiness.entitlement, foreign.entitlement,
    otherResponse.body['id'], businessExtensionId, foreignExtensionId]) {
    expect(serialized).not.toContain(id);
  }
});

it('keeps redemptions and sale components beside a new extension', async () => {
  const seeded = await fresh();
  await f.create.execute({
    ...f.context(ids.newId()),
    input: f.body([packageLine(f, seeded.entitlement)]),
  });
  expect((await postExtension(f, seeded.entitlement)).status).toBe(201);
  const detail = must(await read(seeded.entitlement));
  expect(detail.id).toBe(seeded.entitlement);
  expect(detail.price_paid).toBe('2.000');
  expect(detail.components.map((row) => row.id)).toEqual([seeded.component]);
  expect(detail.redemptions.map((row) => row.component_id)).toEqual([seeded.component]);
  expect(detail.extensions).toHaveLength(1);
});

it('uses an extension history index without a sequential scan below 200 ms', async () => {
  const first = await fresh();
  const second = await fresh();
  expect((await postExtension(f, first.entitlement)).status).toBe(201);
  expect((await postExtension(f, first.entitlement, {
    body: extensionBody({ expected_expires_on: NEXT_EXPIRY, new_expires_on: '2027-02-28' }),
  })).status).toBe(201);
  expect((await postExtension(f, second.entitlement)).status).toBe(201);
  await f.h.owner.unsafe('ANALYZE package_extensions');

  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const started = Date.now();
    const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${packageEntitlementDetailStatement(
        f.company,
        f.business,
        first.entitlement,
      )}`,
    );
    expect(Date.now() - started).toBeLessThan(200);
    const plan = nodes(must(must(rows[0])['QUERY PLAN'][0]).Plan);
    const scans = plan.filter((node) => node['Relation Name'] === 'package_extensions');
    expect(scans.length).toBeGreaterThan(0);
    expect(scans.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
    expect(scans.some((node) => [
      'package_extensions_history_idx',
      'package_extensions_entitlement_previous_key',
    ].includes(node['Index Name'] ?? ''))).toBe(true);
  });
}, 120_000);
