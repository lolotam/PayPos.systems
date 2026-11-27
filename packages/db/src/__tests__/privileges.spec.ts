import { TENANT_TABLES } from '../../test/tenant-table-inventory.ts';
import {
  COMMISSION_BLOCKED_CORRECTION_COLUMN_GRANTS,
  COMMISSION_BLOCKED_CORRECTION_INSERT_COLUMN_GRANTS,
  COMMISSION_CORRECTION_COLUMN_GRANTS,
} from '../../test/commission-correction-grants.ts';
import { COMMISSION_TIP_SALARY_COLUMN_GRANTS } from '../../test/commission-tip-salary-grants.ts';
import { COMMISSION_SALES_COLUMN_GRANTS } from '../../test/commission-sales-grants.ts';
import { PASSKEY_COLUMN_GRANTS } from '../../test/passkey-grants.ts';
import {
  ATTENDANCE_CHANGE_COLUMN_GRANTS,
  BREAK_LEDGER_COLUMN_GRANTS,
  testAttendanceDecisionPrivileges,
} from '../../test/attendance-grants.ts';
import { EMPLOYEE_COLUMN_GRANTS } from '../../test/employee-grants.ts';
import { OTP_COLUMN_GRANTS } from '../../test/otp-grants.ts';
import { FILE_COLUMN_GRANTS } from '../../test/files-grants.ts';
import { SCHEDULE_COLUMN_GRANTS } from '../../test/schedule-grants.ts';
import { LEAVE_COLUMN_GRANTS } from '../../test/leave-grants.ts';
import { LEAVE_HISTORY_REPORT_COLUMN_GRANTS } from '../../test/leave-history-report-grants.ts';
import { DOCUMENT_COLUMN_GRANTS } from '../../test/document-grants.ts';
import { IMPORT_COLUMN_GRANTS } from '../../test/import-grants.ts';
import { CARD_COLUMN_GRANTS } from '../../test/card-grants.ts';
import {
  SERVICE_COLUMN_GRANTS,
  PACKAGE_TYPE_COLUMN_GRANTS,
  SERVICE_CATEGORY_COLUMN_GRANTS,
  SERVICE_CATEGORY_BRANCH_SETTING_COLUMN_GRANTS,
  SERVICE_CATEGORY_CLOSING_COLUMN_GRANTS,
} from '../../test/catalog-grants.ts';
import { PACKAGE_COLUMN_GRANTS } from '../../test/package-grants.ts';
import { SERVICE_LINE_EDIT_COLUMN_GRANTS } from '../../test/service-line-edit-grants.ts';
import { SERVICE_LINE_CANCEL_COLUMN_GRANTS } from '../../test/service-line-cancel-grants.ts';
import { SERVICE_LINE_PERFORMER_COLUMN_GRANTS } from '../../test/service-line-performer-grants.ts';
import { ALERT_RULE_COLUMN_GRANTS } from '../../test/alert-rule-grants.ts';
import { PUSH_SUBSCRIPTION_COLUMN_GRANTS } from '../../test/push-subscription-grants.ts';
import { PUSH_ATTEMPT_COLUMN_GRANTS } from '../../test/push-attempt-grants.ts';
import { DISCOUNT_PROPOSAL_COLUMN_GRANTS } from '../../test/discount-proposal-grants.ts';
import { COMMISSION_STATEMENT_COLUMN_GRANTS } from '../../test/commission-statement-grants.ts';
import {
  RATING_REQUEST_COLUMN_GRANTS,
  RATING_SETTINGS_COLUMN_GRANTS,
} from '../../test/rating-grants.ts';
import { CUSTOMER_COLUMN_GRANTS } from '../../test/customer-grants.ts';
import { ALLOWED_TABLE_GRANTS } from '../../test/table-grants.ts';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withClusterRoleLock } from '../../test/role-lock.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

// The reviewed table grant allowlist lives in test/table-grants.ts, beside the other grant lists.
// The dispatcher may change delivery metadata only — id, company_id and payload stay immutable to it.
const RECOVERY_COLUMN_GRANTS = [
  'service_session_recoveries.committed_at:pospay_app:UPDATE',
  'service_session_recoveries.expires_at:pospay_app:UPDATE',
  'service_session_recoveries.last_seen_at:pospay_app:UPDATE',
  'service_session_recoveries.revoked_at:pospay_app:UPDATE',
  'service_session_recoveries.revoked_outcome:pospay_app:UPDATE',
  'service_session_recoveries.session_id:pospay_app:UPDATE',
];
const OUTBOX_COLUMN_GRANTS = [
  'outbox.attempts:pospay_dispatcher:UPDATE',
  'outbox.last_error:pospay_dispatcher:UPDATE',
  'outbox.next_attempt_at:pospay_dispatcher:UPDATE',
  'outbox.parked_at:pospay_dispatcher:UPDATE',
  'outbox.published_at:pospay_dispatcher:UPDATE',
];
// عدّاد الاعتماد (ADR-0012 §2): قراءة الأعمدة السبعة فقط، وبلا payload ولا أي كتابة.
const APPROVAL_READER_COLUMN_GRANTS = [
  'consumed_events.company_id:pospay_approval_reader:SELECT',
  'consumed_events.consumer_id:pospay_approval_reader:SELECT',
  'consumed_events.event_id:pospay_approval_reader:SELECT',
  'outbox.company_id:pospay_approval_reader:SELECT',
  'outbox.created_at:pospay_approval_reader:SELECT',
  'outbox.event_type:pospay_approval_reader:SELECT',
  'outbox.id:pospay_approval_reader:SELECT',
];
// إثبات تغطية العمولات (ADR-0054 إضافة 2026-11-22): دور الدوال يقرأ أعمدة محدّدة لا غير (لا payload ولا created_at)،
// ويحدّث ثلاثة أعمدة من صف الحالة فقط.
const COVERAGE_ISSUER_COLUMN_GRANTS = [
  'businesses.company_id:pospay_coverage_issuer:SELECT',
  'businesses.id:pospay_coverage_issuer:SELECT',
  'commission_coverage_state.bumped_at:pospay_coverage_issuer:UPDATE',
  'commission_coverage_state.generation:pospay_coverage_issuer:UPDATE',
  'commission_coverage_state.reason:pospay_coverage_issuer:UPDATE',
  'companies.deleted_at:pospay_coverage_issuer:SELECT',
  'companies.id:pospay_coverage_issuer:SELECT',
  'consumed_events.company_id:pospay_coverage_issuer:SELECT',
  'consumed_events.consumer_id:pospay_coverage_issuer:SELECT',
  'consumed_events.event_id:pospay_coverage_issuer:SELECT',
  'outbox.company_id:pospay_coverage_issuer:SELECT',
  'outbox.event_type:pospay_coverage_issuer:SELECT',
  'outbox.id:pospay_coverage_issuer:SELECT',
];
// استعادة جدولة التذكيرات (ADR-0061 §1): دور القارئ يقرأ عمود id من companies بس، ودور المسّاح يحدّث عمودين من
// جدول العلامات ويسجّل سطر تدقيق واحد، والمرسّل يرفع العلامات بثلاثة أعمدة بس.
const RECOVERY_ROLE_COLUMN_GRANTS = [
  'companies.id:pospay_recovery_company_reader:SELECT',
  'operational_recovery_flags.cleared_at:pospay_recovery_flag_clearer:UPDATE',
  'operational_recovery_flags.cleared_by:pospay_recovery_flag_clearer:UPDATE',
  'operational_recovery_flags.code:pospay_dispatcher:INSERT',
  'operational_recovery_flags.id:pospay_dispatcher:INSERT',
  'operational_recovery_flags.raised_at:pospay_dispatcher:INSERT',
];
// قراءة جهات اتصال تنبيهات الفريق (ADR-0003 §6a، AL-Q6): ستة أعمدة من user وأربعة من memberships، بلا أي صلاحية جدول كامل.
const TEAM_CONTACT_READER_COLUMN_GRANTS = [
  'memberships.company_id:pospay_team_contact_reader:SELECT',
  'memberships.ends_at:pospay_team_contact_reader:SELECT',
  'memberships.starts_at:pospay_team_contact_reader:SELECT',
  'memberships.user_id:pospay_team_contact_reader:SELECT',
  'user.email:pospay_team_contact_reader:SELECT',
  'user.email_verified:pospay_team_contact_reader:SELECT',
  'user.id:pospay_team_contact_reader:SELECT',
  'user.phone_binding_approved_at:pospay_team_contact_reader:SELECT',
  'user.phone_number:pospay_team_contact_reader:SELECT',
  'user.staff_access_company_id:pospay_team_contact_reader:SELECT',
];
const REVIEWED_COLUMN_GRANTS = [
  ...APPROVAL_READER_COLUMN_GRANTS,
  ...TEAM_CONTACT_READER_COLUMN_GRANTS,
  ...COVERAGE_ISSUER_COLUMN_GRANTS,
  ...RECOVERY_ROLE_COLUMN_GRANTS,
  ...COMMISSION_TIP_SALARY_COLUMN_GRANTS,
  ...COMMISSION_SALES_COLUMN_GRANTS,
  ...COMMISSION_CORRECTION_COLUMN_GRANTS,
  ...COMMISSION_BLOCKED_CORRECTION_COLUMN_GRANTS,
  ...COMMISSION_BLOCKED_CORRECTION_INSERT_COLUMN_GRANTS,
  ...OTP_COLUMN_GRANTS,
  ...ATTENDANCE_CHANGE_COLUMN_GRANTS,
  ...BREAK_LEDGER_COLUMN_GRANTS,
  ...LEAVE_COLUMN_GRANTS,
  ...LEAVE_HISTORY_REPORT_COLUMN_GRANTS,
  ...FILE_COLUMN_GRANTS,
  ...OUTBOX_COLUMN_GRANTS,
  ...RECOVERY_COLUMN_GRANTS,
  ...EMPLOYEE_COLUMN_GRANTS,
  'employees.name_en_key:pospay_app:UPDATE',
  'employees.name_ar_key:pospay_app:UPDATE',
  ...SCHEDULE_COLUMN_GRANTS,
  ...PASSKEY_COLUMN_GRANTS,
  ...DOCUMENT_COLUMN_GRANTS,
  ...IMPORT_COLUMN_GRANTS,
  ...CARD_COLUMN_GRANTS,
  ...SERVICE_COLUMN_GRANTS,
  ...PACKAGE_TYPE_COLUMN_GRANTS,
  ...SERVICE_CATEGORY_COLUMN_GRANTS,
  ...SERVICE_CATEGORY_BRANCH_SETTING_COLUMN_GRANTS,
  ...SERVICE_CATEGORY_CLOSING_COLUMN_GRANTS,
  ...PACKAGE_COLUMN_GRANTS,
  ...SERVICE_LINE_EDIT_COLUMN_GRANTS,
  ...SERVICE_LINE_PERFORMER_COLUMN_GRANTS,
  ...SERVICE_LINE_CANCEL_COLUMN_GRANTS,
  ...ALERT_RULE_COLUMN_GRANTS,
  ...PUSH_SUBSCRIPTION_COLUMN_GRANTS,
  ...PUSH_ATTEMPT_COLUMN_GRANTS,
  ...DISCOUNT_PROPOSAL_COLUMN_GRANTS,
  ...COMMISSION_STATEMENT_COLUMN_GRANTS,
  ...RATING_REQUEST_COLUMN_GRANTS,
  ...RATING_SETTINGS_COLUMN_GRANTS,
  ...CUSTOMER_COLUMN_GRANTS,
];

const APP_ROLES = [
  'pospay_app',
  'pospay_auth',
  'pospay_dispatcher',
  'pospay_approval_reader',
  'pospay_team_contact_reader',
  'pospay_coverage_issuer',
  'pospay_recovery_company_reader',
  'pospay_recovery_flag_clearer',
];
const IDENTITY_TABLES = [
  'passkey',
  'auth_otp_challenges',
  'auth_notification_attempts',
  'user',
  'session',
  'account',
  'verification',
  'two_factor',
  'platform_grants',
  'platform_audit_log',
  'platform_roles',
];

let testDb: TestDatabase;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await owner.end();
  await testDb.drop();
});

// Reads the ACLs themselves: information_schema.role_table_grants leaves out grants to PUBLIC, and
// a PUBLIC TRUNCATE would bypass RLS on every tenant's rows.
const aclGrants = (grantee: string) => {
  // 0 is PUBLIC in an ACL. A role is looked up by name and must exist — an unknown name is an error,
  // never silently treated as PUBLIC.
  const who = grantee === 'PUBLIC' ? owner`0::oid` : owner`${grantee}::regrole::oid`;
  return owner<{ grant: string }[]>`
    SELECT c.relname || ':' || a.privilege_type AS grant
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
      AND a.grantee = ${who}
    ORDER BY 1`;
};

describe('direct privileges match the reviewed allowlist', () => {
  it.each(APP_ROLES)('%s holds exactly the listed table and sequence grants', async (role) => {
    expect((await aclGrants(role)).map((r) => r.grant)).toEqual(ALLOWED_TABLE_GRANTS[role]);
  });

  it('PUBLIC holds no privilege on any table, view or sequence', async () => {
    expect(await aclGrants('PUBLIC')).toEqual([]);
  });

  it('column grants match the reviewed employee, OTP, file verification and outbox allowlists', async () => {
    const rows = await owner<{ grant: string }[]>`
      SELECT c.relname || '.' || a.attname || ':' || coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type AS grant
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      CROSS JOIN LATERAL aclexplode(a.attacl) x LEFT JOIN pg_roles r ON r.oid = x.grantee
      WHERE c.relnamespace = 'public'::regnamespace AND a.attacl IS NOT NULL
      ORDER BY 1`;
    expect(
      rows
        .filter(
          (r) =>
            !r.grant.startsWith('platform_whatsapp_') &&
            !r.grant.startsWith('platform_email_'),
        )
        .map((r) => r.grant),
    ).toEqual([...REVIEWED_COLUMN_GRANTS].sort());
  });

  it.each(APP_ROLES)(
    '%s may use the public schema but not create in it or in the database',
    async (role) => {
      const [row] = await owner`
      SELECT has_schema_privilege(${role}, 'public', 'USAGE') AS usage,
             has_schema_privilege(${role}, 'public', 'CREATE') AS create_in_schema,
             has_database_privilege(${role}, current_database(), 'CREATE') AS create_in_db`;
      expect(row).toEqual({ usage: true, create_in_schema: false, create_in_db: false });
    },
  );
});

// Effective privileges — what the role can actually do, including anything inherited through a role
// membership. Compared with the same reviewed allowlist, so an inherited grant fails the suite too.
const TABLE_PRIVILEGES = [
  'DELETE',
  'INSERT',
  'REFERENCES',
  'SELECT',
  'TRIGGER',
  'TRUNCATE',
  'UPDATE',
];
const SEQUENCE_PRIVILEGES = ['SELECT', 'UPDATE', 'USAGE'];
const effectiveGrants = async (role: string): Promise<string[]> => {
  const rows = await owner<{ grant: string }[]>`
    SELECT c.relname || ':' || p AS grant
    FROM pg_class c CROSS JOIN unnest(${TABLE_PRIVILEGES}::text[]) AS p
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND has_table_privilege(${role}, c.oid, p)
    UNION ALL
    SELECT c.relname || ':' || p FROM pg_class c CROSS JOIN unnest(${SEQUENCE_PRIVILEGES}::text[]) AS p
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
      AND has_sequence_privilege(${role}, c.oid, p)
    ORDER BY 1`;
  return rows.map((r) => r.grant);
};

describe('effective privileges match the reviewed allowlist', () => {
  it.each(APP_ROLES)('%s can do exactly what the allowlist says, no more', async (role) => {
    // Shared lock: another spec file may be holding a temporary membership under the exclusive one.
    expect(await withClusterRoleLock('shared', () => effectiveGrants(role))).toEqual(
      ALLOWED_TABLE_GRANTS[role],
    );
  });

  it('an inherited grant is caught — DELETE on plans through a helper role', async () => {
    await withClusterRoleLock('exclusive', async () => {
      try {
        await owner`CREATE ROLE pospay_test_helper NOLOGIN`;
        await owner`GRANT DELETE ON plans TO pospay_test_helper`;
        await owner`GRANT pospay_test_helper TO pospay_app WITH INHERIT TRUE`;
        expect(await effectiveGrants('pospay_app')).toContain('plans:DELETE');
      } finally {
        await owner`REVOKE ALL ON plans FROM pospay_test_helper`;
        await owner`DROP ROLE IF EXISTS pospay_test_helper`;
      }
    });
  });
});

// A role the application can SET ROLE to is a way around every check above, even without inheritance.
const settableRoles = async (role: string): Promise<string[]> =>
  (
    await owner<{ name: string }[]>`SELECT rolname AS name FROM pg_roles
    WHERE rolname <> ${role} AND pg_has_role(${role}, oid, 'SET') ORDER BY 1`
  ).map((r) => r.name);

describe('no application role can switch to another role', () => {
  it.each(APP_ROLES)('%s can SET ROLE to no other role, directly or indirectly', async (role) => {
    expect(await withClusterRoleLock('shared', () => settableRoles(role))).toEqual([]);
  });

  it('a non-inheriting membership is caught — INHERIT FALSE, SET TRUE', async () => {
    await withClusterRoleLock('exclusive', async () => {
      try {
        await owner`CREATE ROLE pospay_test_settable NOLOGIN`;
        await owner`GRANT pospay_test_settable TO pospay_app WITH INHERIT FALSE, SET TRUE`;
        expect(await settableRoles('pospay_app')).toEqual(['pospay_test_settable']);
      } finally {
        await owner`DROP ROLE IF EXISTS pospay_test_settable`;
      }
    });
  });
});

describe('effective access', () => {
  testAttendanceDecisionPrivileges(() => owner);
  it('neither pospay_app, pospay_dispatcher, pospay_approval_reader, pospay_coverage_issuer nor pospay_team_contact_reader can reach a global-identity table as a whole', async () => {
    const rows = await withClusterRoleLock(
      'shared',
      () => owner<{ role: string; table: string }[]>`
      SELECT r AS role, t AS table
      FROM unnest(${['pospay_app', 'pospay_dispatcher', 'pospay_approval_reader', 'pospay_coverage_issuer', 'pospay_team_contact_reader']}::text[]) AS r, unnest(${IDENTITY_TABLES}::text[]) AS t
      WHERE has_table_privilege(r, quote_ident(t), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')`,
    );
    expect(rows).toEqual([]);
  });

  it('pospay_auth reaches no tenant table and no reference table', async () => {
    const rows = await withClusterRoleLock(
      'shared',
      () => owner<{ table: string }[]>`
      SELECT t AS table FROM unnest(${[...TENANT_TABLES, 'plans', 'permissions']}::text[]) AS t
      WHERE has_table_privilege('pospay_auth', t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')`,
    );
    expect(rows).toEqual([]);
  });

  it('pospay_app cannot TRUNCATE, REFERENCE or TRIGGER any table — each would bypass or outlive RLS', async () => {
    const rows = await withClusterRoleLock(
      'shared',
      () => owner<{ table: string }[]>`
      SELECT t AS table FROM unnest(${[...TENANT_TABLES, 'plans']}::text[]) AS t
      WHERE has_table_privilege('pospay_app', t, 'TRUNCATE, REFERENCES, TRIGGER')`,
    );
    expect(rows).toEqual([]);
  });

  it('no application role owns a table', async () => {
    const rows = await owner`
      SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
      WHERE c.relnamespace = 'public'::regnamespace AND r.rolname = ANY(${APP_ROLES})`;
    expect(rows).toHaveLength(0);
  });

  it('every tenant table has row-level security enabled and forced', async () => {
    const rows = await owner`
      SELECT relname FROM pg_class
      WHERE relname = ANY(${TENANT_TABLES}) AND relrowsecurity AND relforcerowsecurity ORDER BY 1`;
    expect(rows.map((r) => r['relname'])).toEqual([...TENANT_TABLES].sort());
  });
});

// ADR-0061 §1: القارئ مالوش أي صلاحية على جدول الهوية، والمسّاح مالوش غير الإدراج في سجل التدقيق
// عشان سطر المسح يتدوّر في نفس المعاملة (فشل التدقيق يرجّع المسح).
describe('recovery roles and the global identity tables', () => {
  it('the recovery reader reaches no identity table', async () => {
    const reader = await withClusterRoleLock(
      'shared',
      () => owner<{ table: string }[]>`
      SELECT t AS table FROM unnest(${IDENTITY_TABLES}::text[]) AS t
      WHERE has_table_privilege('pospay_recovery_company_reader', quote_ident(t),
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')`,
    );
    expect(reader).toEqual([]);
  });

  it('the recovery clearer reaches only the platform audit log, for inserts', async () => {
    const clearer = await withClusterRoleLock(
      'shared',
      () => owner<{ role: string; table: string }[]>`
      SELECT r AS role, t AS table
      FROM unnest(${['pospay_recovery_flag_clearer']}::text[]) AS r, unnest(${IDENTITY_TABLES}::text[]) AS t
      WHERE has_table_privilege(r, quote_ident(t),
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')`,
    );
    expect(clearer).toEqual([
      { role: 'pospay_recovery_flag_clearer', table: 'platform_audit_log' },
    ]);
  });
});
