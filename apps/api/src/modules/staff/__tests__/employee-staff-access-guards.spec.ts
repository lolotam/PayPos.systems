import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  addEmployee,
  grant,
  grantPath,
  nextPhone,
  staffAccessFixture,
  type Fixture,
} from './employee-staff-access.fixture.ts';
import { createStaffPinTransactions } from '../../identity/persistence/staff-pin-transactions.ts';
import { canLinkEmployeeUser } from '../persistence/employee-context.adapter.ts';
import type { EmployeeUpdateScope, EmployeeUpdateTransactions } from '../ports/employee-update-transactions.port.ts';
import { EmployeeCreationError } from '../domain/create-employee.ts';
import { UpdateEmployeeUseCase } from '../use-cases/update-employee/update-employee.usecase.ts';

const ids = systemUuidV7();
let f: Fixture;
let gated: Fixture;
let db: ReturnType<typeof createDatabase>;
beforeAll(async () => {
  f = await staffAccessFixture({ staffAccessRoutes: true });
  gated = await staffAccessFixture();
  db = createDatabase({ url: f.h.urls.app, ids });
});
afterAll(async () => {
  await db?.close();
  await f?.db.close();
  await f?.h.close();
  await gated?.db.close();
  await gated?.h.close();
});

it('AC-F1-7c with the gate off every new route answers 503 NOT_READY', async () => {
  const employee = await addEmployee(gated, 'Gated', gated.salmiya, 30);
  const post = await gated.h.send('POST', grantPath(gated, employee), {
    cookie: gated.ownerCookie,
    company: gated.company,
    body: { phone: nextPhone(gated), phone_confirmed: true, role: 'staff', pin: '1234' },
  });
  expect(post).toMatchObject({ status: 503, body: { code: 'NOT_READY' } });
  const get = await readStateSafe(gated, employee);
  expect(get).toMatchObject({ status: 503, body: { code: 'NOT_READY' } });
  const remove = await gated.h.send('DELETE', `${grantPath(gated, employee)}/pending`, {
    cookie: gated.ownerCookie,
    company: gated.company,
  });
  expect(remove).toMatchObject({ status: 503, body: { code: 'NOT_READY' } });
  expect(
    await gated.h.owner`SELECT id FROM employee_staff_access WHERE employee_id = ${employee}`,
  ).toHaveLength(0);
});

async function readStateSafe(fixture: Fixture, employeeId: string) {
  return fixture.h.send('GET', grantPath(fixture, employeeId), {
    cookie: fixture.ownerCookie,
    company: fixture.company,
  });
}

it('AC-F1-7c a temporary PIN row is invisible to the staff PIN readers, exactly like no row', async () => {
  const granted = await addEmployee(f, 'Reader probe', f.salmiya, 31);
  expect((await grant(f, granted, nextPhone(f))).status).toBe(200);
  const [record] = await f.h.owner`SELECT user_id FROM employee_staff_access WHERE employee_id = ${granted}`;
  const userId = record?.user_id as string;
  expect(userId).toBeTruthy();
  const direct = await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`SELECT pin_hash FROM cashier_pins WHERE company_id=${f.company} AND user_id=${userId}`),
  );
  expect(direct).toHaveLength(1);
  const staffPins = createStaffPinTransactions(f.db, ids);
  const throughReader = await staffPins.run(f.company, null, (scope) => scope.find(userId));
  // القارئ لا يرى الرقم المؤقت إطلاقاً: نفس جواب «لا صف» الذي يعني PIN غلط في كل مسار حتى F2.
  expect(throughReader).toBeNull();
  await f.h.owner`UPDATE cashier_pins SET temporary = false WHERE user_id = ${userId}`;
  const afterFlip = await staffPins.run(f.company, null, (scope) => scope.find(userId));
  expect(afterFlip).not.toBeNull();
});

it('AC-F1-7b the link availability rule answers false for a staff user and true for a normal member', async () => {
  const granted = await addEmployee(f, 'Availability probe', f.salmiya, 33);
  expect((await grant(f, granted, nextPhone(f))).status).toBe(200);
  const [record] = await f.h.owner`SELECT user_id FROM employee_staff_access WHERE employee_id = ${granted}`;
  const normalMember = ids.newId();
  await f.h.owner`INSERT INTO "user"(id,name,email) VALUES (${normalMember},'Normal member',${`member-${normalMember}@example.test`})`;
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${ids.newId()},${normalMember},'01920000-0000-7000-8000-00000000010b','global','BRANCH',${f.salmiya})`;
  await f.db.withTenant(f.company, async (tx) => {
    expect(await canLinkEmployeeUser(tx, f.company, record?.user_id as string)).toBe(false);
    expect(await canLinkEmployeeUser(tx, f.company, normalMember)).toBe(true);
    expect(await canLinkEmployeeUser(tx, f.company, ids.newId())).toBe(false);
  });
});

it('AC-F1-7b update-employee refuses any user_id change for an employee with an access record', async () => {
  const record = {
    id: 'employee-1',
    business_id: 'business-1',
    primary_branch_id: 'branch-1',
    name_en: 'Current',
    name_ar: null,
    role_code: 'staff' as const,
    hire_date: '2026-01-01',
    contract_end: null,
    user_id: null,
    revision: 3,
    branch_ids: ['branch-1'] as const,
    created_at: new Date('2026-01-01T00:00:00Z'),
  };
  const scope: EmployeeUpdateScope = {
    load: vi.fn(async () => ({ record, history: [] })),
    authorize: vi.fn(async () => true),
    contexts: vi.fn(async (r) => [
      { businessExists: true, branchBusinessId: r.business_id },
    ]),
    hasAccessRecord: vi.fn(async () => true),
    canLinkUser: vi.fn(async () => true),
    save: vi.fn(async () => undefined),
  };
  const transactions = { run: vi.fn(async (_actor, work) => work(scope)) } as unknown as EmployeeUpdateTransactions;
  const useCase = new UpdateEmployeeUseCase(transactions, ids);
  await expect(
    useCase.execute({
      companyId: f.company,
      userId: 'actor',
      businessId: 'business-1',
      employeeId: 'employee-1',
      input: {
        primary_branch_id: 'branch-1',
        name_en: 'Renamed',
        role_code: 'staff',
        branch_ids: ['branch-1'],
        branch_effective_date: '2026-01-02',
        expected_revision: 3,
        user_id: 'new-user',
      },
    }),
  ).rejects.toMatchObject({ code: 'EMPLOYEE_USER_LINK_UNAVAILABLE' });
  expect(scope.save).not.toHaveBeenCalled();
  expect(vi.mocked(scope.canLinkUser)).not.toHaveBeenCalled();
  void EmployeeCreationError;
});

it('AC-F1-7b update-employee still allows unrelated edits for an employee with an access record', async () => {
  const record = {
    id: 'employee-2',
    business_id: 'business-1',
    primary_branch_id: 'branch-1',
    name_en: 'Current',
    name_ar: null,
    role_code: 'staff' as const,
    hire_date: '2026-01-01',
    contract_end: null,
    user_id: 'kept-user',
    revision: 3,
    branch_ids: ['branch-1'] as const,
    created_at: new Date('2026-01-01T00:00:00Z'),
  };
  const scope: EmployeeUpdateScope = {
    load: vi.fn(async () => ({ record, history: [] })),
    authorize: vi.fn(async () => true),
    contexts: vi.fn(async (r) => [
      { businessExists: true, branchBusinessId: r.business_id },
    ]),
    hasAccessRecord: vi.fn(async () => true),
    canLinkUser: vi.fn(async () => true),
    save: vi.fn(async () => undefined),
  };
  const transactions = { run: vi.fn(async (_actor, work) => work(scope)) } as unknown as EmployeeUpdateTransactions;
  const useCase = new UpdateEmployeeUseCase(transactions, ids);
  const detail = await useCase.execute({
    companyId: f.company,
    userId: 'actor',
    businessId: 'business-1',
    employeeId: 'employee-2',
    input: {
      primary_branch_id: 'branch-1',
      name_en: 'Renamed only',
      role_code: 'staff',
      branch_ids: ['branch-1'],
      branch_effective_date: '2026-01-02',
      expected_revision: 3,
      // نفس قيمة الربط الحالية: تعديل بلا مساس بالربط يُسمح به لموظفة ذات سجل (FR-F1-8).
      user_id: 'kept-user',
    },
  });
  expect(detail.name_en).toBe('Renamed only');
  expect(scope.save).toHaveBeenCalledTimes(1);
});
