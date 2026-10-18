import { createdEmployee, employeeNumberCapability } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeNumberCapabilityAccess } from '../persistence/employee-context.adapter.ts';
import { typedEmployeeNumberTaken } from '../persistence/set-employee-number.adapter.ts';
import {
  employeeNumberCapabilityBranchStatement,
  readEmployeeNumberCapability,
} from '../queries/employee-number-capability.query.ts';
import { readCounter, setCounter, insertHeldNumbers, employeeNumberIds, grantEmployeeCreation, type EmployeeFixture } from './employee-number-assign.fixture.ts';
import {
  clearNumberGrants,
  executeCreate,
  grantNumber,
  numberDevice,
  numberFixture,
  putNumber,
} from './set-employee-number.fixture.ts';

const TAKEN_AR = 'الرقم الوظيفي مستخدم بالفعل لموظف آخر في الشركة.';
const TAKEN_EN = 'This employee number is already used by another employee in the company.';
let f: EmployeeFixture;

beforeAll(async () => {
  f = await numberFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function createBody(name: string, employeeNumber?: number, hireDate = '2026-01-01') {
  return {
    primary_branch_id: f.branch,
    name_en: name,
    role_code: 'staff' as const,
    hire_date: hireDate,
    ...(employeeNumber === undefined ? {} : { employee_number: employeeNumber }),
  };
}

function post(body: object, cookie = f.cookie) {
  return f.h.send('POST', `/v1/businesses/${f.business}/employees`, {
    cookie,
    company: f.company,
    body,
  });
}

function readCapability(cookie: string, business = f.business, branch = f.branch) {
  return f.h.send(
    'GET',
    `/v1/businesses/${business}/employee-number-capability?primary_branch_id=${branch}`,
    { cookie, company: f.company },
  );
}

async function countNamed(name: string) {
  const [row] = await f.h.owner`SELECT count(*) AS n FROM employees
    WHERE company_id=${f.company} AND name_en=${name}`;
  return Number(row?.['n'] ?? 0);
}

it('EN-06 stores a typed number without moving the counter and a later assignment skips it', async () => {
  await clearNumberGrants(f);
  await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
  await setCounter(f, 40_000);
  try {
    const typed = await executeCreate(f, 'EN-06 typed', { employee_number: 50_000 });
    expect(typed.employee_number).toBe(50_000);
    expect(await readCounter(f)).toBe(40_000);
    const [audit] = await f.h.owner`SELECT after FROM audit_log
      WHERE company_id=${f.company} AND entity='employee' AND action='created' AND entity_id=${typed.id}`;
    expect(audit?.['after']).toMatchObject({ employee_number: 50_000 });
    expect((await executeCreate(f, 'EN-06 next')).employee_number).toBe(40_000);
    expect(await readCounter(f)).toBe(40_001);
    await setCounter(f, 50_000);
    expect((await executeCreate(f, 'EN-06 skip')).employee_number).toBe(50_001);
    expect(await readCounter(f)).toBe(50_002);
  } finally {
    await clearNumberGrants(f);
  }
});

it.each([
  ['active', false, 60_000],
  ['soft-deleted', true, 60_001],
])('EN-07 rejects a number held by a %s employee and creates nothing', async (label, deleted, employeeNumber) => {
  await setCounter(f, 40_000);
  await insertHeldNumbers(f, employeeNumber, 1, { deleted });
  if (deleted) {
    expect(
      await f.db.withTenant(f.company, (tx) =>
        typedEmployeeNumberTaken(tx, f.company, employeeNumber),
      ),
    ).toBe(true);
  }
  const name = `EN-07 ${label}`;
  const response = await post(createBody(name, employeeNumber), f.ownerCookie);
  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({
    code: 'EMPLOYEE_NUMBER_TAKEN',
    message_ar: TAKEN_AR,
    message_en: TAKEN_EN,
  });
  expect(await countNamed(name)).toBe(0);
  expect(await readCounter(f)).toBe(40_000);
});

it('EN-09 refuses a typed number from a caller without the number permission', async () => {
  await clearNumberGrants(f);
  const name = 'EN-09 non-holder';
  const response = await post(createBody(name, 11_001));
  expect(response.status).toBe(403);
  expect(response.body['code']).toBe('FORBIDDEN');
  expect(await countNamed(name)).toBe(0);
});

it('EN-09 stores a typed number for the owner', async () => {
  const response = await post(createBody('EN-09 owner', 11_002), f.ownerCookie);
  expect(response.status).toBe(201);
  expect(createdEmployee.parse(response.body).employee_number).toBe(11_002);
});

it('EN-09 stores a typed number for a company grant', async () => {
  await clearNumberGrants(f);
  await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
  try {
    const response = await post(createBody('EN-09 granted', 11_003));
    expect(response.status).toBe(201);
    expect(createdEmployee.parse(response.body).employee_number).toBe(11_003);
  } finally {
    await clearNumberGrants(f);
  }
});

it('EN-09 refuses a typed number from a device', async () => {
  const token = await numberDevice(f);
  const name = 'EN-09 device';
  const response = await f.h.app.inject({
    method: 'POST',
    url: `/v1/businesses/${f.business}/employees`,
    payload: createBody(name, 11_004),
    headers: { authorization: `Device ${token}`, 'x-company-id': f.company, origin: 'http://admin.test' },
  });
  expect(response.statusCode).toBe(403);
  expect(response.json<{ code: string }>().code).toBe('FORBIDDEN');
  expect(await countNamed(name)).toBe(0);
});

it.each([
  ['business', 'BUSINESS' as const, () => f.business, 71_000],
  ['primary branch', 'BRANCH' as const, () => f.branch, 71_100],
])(
  'EN-09c denies a typed number under a %s DENY and still creates without the field',
  async (label, scopeType, scopeId, employeeNumber) => {
    await clearNumberGrants(f);
    await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
    await grantNumber(f, 'DENY', scopeType, scopeId());
    const name = `EN-09c ${label}`;
    try {
      const denied = await post(createBody(name, employeeNumber));
      expect(denied.status).toBe(403);
      expect(denied.body['code']).toBe('FORBIDDEN');
      expect(await countNamed(name)).toBe(0);
      const created = await post(createBody(name));
      expect(created.status).toBe(201);
      expect(createdEmployee.parse(created.body).employee_number).not.toBe(employeeNumber);
      expect(await countNamed(name)).toBe(1);
    } finally {
      await clearNumberGrants(f);
    }
  },
);

it('EN-09c denies a future-dated hire into a denied primary branch', async () => {
  await clearNumberGrants(f);
  await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
  await grantNumber(f, 'DENY', 'BRANCH', f.branch);
  const name = 'EN-09c future';
  try {
    const denied = await post(createBody(name, 71_200, '2026-12-01'));
    expect(denied.status).toBe(403);
    expect(denied.body['code']).toBe('FORBIDDEN');
    expect(await countNamed(name)).toBe(0);
  } finally {
    await clearNumberGrants(f);
  }
});

it('EN-09e reports false for a caller who can create but cannot type a number', async () => {
  await clearNumberGrants(f);
  const response = await readCapability(f.cookie);
  expect(response.status).toBe(200);
  expect(employeeNumberCapability.parse(response.body)).toEqual({ can_type_number: false });
});

it('EN-09e reports true when the number permission has no DENY', async () => {
  await clearNumberGrants(f);
  await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
  try {
    const response = await readCapability(f.cookie);
    expect(response.status).toBe(200);
    expect(employeeNumberCapability.parse(response.body)).toEqual({ can_type_number: true });
  } finally {
    await clearNumberGrants(f);
  }
});

it.each([
  ['business', 'BUSINESS' as const, () => f.business],
  ['primary branch', 'BRANCH' as const, () => f.branch],
])('EN-09e reports false when DENY covers the %s', async (_label, scopeType, scopeId) => {
  await clearNumberGrants(f);
  await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
  await grantNumber(f, 'DENY', scopeType, scopeId());
  try {
    const response = await readCapability(f.cookie);
    expect(response.status).toBe(200);
    expect(employeeNumberCapability.parse(response.body)).toEqual({ can_type_number: false });
  } finally {
    await clearNumberGrants(f);
  }
});

it.each([
  ['another business', () => f.otherBranch],
  ['another company', () => f.foreignBranch],
])('EN-09e returns 404 when the primary branch is in %s', async (_label, branch) => {
  const response = await readCapability(f.ownerCookie, f.business, branch());
  expect(response.status).toBe(404);
  expect(response.body['code']).toBe('EMPLOYEE_BRANCH_NOT_FOUND');
});

it('EN-09e refuses a caller without manage:employees:business', async () => {
  const businessId = employeeNumberIds.newId();
  const branchId = employeeNumberIds.newId();
  await f.h.owner`INSERT INTO businesses (company_id,id,name_en,vertical_type)
    VALUES (${f.company},${businessId},'Synthetic ungated','salon')`;
  await f.h.owner`INSERT INTO branches (company_id,id,business_id,name_en)
    VALUES (${f.company},${branchId},${businessId},'Synthetic ungated')`;
  const response = await readCapability(f.cookie, businessId, branchId);
  expect(response.status).toBe(403);
  expect(response.body['code']).toBe('FORBIDDEN');
});

it('answers 200 when manage:employees:business is held only on the selected branch', async () => {
  await f.h.owner`DELETE FROM permission_overrides
    WHERE company_id=${f.company} AND membership_id=${f.memberId}
      AND permission_code='manage:employees:business' AND scope_type='BUSINESS' AND scope_id=${f.business}`;
  const grant = employeeNumberIds.newId();
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${grant},${f.memberId},'manage:employees:business','ALLOW','BRANCH',${f.branch},'Synthetic branch grant',${f.userId})`;
  try {
    const response = await readCapability(f.cookie);
    expect(response.status).toBe(200);
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${grant}`;
    await grantEmployeeCreation(f);
  }
});

it.each([
  ['missing', ''],
  ['malformed', '?primary_branch_id=not-a-uuid'],
])('rejects a %s primary_branch_id', async (_label, query) => {
  const response = await f.h.send(
    'GET',
    `/v1/businesses/${f.business}/employee-number-capability${query}`,
    { cookie: f.ownerCookie, company: f.company },
  );
  expect(response.status).toBe(400);
});

it('reports true for the owner when no DENY is present', async () => {
  await clearNumberGrants(f);
  const response = await readCapability(f.ownerCookie);
  expect(response.status).toBe(200);
  expect(employeeNumberCapability.parse(response.body)).toEqual({ can_type_number: true });
});

it('does not block while another transaction holds the company row FOR UPDATE', async () => {
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
    if (gate !== 'held') throw holderError ?? new Error('company lock ended before the capability read');
    const response = await Promise.race([
      readCapability(f.ownerCookie),
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

it('a typed create racing a hand edit stores the number once', async () => {
  await setCounter(f, 40_000);
  const existing = await executeCreate(f, 'race holder');
  await setCounter(f, 40_000);
  const target = 90_000;
  const [created, edited] = await Promise.all([
    post(createBody('race typed', target), f.ownerCookie),
    putNumber(f, existing.id, { employee_number: target }, { cookie: f.ownerCookie }),
  ]);
  const holders = await f.h.owner`SELECT id FROM employees
    WHERE company_id=${f.company} AND employee_number=${target}`;
  expect(holders).toHaveLength(1);
  const winner = created.status === 201 ? 201 : 200;
  expect(new Set([created.status, edited.status])).toEqual(new Set([winner, 409]));
  const failed = created.status === 409 ? created : edited;
  expect(failed.body['code']).toBe('EMPLOYEE_NUMBER_TAKEN');
  expect(await readCounter(f)).toBe(40_000);
});

it('returns the capability contract for a manager who cannot type a number', async () => {
  await clearNumberGrants(f);
  const result = await f.db.withTenant(
    f.company,
    (tx) =>
      readEmployeeNumberCapability(
        tx,
        f.company,
        f.userId,
        f.business,
        f.branch,
        employeeNumberCapabilityAccess(),
      ),
    { userId: f.userId },
  );
  expect(employeeNumberCapability.parse(result)).toEqual({ can_type_number: false });
});

it('plans the branch lookup without a sequential scan of employees or branches', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const [row] = await tx.execute<{ 'QUERY PLAN': { Plan: ExplainNode }[] }>(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${employeeNumberCapabilityBranchStatement(f.company, f.business, f.branch)}`,
    );
    const nodes = planNodes(row?.['QUERY PLAN'][0]?.Plan);
    const scanned = nodes.filter(
      (node) => node['Relation Name'] === 'employees' || node['Relation Name'] === 'branches',
    );
    expect(scanned.some((node) => node['Relation Name'] === 'branches')).toBe(true);
    expect(scanned.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
  });
});

interface ExplainNode {
  'Node Type': string;
  'Relation Name'?: string;
  Plans?: ExplainNode[];
}

function planNodes(node: ExplainNode | undefined): ExplainNode[] {
  return node ? [node, ...(node.Plans ?? []).flatMap(planNodes)] : [];
}
