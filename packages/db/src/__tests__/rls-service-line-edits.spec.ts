import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { seedOrders, ORDER_IDS } from '../../test/orders-fixture.ts';

let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7(),
  { A, B } = TENANT;
const SHARED = ids.newId();
const OTHER = {
  business: '01920000-0000-7000-8000-000000004110',
  branch: '01920000-0000-7000-8000-000000004111',
  service: '01920000-0000-7000-8000-000000004112',
  employee: '01920000-0000-7000-8000-000000004113',
  session: '01920000-0000-7000-8000-000000004114',
  line: '01920000-0000-7000-8000-000000004115',
  performer: '01920000-0000-7000-8000-000000004116',
};
type Edit = {
  id?: string;
  company?: string;
  business?: string;
  line?: string;
  changedBy?: string;
  revision?: number;
  previousRevision?: number;
  newPrice?: string;
  newDiscount?: string;
  newNet?: string;
  newBps?: number;
  newLimit?: number | null;
  newSource?: string;
  reason?: string;
  editorNameAr?: string | null;
  editorNameEn?: string | null;
  editorRole?: string | null;
  roleIsSystem?: boolean | null;
  roleNameAr?: string | null;
  roleNameEn?: string | null;
};
type SqlQuery = ReturnType<typeof sql>;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
  for (const tenant of [A, B]) {
    await db.withTenant(
      tenant.company,
      (tx) => tx.execute(edit({ company: tenant.company, business: tenant.business, id: SHARED })),
      { userId: USER },
    );
  }
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const asA = (query: SqlQuery) =>
  db.withTenant(A.company, (tx) => tx.execute(query), { userId: USER });

function edit(input: Edit = {}) {
  const company = input.company ?? A.company;
  const business = input.business ?? (company === B.company ? B.business : A.business);
  const revision = input.revision ?? 2;
  const previous = input.previousRevision ?? revision - 1;
  const newLimit = input.newLimit === undefined ? 5000 : input.newLimit;
  const role = input.editorRole === undefined ? 'owner' : input.editorRole;
  const snapshot = (value: unknown, fallback: unknown) => (value !== undefined ? value : role === null ? null : fallback);
  const roleIsSystem = snapshot(input.roleIsSystem, true) as boolean | null;
  const roleNameAr = input.roleNameAr ?? null;
  const roleNameEn = snapshot(input.roleNameEn, 'Role') as string | null;
  return sql`INSERT INTO service_line_edits(company_id,id,business_id,line_id,revision,previous_revision,
    previous_price,previous_discount,previous_net,new_price,new_discount,new_net,
    previous_effective_discount_bps,previous_limit_bps_applied,previous_limit_source,
    new_effective_discount_bps,new_limit_bps_applied,new_limit_source,reason,changed_at,changed_by,
    changed_by_membership_id,editor_name_ar,editor_name_en,editor_role,
    editor_role_is_system,editor_role_name_ar,editor_role_name_en)
    VALUES(${company},${input.id ?? ids.newId()},${business},
      ${input.line ?? ORDER_IDS.line},${revision},${previous},1.000,0.000,1.000,
      ${input.newPrice ?? '2.000'},${input.newDiscount ?? '0.500'},${input.newNet ?? '1.500'},
      0,NULL,'OWNER',${input.newBps ?? 2500},${newLimit},${input.newSource ?? 'PERSON'},
      ${input.reason ?? 'Corrected price'},clock_timestamp(),${input.changedBy ?? USER},${ORDER_IDS.membership},
      ${input.editorNameAr ?? null},${input.editorNameEn ?? null},${role},
      ${roleIsSystem},${roleNameAr},${roleNameEn})`;
}

async function rejected(work: Promise<unknown>, code: string, constraint?: string) {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: { code?: string; constraint_name?: string } }).cause;
  expect(cause?.code).toBe(code);
  if (constraint !== undefined) expect(cause?.constraint_name).toBe(constraint);
}

it('forces RLS with select and insert predicates only, and refuses mutation', async () => {
  const [row] = await owner`SELECT c.relrowsecurity,c.relforcerowsecurity,r.rolname FROM pg_class c
    JOIN pg_roles r ON r.oid=c.relowner WHERE c.oid='service_line_edits'::regclass`;
  expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  expect(row?.['rolname']).not.toBe('pospay_app');
  const policies = await owner`SELECT cmd,qual,with_check FROM pg_policies
    WHERE tablename='service_line_edits' ORDER BY cmd`;
  expect(policies.map((policy) => policy['cmd'])).toEqual(['INSERT', 'SELECT']);
  for (const policy of policies) {
    const text = `${policy['qual'] ?? ''} ${policy['with_check'] ?? ''}`;
    expect(text).toContain('app_company_id()');
    expect(text).not.toContain('app_user_id()');
  }
  for (const query of [
    sql`UPDATE service_line_edits SET reason='changed'`,
    sql`DELETE FROM service_line_edits`,
    sql`TRUNCATE service_line_edits`,
  ])
    await rejected(asA(query), '42501');
  const [role] = await owner`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pospay_app'`;
  expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
});

it('isolates the same id and rejects a cross-company insert', async () => {
  expect(await asA(sql`SELECT company_id FROM service_line_edits WHERE id=${SHARED}`)).toEqual([
    { company_id: A.company },
  ]);
  expect(await asA(sql`SELECT id FROM service_line_edits WHERE company_id=${B.company}`)).toEqual([]);
  await rejected(asA(edit({ company: B.company, business: B.business, revision: 80 })), '42501');
  await rejected(
    asA(
      sql`${edit({ company: B.company, business: B.business, id: SHARED, revision: 2 })}
        ON CONFLICT (company_id, line_id, revision) DO NOTHING`,
    ),
    '42501',
  );
});

it('anchors a history row to its line only, so it cannot name a session that is not the line session', async () => {
  const columns = await owner`SELECT column_name FROM information_schema.columns
    WHERE table_name='service_line_edits' AND column_name='session_id'`;
  expect(columns).toEqual([]);
});

it('rejects a line that exists only in the other company', async () => {
  const foreignLine = ids.newId();
  const performer = ids.newId();
  await owner.begin(async (tx) => {
    await tx`INSERT INTO service_lines SELECT (jsonb_populate_record(NULL::service_lines,
      to_jsonb(l)||jsonb_build_object('id',${foreignLine}::text,'ordinal',2))).* FROM service_lines l
      WHERE company_id=${B.company} AND id=${ORDER_IDS.line}`;
    await tx`INSERT INTO line_performers SELECT (jsonb_populate_record(NULL::line_performers,
      to_jsonb(p)||jsonb_build_object('id',${performer}::text,'line_id',${foreignLine}::text))).*
      FROM line_performers p WHERE company_id=${B.company} AND line_id=${ORDER_IDS.line}`;
  });
  await rejected(asA(edit({ line: foreignLine })), '23503', 'service_line_edits_line_fk');
});

async function seedOtherBusiness() {
  await owner`INSERT INTO businesses(company_id,id,name_en,vertical_type)
    VALUES(${A.company},${OTHER.business},'Synthetic second salon','salon')`;
  await owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${A.company},${OTHER.branch},${OTHER.business},'Synthetic second branch')`;
  await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${A.company},${OTHER.service},${OTHER.business},'Synthetic second service',1.000,'ZERO')`;
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    VALUES(${A.company},${OTHER.employee},${OTHER.business},${OTHER.branch},'Synthetic second performer','synthetic second performer','staff','2026-01-01')`;
  await owner.begin(async (tx) => {
    await tx`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
      recorded_by,recorded_by_membership_id,occurred_at,recorded_at,business_date,business_timezone,late)
      VALUES(${A.company},${OTHER.session},${OTHER.business},${OTHER.branch},${ORDER_IDS.customer},'Synthetic customer','***123',
        ${USER},${ORDER_IDS.membership},now(),now(),current_date,'Asia/Kuwait',false)`;
    await tx`INSERT INTO service_lines(company_id,id,business_id,session_id,service_id,ordinal,input_index,status,revision,
      list_price,price,discount,net,effective_discount_bps,limit_source,limit_bps_applied,name_en,catalog_revision,rule_kind,
      counts_toward_threshold,has_performer_warning,recorded_by,recorded_by_membership_id,recorded_at,late)
      VALUES(${A.company},${OTHER.line},${OTHER.business},${OTHER.session},${OTHER.service},1,0,'ACTIVE',1,1.000,1.000,0.000,1.000,
        0,'OWNER',NULL,'Synthetic second service',1,'ZERO',true,false,${USER},${ORDER_IDS.membership},now(),false)`;
    await tx`INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,
      not_clocked_in_warning,approved_leave_warning)
      VALUES(${A.company},${OTHER.performer},${OTHER.business},${OTHER.line},${OTHER.employee},1,10000,'Synthetic second performer',false,false)`;
  });
}

it('rejects a line that belongs to another business in the same company', async () => {
  await seedOtherBusiness();
  await rejected(
    asA(edit({ business: A.business, line: OTHER.line, revision: 2 })),
    '23503',
    'service_line_edits_line_fk',
  );
});

it('rejects a user that does not own the recorded membership', async () => {
  const stranger = ids.newId();
  await owner`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at)
    VALUES(${stranger},'Synthetic other editor','other-editor@example.test',true,now(),now())`;
  await rejected(
    asA(edit({ changedBy: stranger, revision: 50 })),
    '23503',
    'service_line_edits_membership_fk',
  );
});

it('rejects a duplicate line revision', async () => {
  await rejected(asA(edit({ revision: 2 })), '23505', 'service_line_edits_line_revision_key');
});

const badRows: Array<[Edit, string]> = [
  [{ revision: 30, previousRevision: 1 }, 'service_line_edits_revision'],
  [{ revision: 31, newNet: '1.000' }, 'service_line_edits_new_amounts'],
  [{ revision: 32, reason: '' }, 'service_line_edits_reason'],
  [{ revision: 33, reason: '   ' }, 'service_line_edits_reason'],
  [{ revision: 34, reason: 'x'.repeat(501) }, 'service_line_edits_reason'],
  [{ revision: 38, reason: `x${' '.repeat(500)}` }, 'service_line_edits_reason'],
  [{ revision: 39, reason: '\t\n \r\n' }, 'service_line_edits_reason'],
  [{ revision: 35, editorRole: 'Owner' }, 'service_line_edits_editor_role'],
  [{ revision: 40, editorRole: 'owner'.padEnd(65, 'x') }, 'service_line_edits_editor_role'],
  [{ revision: 41, editorRole: 'senior_stylist', roleIsSystem: false, roleNameEn: null }, 'service_line_edits_editor_role_snapshot'],
  [{ revision: 42, editorRole: 'owner', roleIsSystem: null }, 'service_line_edits_editor_role_snapshot'],
  [{ revision: 43, editorRole: null, editorNameEn: 'Editor', roleNameEn: 'Role' }, 'service_line_edits_editor_role_snapshot'],
  [{ revision: 44, editorRole: null, editorNameEn: 'Editor', roleNameAr: 'دور' }, 'service_line_edits_editor_role_snapshot'],
  [{ revision: 45, editorRole: null }, 'service_line_edits_editor_identity'],
  [{ revision: 46, editorRole: 'owner', roleNameEn: 'x'.repeat(256) }, 'service_line_edits_editor_name_length'],
  [{ revision: 47, editorRole: null, editorNameEn: 'x'.repeat(256) }, 'service_line_edits_editor_name_length'],
  [{ revision: 36, editorNameAr: 'اسم', editorNameEn: null }, 'service_line_edits_editor_names'],
  [{ revision: 37, newSource: 'NOT_CONFIGURED', newLimit: 5 }, 'service_line_edits_new_limit'],
];

it('rejects each illegal history shape', async () => {
  for (const [input, constraint] of badRows) await rejected(asA(edit(input)), '23514', constraint);
});

it('keeps a role label without names, and names without a role label', async () => {
  expect(
    await asA(sql`${edit({ revision: 3, editorRole: 'manager' })} RETURNING editor_role, editor_name_ar, editor_name_en`),
  ).toEqual([{ editor_role: 'manager', editor_name_ar: null, editor_name_en: null }]);
  expect(
    await asA(
      sql`${edit({ revision: 5, editorRole: 'senior_stylist', roleIsSystem: false, roleNameAr: 'مصففة أولى', roleNameEn: 'x'.repeat(255) })}
        RETURNING editor_role, editor_role_is_system, editor_role_name_ar, char_length(editor_role_name_en) AS name_length`,
    ),
  ).toEqual([{ editor_role: 'senior_stylist', editor_role_is_system: false, editor_role_name_ar: 'مصففة أولى', name_length: 255 }]);
  expect(
    await asA(
      sql`${edit({ revision: 4, editorRole: null, editorNameAr: 'محرر', editorNameEn: 'Editor' })} RETURNING editor_role, editor_name_en`,
    ),
  ).toEqual([{ editor_role: null, editor_name_en: 'Editor' }]);
});

it('no context, failed transaction, reused pool and concurrent tenants never leak', async () => {
  const raw = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await raw`SELECT id FROM service_line_edits`).toHaveLength(0);
  } finally {
    await raw.end();
  }
  await expect(
    db.withTenant(B.company, async (tx) => {
      await tx.execute(sql`SELECT id FROM service_line_edits`);
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  const rows = await Promise.all(
    [A.company, B.company, A.company].map((company) =>
      db.withTenant(company, (tx) => tx.execute(sql`SELECT company_id FROM service_line_edits`), {
        userId: USER,
      }),
    ),
  );
  expect(rows.map((result) => result.every((row) => row['company_id'] === result[0]?.['company_id']))).toEqual([
    true,
    true,
    true,
  ]);
  expect(rows.map((result) => result[0]?.['company_id'])).toEqual([A.company, B.company, A.company]);
});
