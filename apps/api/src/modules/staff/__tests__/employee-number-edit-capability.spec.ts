import { employeeNumberEditCapability } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeNumberEditCapabilityAccess } from '../persistence/set-employee-number.adapter.ts';
import {
  employeeNumberEditAttachmentStatement,
  employeeNumberEditEmployeeStatement,
  readEmployeeNumberEditCapability,
} from '../queries/employee-number-edit-capability.query.ts';
import { employeeNumberIds, type EmployeeFixture } from './employee-number-assign.fixture.ts';
import {
  attachBranch,
  clearNumberGrants,
  executeCreate,
  grantNumber,
  numberFixture,
} from './set-employee-number.fixture.ts';

let f: EmployeeFixture;

beforeAll(async () => {
  f = await numberFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function readEdit(cookie: string, employeeId: string, businessId = f.business) {
  return f.h.send(
    'GET',
    `/v1/businesses/${businessId}/employees/${employeeId}/employee-number-capability`,
    { cookie, company: f.company },
  );
}

async function withHolderGrants(apply: () => Promise<void>, run: () => Promise<void>) {
  await clearNumberGrants(f);
  await apply();
  try {
    await run();
  } finally {
    await clearNumberGrants(f);
  }
}

async function expectEdit(employeeId: string, canEdit: boolean, businessId = f.business) {
  const response = await readEdit(f.cookie, employeeId, businessId);
  expect(response.status).toBe(200);
  expect(employeeNumberEditCapability.parse(response.body)).toEqual({ can_edit_number: canEdit });
}

it('returns the capability contract for a manager who cannot edit a number', async () => {
  const employee = await executeCreate(f, 'edit capability shape');
  await clearNumberGrants(f);
  const result = await f.db.withTenant(
    f.company,
    (tx) =>
      readEmployeeNumberEditCapability(
        tx,
        f.company,
        f.userId,
        f.business,
        employee.id,
        employeeNumberEditCapabilityAccess(),
      ),
    { userId: f.userId },
  );
  expect(employeeNumberEditCapability.parse(result)).toEqual({ can_edit_number: false });
});

it('plans the employee and attachment lookups without a sequential scan', async () => {
  const employee = await executeCreate(f, 'edit capability plan');
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    for (const statement of [
      employeeNumberEditEmployeeStatement(f.company, f.business, employee.id),
      employeeNumberEditAttachmentStatement(f.company, employee.id),
    ]) {
      const [row] = await tx.execute<{ 'QUERY PLAN': { Plan: ExplainNode }[] }>(
        sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`,
      );
      const scanned = planNodes(row?.['QUERY PLAN'][0]?.Plan).filter(
        (node) =>
          node['Relation Name'] === 'employees' || node['Relation Name'] === 'employee_branches',
      );
      expect(scanned.length).toBeGreaterThan(0);
      expect(scanned.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
    }
  });
});

it('does not block while another transaction holds the company row FOR UPDATE', async () => {
  const employee = await executeCreate(f, 'edit capability lock');
  let release!: () => void;
  const released = new Promise<void>((done) => {
    release = done;
  });
  let held!: () => void;
  const holding = new Promise<void>((done) => {
    held = done;
  });
  const holder = f.db.withTenant(
    f.company,
    async (tx) => {
      await tx.execute(sql`SELECT id FROM companies WHERE id=${f.company} FOR UPDATE`);
      held();
      await released;
    },
    { userId: f.userId },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let holderError: unknown;
  const ended = holder.then(
    () => 'ended' as const,
    (error: unknown) => {
      holderError = error;
      return 'failed' as const;
    },
  );
  try {
    const gate = await Promise.race([holding.then(() => 'held' as const), ended]);
    if (gate !== 'held')
      throw holderError ?? new Error('company lock ended before the capability read');
    const response = await Promise.race([
      readEdit(f.ownerCookie, employee.id),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('CAPABILITY_BLOCKED_ON_COMPANY_LOCK')), 1_500);
      }),
    ]);
    expect(response.status).toBe(200);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    release();
    await ended;
  }
});

it('returns can_edit_number true for a company grant holder', async () => {
  const employee = await executeCreate(f, 'edit capability allowed');
  await withHolderGrants(
    () => grantNumber(f, 'ALLOW', 'COMPANY', f.company),
    () => expectEdit(employee.id, true),
  );
});

it('returns false for a DENY on the primary branch', async () => {
  const employee = await executeCreate(f, 'edit capability deny primary');
  await withHolderGrants(
    async () => {
      await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
      await grantNumber(f, 'DENY', 'BRANCH', f.branch);
    },
    () => expectEdit(employee.id, false),
  );
});

it('returns false for a DENY on a secondary current attachment', async () => {
  const employee = await executeCreate(f, 'edit capability deny attached');
  const extra = await attachBranch(f, employee.id);
  await withHolderGrants(
    async () => {
      await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
      await grantNumber(f, 'DENY', 'BRANCH', extra);
    },
    () => expectEdit(employee.id, false),
  );
});

it('returns false for a DENY on an attachment whose end date is still in the future', async () => {
  const employee = await executeCreate(f, 'edit capability future end');
  const extra = await attachBranch(f, employee.id);
  await f.h.owner`UPDATE employee_branches SET "to"='2099-01-01'
    WHERE company_id=${f.company} AND employee_id=${employee.id} AND branch_id=${extra}`;
  await withHolderGrants(
    async () => {
      await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
      await grantNumber(f, 'DENY', 'BRANCH', extra);
    },
    () => expectEdit(employee.id, false),
  );
});

it('returns one false body for unknown, denied, and a caller with no staff permission', async () => {
  const employee = await executeCreate(f, 'edit capability identical no');
  const elsewhere = await executeCreate(f, 'edit capability wrong business', {
    businessId: f.secondBusiness,
    primary_branch_id: f.otherBranch,
  });
  const removed = await executeCreate(f, 'edit capability removed');
  await f.h.owner`UPDATE employees SET deleted_at=now()
    WHERE company_id=${f.company} AND id=${removed.id}`;
  const foreignId = await insertForeignEmployee();
  const stranger = await stafflessCookie();
  await withHolderGrants(
    async () => {
      await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
      await grantNumber(f, 'DENY', 'BRANCH', f.branch);
    },
    async () => {
      const denied = await readEdit(f.cookie, employee.id);
      const responses = [
        await readEdit(f.cookie, employeeNumberIds.newId()),
        await readEdit(stranger, employee.id),
        await readEdit(f.cookie, removed.id),
        await readEdit(f.cookie, elsewhere.id),
        await readEdit(f.cookie, foreignId),
      ];
      expect(denied.status).toBe(200);
      expect(JSON.parse(denied.text)).toEqual({ can_edit_number: false });
      for (const response of responses) {
        expect(response.status).toBe(denied.status);
        expect(response.text).toBe(denied.text);
      }
    },
  );
});

async function stafflessCookie() {
  const email = 'edit-capability-staffless@example.test';
  const cookie = await f.h.signedInOperator(email);
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const roleId = employeeNumberIds.newId();
  const memberId = employeeNumberIds.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${roleId},${f.company},'synthetic_no_staff','Synthetic no staff')`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${memberId},${user?.['id']},${roleId},${f.company},'COMPANY',${f.company})`;
  return cookie;
}

async function insertForeignEmployee() {
  const employeeId = employeeNumberIds.newId();
  const [current] = await f.h.owner`SELECT COALESCE(MAX(employee_number), 0) AS employee_number
    FROM employees WHERE company_id=${f.otherCompany}`;
  const employeeNumber = Number(current?.employee_number ?? 0) + 1;
  await f.h.owner`INSERT INTO employees(
      company_id, id, business_id, primary_branch_id, name_en, name_en_key, role_code, hire_date,
      employee_number)
    VALUES (${f.otherCompany}, ${employeeId}, ${f.foreignBusiness}, ${f.foreignBranch},
      'Foreign number', 'foreign-number-edit', 'staff', '2026-01-01', ${employeeNumber})`;
  return employeeId;
}

interface ExplainNode {
  'Node Type': string;
  'Relation Name'?: string;
  Plans?: ExplainNode[];
}

function planNodes(node: ExplainNode | undefined): ExplainNode[] {
  return node ? [node, ...(node.Plans ?? []).flatMap(planNodes)] : [];
}
