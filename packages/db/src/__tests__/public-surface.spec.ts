import { describe, expect, it } from 'vitest';

import pkg from '../../package.json' with { type: 'json' };
import * as db from '../index.ts';
import * as operator from '../operator/staging-staff.ts';

const PUBLIC_EXPORTS = [
  'EmployeeNumberExhaustedError',
  'FEATURE_FLAGS',
  'IdempotencyKeyBusyError',
  'IdempotencyKeyReusedError',
  'OWNER_DERIVED_PERMISSIONS',
  'OWNER_GRANTED_PERMISSIONS',
  'OWNER_ROLE_ID',
  'PERMISSIONS',
  'PLATFORM_ROLES',
  'PROVISIONAL_PLAN_ID',
  'SYSTEM_ROLES',
  'StatementPeriodClosedError',
  'StatementPeriodFormatError',
  'appendAuditLog',
  'appendAuditLogs',
  'appendOutboxEvent',
  'appendOutboxEvents',
  'assertStatementPeriodsOpen',
  'assignEmployeeNumber',
  'attendanceMonthlyInputsStatement',
  'attendanceReportContractsStatement',
  'attendanceStatementScheduledEmployeesStatement',
  'branchToday',
  'businessIdentityReadStatement',
  'canonicalJson',
  'canonicalOwnerSql',
  'createAuthDatabase',
  'createDatabase',
  'createOutboxDispatcherDatabase',
  'createPlatformWhatsappDatabase',
  'createStaffOtpDatabase',
  'currentAttachment',
  'employeeDefaultShiftsStatement',
  'grantPlatformPermission',
  'lockBusinessLogoReference',
  'lockEmployeeNumberCounter',
  'lockStatementPeriods',
  'markEventConsumed',
  'readBusinessIdentity',
  'revokePlatformPermission',
  'runIdempotent',
  'systemRoleGrantAllowedSql',
  'systemRoleOverrideAllowedSql',
  'systemRolePolicy',
  'verticalTemplate',
];

describe('@pospay/db public surface (CLAUDE.md §5 — no raw client)', () => {
  it('exports the factory and the transaction-scoped writers — every writer needs a Tx', () => {
    expect(Object.keys(db).sort()).toEqual(PUBLIC_EXPORTS);
  });

  it('hands out the wrappers, ping and close — nothing that can run a query outside them', () => {
    const database = db.createDatabase({
      url: 'postgres://nobody:unused@127.0.0.1:1/none',
      ids: { newId: () => '00000000-0000-7000-8000-000000000000' },
    });
    expect(Object.keys(database).sort()).toEqual([
      'close',
      'ping',
      'withMember',
      'withNewTenant',
      'withTenant',
      'withUser',
    ]);
    for (const value of Object.values(database)) {
      expect(typeof value).toBe('function');
    }
  });

  it('exposes no deep import path into the package', () => {
    // المدخل الإضافي الوحيد هو مسار المشغّل في PP-58.3 (ADR-0003 §6a، 2026-10-25)، وهو محظور خارج
    // سطر أوامر staging بفحص ESLint.
    expect(Object.keys(pkg.exports)).toEqual(['.', './operator/staging-staff']);
  });

  it('exposes no raw client on the operator subpath', () => {
    const raw = ['createDatabase', 'db', 'client', 'sql'];
    expect(Object.keys(operator).filter((name) => raw.includes(name))).toEqual([]);
  });
});
