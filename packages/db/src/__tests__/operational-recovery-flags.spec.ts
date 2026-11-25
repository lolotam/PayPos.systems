import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  COMMISSION_REMINDER_SCHEDULES_LOST_CODE,
  REMINDER_RECOVERY_SYSTEM_CLEARED_BY,
  createOutboxDispatcherDatabase,
  type ClearReminderFlagInput,
  type OutboxDispatcherDatabase,
} from '../index.ts';
import { seedCommissionStatementTenants } from '../../test/commission-statement-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { PROVISIONAL_PLAN_ID } from '../seed.ts';

const ids = systemUuidV7();
const DELETED_COMPANY = '01920000-0000-7000-8000-0000000000e0';
const COMPANY_A = '01920000-0000-7000-8000-0000000000a0';
const COMPANY_B = '01920000-0000-7000-8000-0000000000b0';
const RUN_ID = 'a'.repeat(40);
const PASS_ID = '01920000-0000-7000-8000-0000000000f0';
const OTHER_CODE = 'OTHER_RECOVERY_CODE';

let testDb: TestDatabase;
let owner: postgres.Sql;
let dispatcherClient: postgres.Sql;
let dispatcher: OutboxDispatcherDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionStatementTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  dispatcherClient = postgres(testDb.dispatcherUrl, { max: 1, onnotice: () => undefined });
  dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl, maxConnections: 2 });
  // شركة محذوفة: مش في قائمة الاستعادة، لأن الفلتر الوحيد هو deleted_at في سياسة RLS.
  await owner`INSERT INTO companies (id, name_en, owner_user_id, plan_id, deleted_at)
    VALUES (${DELETED_COMPANY}, 'Deleted company', '01920000-0000-7000-8000-0000000000f1',
      ${PROVISIONAL_PLAN_ID}::uuid, '2026-01-01T00:00:00Z')`;
});
afterAll(async () => {
  await dispatcher?.close();
  await dispatcherClient?.end();
  await owner?.end();
  await testDb?.drop();
});

/**
 * بيرجّع كود رفض قاعدة البيانات للشغل.
 *
 * @param work الشغل اللي المفروض يرفض
 * @returns الـ SQLSTATE
 */
const refusalCode = async (work: Promise<unknown>): Promise<string> => {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  const failure = error as { code?: string; cause?: { code?: string } } | null;
  return failure?.code ?? failure?.cause?.code ?? '';
};

/**
 * يفتح حادثة جديدة لكود التذكير: بيقفل أي حادثة مفتوحة من الأول، وبعدين يرفع واحدة جديدة.
 * (الكود الواحد مسموح له بعلامة مفتوحة واحدة بس، فالتجارب لازم تبدأ من حالة نظيفة.)
 *
 * @returns معرّف العلامة المفتوحة الجديدة
 */
const freshReminderFlag = async (): Promise<string> => {
  for (const flag of await dispatcher.openRecoveryFlags()) {
    if (flag.code !== COMMISSION_REMINDER_SCHEDULES_LOST_CODE) continue;
    await dispatcher.clearReminderSchedulesLostFlag({
      flagId: flag.id,
      rebuiltRunId: RUN_ID,
      rebuiltPassId: PASS_ID,
      companiesRebuilt: 1,
      auditId: ids.newId(),
    });
  }
  const flagId = ids.newId();
  const raised = await dispatcher.raiseRecoveryFlag(flagId, COMMISSION_REMINDER_SCHEDULES_LOST_CODE);
  if (!raised.raised) throw new Error('the recovery flag was not raised');
  return flagId;
};

it('ADR-0061 §1: the two owner roles are definer roles with no membership', async () => {
  for (const role of ['pospay_recovery_company_reader', 'pospay_recovery_flag_clearer']) {
    const [row] = await owner<{
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolinherit: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
    }[]>`
      SELECT rolcanlogin, rolsuper, rolbypassrls, rolinherit, rolcreatedb, rolcreaterole, rolreplication
      FROM pg_roles WHERE rolname = ${role}`;
    expect(row).toEqual({
      rolcanlogin: false,
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
    });
  }
  // مفيش عضوية في أي اتجاه: لا هما أعضاء في دور ولا دور عضو فيهم.
  const memberships = await owner<{ role: string; member: string }[]>`
    SELECT member.rolname AS role, granted.rolname AS member
    FROM pg_auth_members a JOIN pg_roles member ON member.oid = a.member
    JOIN pg_roles granted ON granted.oid = a.roleid
    WHERE member.rolname IN ('pospay_recovery_company_reader','pospay_recovery_flag_clearer')
       OR granted.rolname IN ('pospay_recovery_company_reader','pospay_recovery_flag_clearer')`;
  expect(memberships).toEqual([]);
});

it('ADR-0061 §1: each function is owned by its own role and pins its search path', async () => {
  const rows = await owner<
    { proname: string; owner: string; prosecdef: boolean; proconfig: string[] | null }[]
  >`
    SELECT p.proname, r.rolname AS owner, p.prosecdef, p.proconfig
    FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.proname IN ('recovery_company_ids','clear_reminder_schedules_lost_flag')
    ORDER BY p.proname`;
  expect(rows).toEqual([
    {
      proname: 'clear_reminder_schedules_lost_flag',
      owner: 'pospay_recovery_flag_clearer',
      prosecdef: true,
      proconfig: ['search_path=pg_catalog, pg_temp', 'row_security=on'],
    },
    {
      proname: 'recovery_company_ids',
      owner: 'pospay_recovery_company_reader',
      prosecdef: true,
      proconfig: ['search_path=pg_catalog, pg_temp', 'row_security=on'],
    },
  ]);
});

it('ADR-0061 §1: only the dispatcher may execute the two functions', async () => {
  const roles = [
    'pospay_app',
    'pospay_auth',
    'pospay_dispatcher',
    'pospay_notifications',
    'pospay_approval_reader',
    'pospay_coverage_issuer',
    'pospay_recovery_company_reader',
    'pospay_recovery_flag_clearer',
  ];
  const functions = [
    { name: 'recovery_company_ids(uuid,integer)', owner: 'pospay_recovery_company_reader' },
    {
      name: 'clear_reminder_schedules_lost_flag(uuid,text,uuid,integer,uuid)',
      owner: 'pospay_recovery_flag_clearer',
    },
  ];
  for (const entry of functions) {
    const rows = await owner<{ role: string }[]>`
      SELECT r AS role FROM unnest(${roles}::text[]) AS r
      WHERE has_function_privilege(r, ${entry.name}, 'EXECUTE')`;
    // المرسّل هو المنفّذ الوحيد؛ صاحب الدالة نفسه بيملك حق تنفيذها دايمًا.
    expect(rows.map((row) => row.role).sort()).toEqual(['pospay_dispatcher', entry.owner].sort());
    // PUBLIC ما عندوش تنفيذ: مفيش '{=X/' في الـ ACL.
    const [row] = await owner<{ acl: string | null }[]>`
      SELECT p.proacl::text AS acl FROM pg_proc p WHERE p.oid = ${`public.${entry.name}`}::regprocedure`;
    expect(row?.acl?.includes('{=X/')).toBe(false);
  }
});

it('ADR-0061 §1: the reader role reads the company id only, never deleted_at', async () => {
  expect(
    await owner`
      SELECT has_column_privilege('pospay_recovery_company_reader', 'companies', 'id', 'SELECT') AS id,
             has_column_privilege('pospay_recovery_company_reader', 'companies', 'deleted_at', 'SELECT') AS deleted,
             has_column_privilege('pospay_recovery_company_reader', 'companies', 'name_en', 'SELECT') AS name`,
  ).toEqual([{ id: true, deleted: false, name: false }]);
  // ودور التذكير مالهوش BYPASSRLS، فسياسة RLS هي اللي بتحدّد الشركات الحيّة.
  const [row] = await owner<{ bypassrls: boolean }[]>`
    SELECT rolbypassrls AS bypassrls FROM pg_roles WHERE rolname = 'pospay_recovery_company_reader'`;
  expect(row?.bypassrls).toBe(false);
});

it('ADR-0061 §1: the reader role owns no schema CREATE and no table grant of its own', async () => {
  expect(
    await owner`
      SELECT has_schema_privilege('pospay_recovery_company_reader', 'public', 'CREATE') AS create_in_schema,
             has_schema_privilege('pospay_recovery_flag_clearer', 'public', 'CREATE') AS clearer_create,
             has_table_privilege('pospay_recovery_company_reader', 'companies', 'SELECT') AS company_select,
             has_table_privilege('pospay_recovery_flag_clearer', 'operational_recovery_flags', 'UPDATE') AS flag_update`,
  ).toEqual([
    {
      create_in_schema: false,
      clearer_create: false,
      company_select: false,
      flag_update: false,
    },
  ]);
});

it('ADR-0061 §2: the reader returns live company ids only, ascending', async () => {
  const page = await dispatcher.companyIdPage(null, 10);
  expect(page).toContain(COMPANY_A);
  expect(page).toContain(COMPANY_B);
  expect(page).not.toContain(DELETED_COMPANY);
  expect([...page].sort()).toEqual([...page]);
  // المؤشر: الصفحة التانية بترجع اللي بعد الأول بس.
  const next = await dispatcher.companyIdPage(page[0] as string, 10);
  expect(next).not.toContain(COMPANY_A);
  expect(next).toContain(COMPANY_B);
  // المقاس بيتقطع في الدالة نفسها: صفر ومعناها مية.
  const clamped = await dispatcher.companyIdPage(null, 0);
  expect(clamped).toHaveLength(1);
});

it('ADR-0061 §1: the dispatcher cannot read the companies table', async () => {
  expect(
    await owner`
      SELECT has_table_privilege('pospay_dispatcher', 'companies', 'SELECT') AS select,
             has_table_privilege('pospay_dispatcher', 'companies', 'INSERT') AS insert`,
  ).toEqual([{ select: false, insert: false }]);
  expect(
    await refusalCode(dispatcherClient`SELECT id FROM public.companies LIMIT 1`),
  ).toBe('42501');
});

it('ADR-0061 §1: the dispatcher may not update, delete or truncate the flag table', async () => {
  expect(
    await refusalCode(dispatcherClient`UPDATE public.operational_recovery_flags SET code = 'X'`),
  ).toBe('42501');
  expect(
    await refusalCode(dispatcherClient`DELETE FROM public.operational_recovery_flags`),
  ).toBe('42501');
  expect(
    await refusalCode(dispatcherClient`TRUNCATE public.operational_recovery_flags`),
  ).toBe('42501');
});

it('ADR-0061 §1: the dispatcher may not insert a flag that is already cleared', async () => {
  expect(
    await refusalCode(
      dispatcherClient`INSERT INTO public.operational_recovery_flags (id, code, raised_at, cleared_at, cleared_by)
        VALUES (${ids.newId()}::uuid, 'OTHER_CODE', pg_catalog.statement_timestamp(),
          pg_catalog.statement_timestamp(), ${REMINDER_RECOVERY_SYSTEM_CLEARED_BY}::uuid)`,
    ),
  ).toBe('42501');
  // عمود الإغلاق مش من أعمدة الإدراج الممنوحة للمرسّل.
  expect(
    await refusalCode(
      dispatcherClient`INSERT INTO public.operational_recovery_flags (id, code, raised_at, cleared_by)
        VALUES (${ids.newId()}::uuid, 'OTHER_CODE', pg_catalog.statement_timestamp(),
          ${REMINDER_RECOVERY_SYSTEM_CLEARED_BY}::uuid)`,
    ),
  ).toBe('42501');
});

it('ADR-0061 §3: one open incident per code', async () => {
  const flagId = ids.newId();
  expect(
    await dispatcher.raiseRecoveryFlag(flagId, COMMISSION_REMINDER_SCHEDULES_LOST_CODE),
  ).toMatchObject({ raised: true });
  // الكود مفتوح: الرفع التاني بيرجع من غير صف جديد.
  expect(
    await dispatcher.raiseRecoveryFlag(ids.newId(), COMMISSION_REMINDER_SCHEDULES_LOST_CODE),
  ).toMatchObject({ raised: false });
  const open = await dispatcher.openRecoveryFlags();
  expect(open.filter((flag) => flag.code === COMMISSION_REMINDER_SCHEDULES_LOST_CODE)).toHaveLength(
    1,
  );
  expect(open.some((flag) => flag.id === flagId)).toBe(true);
});

it('ADR-0061 §3: the clear refuses a null, a malformed run id and a negative count', async () => {
  const flagId = await freshReminderFlag();
  const inputs = [
    { flagId: null, rebuiltRunId: RUN_ID, rebuiltPassId: PASS_ID, companiesRebuilt: 1, auditId: ids.newId() },
    { flagId, rebuiltRunId: null, rebuiltPassId: PASS_ID, companiesRebuilt: 1, auditId: ids.newId() },
    { flagId, rebuiltRunId: 'NOT-HEX', rebuiltPassId: PASS_ID, companiesRebuilt: 1, auditId: ids.newId() },
    { flagId, rebuiltRunId: RUN_ID.toUpperCase(), rebuiltPassId: PASS_ID, companiesRebuilt: 1, auditId: ids.newId() },
    { flagId, rebuiltRunId: RUN_ID, rebuiltPassId: null, companiesRebuilt: 1, auditId: ids.newId() },
    { flagId, rebuiltRunId: RUN_ID, rebuiltPassId: PASS_ID, companiesRebuilt: -1, auditId: ids.newId() },
  ];
  for (const input of inputs) {
    // الـ null هنا متعمد: الدالة لازم ترفضه قبل أي تعديل (22023).
    const refusal = await refusalCode(
      dispatcher.clearReminderSchedulesLostFlag(input as unknown as ClearReminderFlagInput),
    );
    expect(refusal).toBe('22023');
  }
  // العلامة لسه مفتوحة: الرفض حصل قبل أي تعديل.
  expect((await dispatcher.openRecoveryFlags()).some((flag) => flag.id === flagId)).toBe(true);
});

it('ADR-0061 §3: the clear closes one open incident and writes exactly one audit row', async () => {
  const flagId = await freshReminderFlag();
  const auditId = ids.newId();
  const cleared = await dispatcher.clearReminderSchedulesLostFlag({
    flagId,
    rebuiltRunId: RUN_ID,
    rebuiltPassId: PASS_ID,
    companiesRebuilt: 3,
    auditId,
  });
  expect(cleared).toBe(true);
  const row = await owner<{ cleared_at: Date; cleared_by: string; actor: string; action: string }[]>`
    SELECT f.cleared_at, f.cleared_by, a.actor, a.action
    FROM public.operational_recovery_flags f
    JOIN public.platform_audit_log a ON a.id = ${auditId}::uuid
    WHERE f.id = ${flagId}::uuid`;
  expect(row).toHaveLength(1);
  expect(row[0]?.cleared_by).toBe(REMINDER_RECOVERY_SYSTEM_CLEARED_BY);
  expect(row[0]?.cleared_at).toBeInstanceOf(Date);
  expect(row[0]?.actor).toBe('system:worker');
  expect(row[0]?.action).toBe('recovery.flag_cleared');
  // المسح التاني: مفيش سطر تالت ولا تعديل.
  expect(
    await dispatcher.clearReminderSchedulesLostFlag({
      flagId,
      rebuiltRunId: RUN_ID,
      rebuiltPassId: PASS_ID,
      companiesRebuilt: 3,
      auditId: ids.newId(),
    }),
  ).toBe(false);
});

it('ADR-0061 §3: an unknown id and another code are refused without an audit row', async () => {
  const auditId = ids.newId();
  expect(
    await dispatcher.clearReminderSchedulesLostFlag({
      flagId: ids.newId(),
      rebuiltRunId: RUN_ID,
      rebuiltPassId: PASS_ID,
      companiesRebuilt: 1,
      auditId,
    }),
  ).toBe(false);
  const otherFlag = ids.newId();
  expect(
    await dispatcher.raiseRecoveryFlag(otherFlag, OTHER_CODE),
  ).toMatchObject({ raised: true });
  expect(
    await dispatcher.clearReminderSchedulesLostFlag({
      flagId: otherFlag,
      rebuiltRunId: RUN_ID,
      rebuiltPassId: PASS_ID,
      companiesRebuilt: 1,
      auditId,
    }),
  ).toBe(false);
  expect(await owner`SELECT id FROM public.platform_audit_log WHERE id = ${auditId}::uuid`).toEqual(
    [],
  );
});

it('ADR-0061 §3: a failed audit insert leaves the flag open', async () => {
  const flagId = await freshReminderFlag();
  // مُعرّف تدقيق مستخدم قبل كده: الإدراج يفشل، فالمعاملة كلها تتراجع.
  const auditId = ids.newId();
  await owner`INSERT INTO public.platform_audit_log (id, actor, action, details)
    VALUES (${auditId}::uuid, 'system:worker', 'recovery.flag_cleared', '{}'::jsonb)`;
  await expect(
    dispatcher.clearReminderSchedulesLostFlag({
      flagId,
      rebuiltRunId: RUN_ID,
      rebuiltPassId: PASS_ID,
      companiesRebuilt: 2,
      auditId,
    }),
  ).rejects.toThrow();
  expect((await dispatcher.openRecoveryFlags()).some((flag) => flag.id === flagId)).toBe(true);
});

it('#1222 item 2: the cutoff carries the monotonic outbox fence, snapshot and database clock', async () => {
  // العتبة بتتقري الأول، وبعدين السطر بيتكتب: الـ seq والـ snapshot هما اللي بيحددوا «بعد العتبة».
  const cutoff = await dispatcher.sampleReminderRecoveryCutoff();
  expect(cutoff.maxOutboxSeq).toMatch(/^\d+@\d+:\d+:[\d,]*$/);
  expect(cutoff.cutoff).toBeInstanceOf(Date);
  const companyId = COMPANY_A;
  await owner`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload, parked_at)
    VALUES (${companyId}::uuid, ${ids.newId()}::uuid, 'company', ${companyId}::uuid, 'CompanyCreated',
      '{}'::jsonb, pg_catalog.statement_timestamp())`;
  const page = await dispatcher.parkedCompanyCreatedAfter(cutoff.cutoff, cutoff.maxOutboxSeq);
  expect(page.companyIds).toContain(companyId);
  expect(page.dbNow).toBeInstanceOf(Date);
});

it('#1222 item 2: a row parked before the cutoff is still caught by the seq fence', async () => {
  // العتبة قبل السطر، بس وقت الـ park قديم: ده رجوع ساعة، والـ seq السور لازم يلمس الصف.
  const cutoff = await dispatcher.sampleReminderRecoveryCutoff();
  const companyId = COMPANY_B;
  const rowId = ids.newId();
  await owner`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload, parked_at)
    VALUES (${companyId}::uuid, ${rowId}::uuid, 'company', ${companyId}::uuid, 'CompanyCreated',
      '{}'::jsonb, '2026-10-01T08:00:00Z'::timestamptz)`;
  const [row] = await owner<{ seq: string }[]>`
    SELECT seq::text AS seq FROM outbox WHERE company_id = ${companyId}::uuid AND id = ${rowId}::uuid`;
  const page = await dispatcher.parkedCompanyCreatedAfter(cutoff.cutoff, cutoff.maxOutboxSeq);
  expect(page.companyIds).toContain(companyId);
  // سور أعلى من الـ seq بتاع الصف: الشرطان بيبقوا غلط، فالصف بيخرج من النافذة.
  const beyond = await dispatcher.parkedCompanyCreatedAfter(cutoff.cutoff, row?.seq as string);
  expect(beyond.companyIds).not.toContain(companyId);
});

/** يفتح معاملة متزامنة، يزرع حدث شركة بدون التزام، وبعدين يلتزم بعد قراءة العتبة لاختبار الـ snapshot. */
async function insertOpenThenParkAfterCutoff(inFlightCompanyId: string): Promise<Awaited<ReturnType<typeof dispatcher.sampleReminderRecoveryCutoff>>> {
  const t1Sql = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  const t1RowId = ids.newId();
  let markInserted!: () => void;
  let releaseCommit!: () => void;
  const inserted = new Promise<void>((resolve) => { markInserted = resolve; });
  const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
  const t1Tx = t1Sql.begin(async (tx) => {
    await tx`INSERT INTO companies (id, name_en, owner_user_id, plan_id)
      VALUES (${inFlightCompanyId}::uuid, 'In-flight Company', '01920000-0000-7000-8000-0000000000f2', ${PROVISIONAL_PLAN_ID}::uuid)`;
    await tx`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload, parked_at)
      VALUES (${inFlightCompanyId}::uuid, ${t1RowId}::uuid, 'company', ${inFlightCompanyId}::uuid, 'CompanyCreated', '{}'::jsonb,
        '2026-10-01T08:00:00Z'::timestamptz)`;
    markInserted();
    await commitGate;
  });
  await inserted;
  try {
    await owner`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload)
      VALUES (${COMPANY_A}::uuid, ${ids.newId()}::uuid, 'company', ${COMPANY_A}::uuid, 'CompanyCreated', '{}'::jsonb)`;
    const cutoff = await dispatcher.sampleReminderRecoveryCutoff();
    releaseCommit();
    await t1Tx;
    return cutoff;
  } finally {
    releaseCommit();
    await t1Sql.end();
  }
}

it('#1222 item 2: a transaction open when C is sampled commits and parks with regressed clock and is still caught', async () => {
  const inFlightCompany = ids.newId();
  const cutoff = await insertOpenThenParkAfterCutoff(inFlightCompany);
  const page = await dispatcher.parkedCompanyCreatedAfter(cutoff.cutoff, cutoff.maxOutboxSeq);
  expect(page.companyIds).toContain(inFlightCompany);
});
