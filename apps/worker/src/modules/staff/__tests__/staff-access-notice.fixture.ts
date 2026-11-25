import { employeeNameMatchKey } from '@pospay/domain';
import {
  createDatabase,
  OWNER_ROLE_ID,
  PROVISIONAL_PLAN_ID,
  type ClaimedEvent,
  type Database,
  type IdGenerator,
} from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';

import { createTestDatabase, type TestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { createStaffAccessNoticeConsumer } from '../index.ts';
import { takeTestEmployeeNumber } from './test-employee-number.ts';

export const OCCURRED_AT = new Date('2026-11-25T06:30:00.000Z');
export const ROLE = {
  owner: OWNER_ROLE_ID,
  general_manager: '01920000-0000-7000-8000-000000000102',
} as const;

/** نطاق شركة واحدة: الشركة والنشاط والفرع بتوع الموظفة. */
export interface Scope {
  readonly company: string;
  readonly business: string;
  readonly branch: string;
}

export interface EmployeeOptions {
  readonly nameAr?: string | null;
  readonly nameEn?: string;
  readonly userId?: string | null;
}

/** قاعدة اختبار مستنسخة: القراءة والأحداث كلها كـ pospay_app، والتجهيز كـ pospay_owner. */
export async function staffAccessNoticeFixture() {
  const ids = systemUuidV7();
  const testDb: TestDatabase = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
  const db: Database = createDatabase({ url: testDb.appUrl, ids, maxConnections: 4 });
  const consumer = createStaffAccessNoticeConsumer(ids, { now: () => OCCURRED_AT });
  const deliver = createDeliverer(db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
  return {
    ids,
    owner,
    db,
    testDb,
    consumer,
    deliver,
    at: OCCURRED_AT,
    tenant: TENANT,
    scope: (label: 'A' | 'B'): Scope => TENANT[label],
    newScope: (label: string) => addScope(owner, ids, label),
    user: (label: string) => addUser(owner, ids, label),
    employee: (scope: Scope, options: EmployeeOptions = {}) =>
      addEmployee(owner, ids, scope, options),
    member: (input: MemberInput) => addMember(owner, ids, input),
    grant: (input: GrantInput) => addGrant(owner, ids, input),
    pin: (input: PinInput) => addPin(owner, ids, input),
    resetAudit: (input: ResetAuditInput) => addResetAudit(owner, ids, input),
    notices: (companyId: string) =>
      owner`SELECT * FROM outbox WHERE company_id=${companyId}
        AND event_type IN ('StaffAccessGrantedNoticeRequested', 'StaffPinSetByOtherNoticeRequested')
        ORDER BY seq`,
    consumed: (consumerId: string, eventId: string) =>
      owner`SELECT event_id FROM consumed_events WHERE consumer_id=${consumerId} AND event_id=${eventId}`,
    inbox: (companyId: string) =>
      owner`SELECT * FROM in_app_notifications WHERE company_id=${companyId} ORDER BY created_at`,
    close: async () => {
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}
export type StaffAccessNoticeFixture = Awaited<ReturnType<typeof staffAccessNoticeFixture>>;

async function addUser(owner: postgres.Sql, ids: IdGenerator, label: string) {
  const id = ids.newId();
  await owner`INSERT INTO "user"(id,name,email) VALUES(${id},${label},${`${id}@example.test`})`;
  return id;
}

/** شركة جديدة لكل اختبار، عشان صفحات الإشعارات ما تختلطش بين المواضع. */
async function addScope(owner: postgres.Sql, ids: IdGenerator, label: string): Promise<Scope> {
  const company = ids.newId();
  const business = ids.newId();
  const branch = ids.newId();
  const ownerUserId = ids.newId();
  await owner`INSERT INTO "user"(id,name,email) VALUES(${ownerUserId},${`Owner ${label}`},${`${ownerUserId}@example.test`})`;
  await owner`INSERT INTO companies(id,name_en,owner_user_id,plan_id) VALUES(${company},${`Company ${label}`},${ownerUserId},${PROVISIONAL_PLAN_ID})`;
  await owner`INSERT INTO businesses(id,company_id,vertical_type,name_en) VALUES(${business},${company},'salon',${`Business ${label}`})`;
  await owner`INSERT INTO branches(id,company_id,business_id,name_en) VALUES(${branch},${company},${business},${`Branch ${label}`})`;
  return { company, business, branch };
}

async function addEmployee(
  owner: postgres.Sql,
  ids: IdGenerator,
  scope: Scope,
  options: EmployeeOptions,
) {
  const id = ids.newId();
  const nameEn = options.nameEn ?? 'Sara';
  const nameAr = options.nameAr ?? null;
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_ar,name_en,name_ar_key,name_en_key,role_code,hire_date,deleted_at,employee_number)
    VALUES(${scope.company},${id},${scope.business},${scope.branch},${options.userId ?? null},${nameAr},
      ${nameEn},${nameAr == null ? null : employeeNameMatchKey(nameAr)},${employeeNameMatchKey(nameEn)},'staff','2026-01-01',null,${takeTestEmployeeNumber(scope.company)})`;
  return id;
}

export interface MemberInput {
  readonly scope: Scope;
  readonly userId: string;
  readonly roleId: string;
  readonly scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH';
  readonly scopeId: string;
  readonly startsAt?: string;
  readonly endsAt?: string | null;
}

async function addMember(owner: postgres.Sql, ids: IdGenerator, input: MemberInput) {
  const id = ids.newId();
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
    VALUES(${input.scope.company},${id},${input.userId},${input.roleId},'global',${input.scopeType},${input.scopeId},
      ${input.startsAt ?? '2026-01-01T00:00:00Z'},${input.endsAt ?? null})`;
  return id;
}

export interface GrantInput {
  readonly scope: Scope;
  readonly employeeId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly grantedBy: string;
  readonly updatedAt: Date;
}

async function addGrant(owner: postgres.Sql, ids: IdGenerator, input: GrantInput) {
  const id = ids.newId();
  await owner`INSERT INTO employee_staff_access(company_id,id,business_id,employee_id,operation_id,user_id,membership_id,
      role_code,branch_id,attempt_id,phone_hash,state,granted_by,created_at,updated_at)
    VALUES(${input.scope.company},${id},${input.scope.business},${input.employeeId},${ids.newId()},${input.userId},${input.membershipId},
      'staff',${input.scope.branch},${ids.newId()},'synthetic-phone-hash','ACTIVE',${input.grantedBy},${input.updatedAt},${input.updatedAt})`;
  return id;
}

export interface PinInput {
  readonly scope: Scope;
  readonly userId: string;
  readonly setBy: string | null;
  readonly setAt: Date;
}

async function addPin(owner: postgres.Sql, ids: IdGenerator, input: PinInput) {
  const id = ids.newId();
  await owner`INSERT INTO cashier_pins(company_id,id,user_id,pin_hash,set_by,set_at,temporary,expires_at)
    VALUES(${input.scope.company},${id},${input.userId},'pbkdf2-sha256$synthetic',${input.setBy},${input.setAt},true,${input.setAt})`;
  return id;
}

export interface ResetAuditInput {
  readonly scope: Scope;
  readonly userId: string;
  readonly actorUserId: string;
  readonly at: Date;
}

async function addResetAudit(owner: postgres.Sql, ids: IdGenerator, input: ResetAuditInput) {
  const id = ids.newId();
  await owner`INSERT INTO audit_log(company_id,id,actor_user_id,entity,entity_id,action,after,at)
    VALUES(${input.scope.company},${id},${input.actorUserId},'cashier_pin',${input.userId},'staff.pin_reset_temporary',
      ${JSON.stringify({ temporary: true })},${input.at})`;
  return id;
}

/** حدث وصول الدخول كما لو نشرته الـ API في نفس معاملة المنح. */
export function grantedEvent(ids: IdGenerator, scope: Scope, input: {
  readonly employeeId: string;
  readonly userId: string;
  readonly membershipId: string;
}): ClaimedEvent {
  return {
    companyId: scope.company,
    id: ids.newId(),
    aggregateType: 'employee',
    aggregateId: input.employeeId,
    eventType: 'StaffAccessGranted',
    payload: {
      employee_id: input.employeeId,
      user_id: input.userId,
      membership_id: input.membershipId,
      branch_id: scope.branch,
      role: 'staff',
    },
    attempt: 1,
  };
}

/** حدث إعادة الضبط كما لو نشرته الـ API في نفس معاملة إعادة الضبط. */
export function pinEvent(ids: IdGenerator, scope: Scope, input: {
  readonly employeeId: string;
  readonly userId: string;
}): ClaimedEvent {
  return {
    companyId: scope.company,
    id: ids.newId(),
    aggregateType: 'employee',
    aggregateId: input.employeeId,
    eventType: 'StaffPinSetByOther',
    payload: {
      employee_id: input.employeeId,
      user_id: input.userId,
      branch_id: scope.branch,
    },
    attempt: 1,
  };
}
