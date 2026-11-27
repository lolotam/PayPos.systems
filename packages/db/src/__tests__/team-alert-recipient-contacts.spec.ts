import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withClusterRoleLock } from '../../test/role-lock.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { SYSTEM_ROLES } from '../access-catalog.ts';

// ADR-0003 §6a (AL-Q6، صف 62b-1): دالة قراءة جهات اتصال تنبيهات الفريق ودورها يُختبران بالأدوار الفعلية على شركتين.
const { A, B } = TENANT;
const FN = 'public.team_alert_recipient_contacts(uuid,uuid[],timestamptz,boolean)';
const ROLE = 'pospay_team_contact_reader';
const VIEWER = SYSTEM_ROLES.find((role) => role.code === 'viewer')?.id ?? '';
const uid = (n: number) => `01920000-0000-7000-8000-0000000062${String(n).padStart(2, '0')}`;
const MEMBER = {
  multi: uid(1),
  unverified: uid(2),
  unapprovedPhone: uid(3),
  staffColumn: uid(4),
  staffEmail: uid(5),
  foreign: uid(6),
  ended: uid(7),
  nothing: uid(8),
  outsider: uid(9),
  unverifiedPhone: uid(10),
};
const ALL = Object.values(MEMBER);
const NOW = new Date();

let test: TestDatabase;
let owner: postgres.Sql;
let app: postgres.Sql;

beforeAll(async () => {
  test = await createTestDatabase();
  await seedTwoTenants(test.ownerUrl);
  owner = postgres(test.ownerUrl, { max: 1, onnotice: () => undefined });
  app = postgres(test.appUrl, { max: 1, onnotice: () => undefined });
  const users: [string, string, boolean, string | null, boolean][] = [
    [MEMBER.multi, 'multi@example.test', true, '+999999620001', true],
    [MEMBER.unverified, 'unverified@example.test', false, null, false],
    [MEMBER.unapprovedPhone, 'unapproved-phone@example.test', true, '+999999620003', false],
    [MEMBER.staffColumn, 'staff-column@example.test', true, null, false],
    [MEMBER.staffEmail, 'Agent@STAFF.POSPAY.INVALID', true, '+999999620005', true],
    [MEMBER.foreign, 'foreign@example.test', true, null, false],
    [MEMBER.ended, 'ended@example.test', true, null, false],
    [MEMBER.nothing, 'nothing@example.test', false, null, false],
    [MEMBER.outsider, 'outsider@example.test', true, null, false],
    [MEMBER.unverifiedPhone, 'unverified-phone@example.test', false, '+999999620010', true],
  ];
  for (const [id, email, verified, phone, approved] of users) {
    await owner`INSERT INTO "user" (id, name, email, email_verified, phone_number, phone_binding_approved_at)
      VALUES (${id}, 'Synthetic member', ${email}, ${verified}, ${phone}, ${approved ? NOW : null})`;
  }
  await owner`UPDATE "user" SET staff_access_company_id = ${A.company},
    staff_access_operation_id = '01920000-0000-7000-8000-000000006299' WHERE id = ${MEMBER.staffColumn}`;
  const grant = async (
    company: string,
    id: string,
    user: string,
    scope: ['COMPANY', string] | ['BUSINESS', string],
    window: { startsDaysAgo: number; endsDaysAgo: number | null } = {
      startsDaysAgo: 2,
      endsDaysAgo: null,
    },
  ) => {
    await owner`INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id,
        starts_at, ends_at)
      VALUES (${company}, ${id}, ${user}, ${VIEWER}, 'global', ${scope[0]}, ${scope[1]},
        now() - make_interval(days => ${window.startsDaysAgo}),
        ${window.endsDaysAgo === null ? null : owner`now() - make_interval(days => ${window.endsDaysAgo})`})`;
  };
  await grant(A.company, uid(51), MEMBER.multi, ['COMPANY', A.company]);
  await grant(A.company, uid(52), MEMBER.multi, ['BUSINESS', A.business]);
  for (const [i, user] of [
    MEMBER.unverified,
    MEMBER.unapprovedPhone,
    MEMBER.staffColumn,
    MEMBER.staffEmail,
    MEMBER.nothing,
  ].entries()) {
    await grant(A.company, uid(60 + i), user, ['COMPANY', A.company]);
  }
  await grant(A.company, uid(80), MEMBER.unverifiedPhone, ['COMPANY', A.company]);
  await grant(B.company, uid(70), MEMBER.foreign, ['COMPANY', B.company]);
  await grant(A.company, uid(71), MEMBER.ended, ['COMPANY', A.company], {
    startsDaysAgo: 3,
    endsDaysAgo: 1,
  });
});

afterAll(async () => {
  await app.end();
  await owner.end();
  await test.drop();
});

interface Contact {
  user_id: string;
  email: string | null;
  phone_number: string | null;
}

/** يستدعي الدالة كـ pospay_app داخل معاملة بسياق شركة (أو بلا سياق عند null)، مثل withTenant تمامًا. */
async function call(
  company: string | null,
  args: {
    companyId?: string | null;
    ids?: string[] | null;
    at?: Date | null;
    requireVerified?: boolean | null;
  },
): Promise<Contact[]> {
  const companyId = args.companyId === undefined ? company : args.companyId;
  const ids = args.ids === undefined ? ALL : args.ids;
  const at = args.at === undefined ? NOW : args.at;
  const requireVerified = args.requireVerified === undefined ? true : args.requireVerified;
  return (await app.begin(async (tx) => {
    if (company !== null) await tx`SELECT set_config('app.company_id', ${company}, true)`;
    return tx<Contact[]>`SELECT user_id, email, phone_number FROM public.team_alert_recipient_contacts(
      ${companyId}::uuid, ${ids === null ? null : tx.array(ids)}::uuid[],
      ${at === null ? null : at.toISOString()}::timestamptz, ${requireVerified}::boolean)`;
  })) as unknown as Contact[];
}

/** ids صالحة الشكل ومالهاش أصحاب، لاختبار حد المئة. */
const filler = (count: number) =>
  Array.from({ length: count }, (_, i) => `01920000-0000-7000-8000-${String(i + 1).padStart(12, '0')}`);
const byUser = (rows: Contact[]) => new Map(rows.map((row) => [row.user_id, row]));

describe('the role and who may execute the function', () => {
  it('has the ADR-0003 §6a attributes, is a member of nothing and has no members', async () => {
    const [role, links] = await withClusterRoleLock('shared', async () => [
      (
        await owner`SELECT rolcanlogin, rolsuper, rolbypassrls, rolinherit, rolcreatedb,
        rolcreaterole, rolreplication FROM pg_roles WHERE rolname = ${ROLE}`
      )[0],
      await owner`SELECT 1 FROM pg_auth_members a JOIN pg_roles r ON r.oid IN (a.roleid, a.member)
        WHERE r.rolname = ${ROLE}`,
    ]);
    expect(role).toEqual({
      rolcanlogin: false,
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
    });
    expect(links).toHaveLength(0);
  });

  it('owns the function and no table, and only pospay_app (besides the owner) may execute it', async () => {
    const [owned, tables, grantees] = await withClusterRoleLock('shared', async () => [
      (await owner`SELECT pg_get_userbyid(proowner) AS owner, prosecdef FROM pg_proc
        WHERE proname = 'team_alert_recipient_contacts'`)[0],
      await owner`SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
        WHERE c.relnamespace = 'public'::regnamespace AND r.rolname = ${ROLE}`,
      await owner<{ grantee: string }[]>`SELECT coalesce(r.rolname, 'PUBLIC') AS grantee
        FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) x
        LEFT JOIN pg_roles r ON r.oid = x.grantee
        WHERE p.proname = 'team_alert_recipient_contacts' AND x.privilege_type = 'EXECUTE'
        ORDER BY 1`,
    ]);
    expect(owned).toEqual({ owner: ROLE, prosecdef: true });
    expect(tables).toHaveLength(0);
    expect(grantees?.map((g: { grantee: string }) => g.grantee)).toEqual([
      'pospay_app',
      ROLE,
    ]);
  });

  it.each(['pospay_auth', 'pospay_dispatcher', 'pospay_notifications'])(
    '%s cannot execute it',
    async (role) => {
      const [row] = await owner`SELECT has_function_privilege(${role}, ${FN}, 'EXECUTE') AS can`;
      expect(row).toEqual({ can: false });
    },
  );

});

describe('the grants of the role', () => {
  it('pospay_app holds no direct privilege on the user table, only the definer reaches a contact', async () => {
    const [row] = await owner`SELECT
      has_table_privilege('pospay_app', 'public."user"', 'SELECT') AS table_select,
      has_any_column_privilege('pospay_app', 'public."user"', 'SELECT') AS column_select`;
    expect(row).toEqual({ table_select: false, column_select: false });
  });

  it('the role reads six user columns and four membership columns, never a whole table', async () => {
    const [row] = await owner`SELECT
      has_table_privilege(${ROLE}, 'public."user"', 'SELECT') AS user_table,
      has_table_privilege(${ROLE}, 'public.memberships', 'SELECT') AS memberships_table,
      has_column_privilege(${ROLE}, 'public."user"', 'email', 'SELECT') AS email,
      has_column_privilege(${ROLE}, 'public."user"', 'name', 'SELECT') AS name,
      has_column_privilege(${ROLE}, 'public."user"', 'image', 'SELECT') AS image,
      has_column_privilege(${ROLE}, 'public.memberships', 'ends_at', 'SELECT') AS ends_at,
      has_column_privilege(${ROLE}, 'public.memberships', 'role_id', 'SELECT') AS role_id,
      has_column_privilege(${ROLE}, 'public.memberships', 'limit_bps', 'SELECT') AS limit_bps`;
    expect(row).toEqual({
      user_table: false,
      memberships_table: false,
      email: true,
      name: false,
      image: false,
      ends_at: true,
      role_id: false,
      limit_bps: false,
    });
  });

  it('its membership policy shows one tenant only', async () => {
    const rows = await owner.begin(async (tx) => {
      await tx`SET LOCAL ROLE pospay_team_contact_reader`;
      await tx`SELECT set_config('app.company_id', ${A.company}, true)`;
      return tx`SELECT DISTINCT company_id FROM public.memberships`;
    });
    expect(rows.map((r) => r['company_id'])).toEqual([A.company]);
  });
});

describe('what the function returns', () => {
  it('returns one row per user even when the user holds several active memberships', async () => {
    const rows = await call(A.company, { ids: [MEMBER.multi] });
    expect(rows).toEqual([
      { user_id: MEMBER.multi, email: 'multi@example.test', phone_number: '+999999620001' },
    ]);
  });

  it('drops a member whose membership already ended, even for a historic p_at inside the old window', async () => {
    const historic = new Date(Date.now() - 36 * 3_600_000);
    expect(await call(A.company, { ids: [MEMBER.ended], at: historic })).toEqual([]);
    expect(await call(A.company, { ids: [MEMBER.ended] })).toEqual([]);
  });

  it('withholds the email of a synthetic staff user, by column and by the staff domain in any case', async () => {
    const rows = byUser(await call(A.company, {}));
    expect(rows.has(MEMBER.staffColumn)).toBe(false);
    expect(rows.get(MEMBER.staffEmail)).toEqual({
      user_id: MEMBER.staffEmail,
      email: null,
      phone_number: '+999999620005',
    });
  });

  it('withholds a phone number without an approved binding, and keeps the email', async () => {
    const rows = byUser(await call(A.company, {}));
    expect(rows.get(MEMBER.unapprovedPhone)).toEqual({
      user_id: MEMBER.unapprovedPhone,
      email: 'unapproved-phone@example.test',
      phone_number: null,
    });
  });

  it('returns no row for a foreign tenant user, a non-member, or a member without any deliverable contact', async () => {
    const rows = byUser(await call(A.company, {}));
    expect(rows.has(MEMBER.foreign)).toBe(false);
    expect(rows.has(MEMBER.outsider)).toBe(false);
    expect(rows.has(MEMBER.nothing)).toBe(false);
    expect([...rows.keys()].sort()).toEqual(
      [MEMBER.multi, MEMBER.staffEmail, MEMBER.unapprovedPhone, MEMBER.unverifiedPhone].sort(),
    );
  });

  it('sees the foreign user only inside the tenant that owns the membership', async () => {
    expect(await call(A.company, { ids: [MEMBER.foreign] })).toEqual([]);
    const rows = await call(B.company, { ids: [MEMBER.foreign, MEMBER.multi] });
    expect(rows.map((r) => r.user_id)).toEqual([MEMBER.foreign]);
  });

  it('returns an empty array for an empty id list', async () => {
    expect(await call(A.company, { ids: [] })).toEqual([]);
  });
});

describe('the email_verified switch (GR-003(d))', () => {
  it('requireVerifiedEmail = true hides the email of an unverified invitee and keeps a verified one', async () => {
    const rows = byUser(await call(A.company, { requireVerified: true }));
    expect(rows.has(MEMBER.unverified)).toBe(false);
    expect(rows.get(MEMBER.multi)?.email).toBe('multi@example.test');
  });

  it('requireVerifiedEmail = true still returns an approved phone for an unverified member', async () => {
    const rows = byUser(await call(A.company, { requireVerified: true }));
    expect(rows.get(MEMBER.unverifiedPhone)).toEqual({
      user_id: MEMBER.unverifiedPhone,
      email: null,
      phone_number: '+999999620010',
    });
  });

  it('requireVerifiedEmail = false returns the email of the same unverified member', async () => {
    const rows = byUser(await call(A.company, { requireVerified: false }));
    expect(rows.get(MEMBER.unverified)).toEqual({
      user_id: MEMBER.unverified,
      email: 'unverified@example.test',
      phone_number: null,
    });
    expect(rows.get(MEMBER.nothing)?.email).toBe('nothing@example.test');
    expect(rows.get(MEMBER.unverifiedPhone)?.email).toBe('unverified-phone@example.test');
  });

  it('requireVerifiedEmail = false never lifts the staff-email or unapproved-phone rules', async () => {
    const rows = byUser(await call(A.company, { requireVerified: false }));
    expect(rows.has(MEMBER.staffColumn)).toBe(false);
    expect(rows.get(MEMBER.staffEmail)?.email).toBeNull();
    expect(rows.get(MEMBER.unapprovedPhone)?.phone_number).toBeNull();
  });
});

describe('invalid calls are refused with 22023', () => {
  const refused = { code: '22023' };

  it('refuses a call outside a tenant transaction', async () => {
    await expect(call(null, { companyId: A.company })).rejects.toMatchObject(refused);
  });

  it('refuses a NULL or mismatched company id', async () => {
    await expect(call(A.company, { companyId: null })).rejects.toMatchObject(refused);
    await expect(call(A.company, { companyId: B.company })).rejects.toMatchObject(refused);
  });

  it('refuses a NULL p_at', async () => {
    await expect(call(A.company, { at: null })).rejects.toMatchObject(refused);
  });

  it('refuses a NULL id list and a list longer than 100', async () => {
    await expect(call(A.company, { ids: null })).rejects.toMatchObject(refused);
    await expect(call(A.company, { ids: filler(101) })).rejects.toMatchObject(refused);
  });

  it('accepts exactly 100 ids', async () => {
    await expect(call(A.company, { ids: filler(100) })).resolves.toEqual([]);
  });

  it('refuses a NULL requireVerifiedEmail', async () => {
    await expect(call(A.company, { requireVerified: null })).rejects.toMatchObject(refused);
  });
});
