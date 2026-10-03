import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  schedulesFixture,
  scheduleActor,
  scheduleIds,
  setWeek,
  testWeek,
  type SchedulesFixture,
} from './schedules.fixture.ts';
let f: SchedulesFixture;
let managerCookie: string;
let templateId: string;
beforeAll(async () => {
  f = await schedulesFixture();
  managerCookie = await f.h.signedInOperator('schedule-branch-manager@example.test');
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT ${f.company},${scheduleIds.newId()},u.id,r.id,'global','BRANCH',${f.branch},'2000-01-01T00:00Z'
    FROM "user" u CROSS JOIN roles r WHERE u.email='schedule-branch-manager@example.test' AND r.company_id IS NULL AND r.code='branch_manager'`;
  templateId = (
    await f.createTemplate.execute({
      ...scheduleActor(f),
      input: { name_en: 'Synthetic empty privacy pattern', shifts: [] },
    })
  ).id;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
function send(
  method: 'GET' | 'PUT' | 'POST' | 'PATCH',
  url: string,
  payload?: object,
  cookie = managerCookie,
) {
  return f.h.app.inject({
    method,
    url,
    headers: { cookie, 'x-company-id': f.company },
    ...(payload === undefined ? {} : { payload }),
  });
}
const route = (business = f.business, branch = f.branch) =>
  `/v1/businesses/${business}/branches/${branch}/schedules`;
const emptyWeek = { week_start: testWeek, expected_revision: 99, shifts: [] };

it('branch manager can read A; inaccessible and unknown branches have identical GET/PUT refusals', async () => {
  expect((await send('GET', `${route()}?week_start=${testWeek}`)).statusCode).toBe(200);
  for (const method of ['GET', 'PUT'] as const) {
    const suffix = method === 'GET' ? `?week_start=${testWeek}` : `/${f.employee.id}`;
    const responses = await Promise.all(
      [f.secondBranch, scheduleIds.newId()].map((branch) =>
        send(
          method,
          `${route(f.business, branch)}${suffix}`,
          method === 'PUT' ? emptyWeek : undefined,
        ),
      ),
    );
    expect(responses.map((r) => r.statusCode)).toEqual([404, 404]);
    expect(responses[0]?.json()).toEqual(responses[1]?.json());
  }
});
it('inaccessible and unknown businesses have identical refusals on branch read/write paths', async () => {
  for (const method of ['GET', 'PUT'] as const) {
    const suffix = method === 'GET' ? `?week_start=${testWeek}` : `/${f.employee.id}`;
    const existing = await send(
      method,
      `${route(f.secondBusiness, f.otherBranch)}${suffix}`,
      method === 'PUT' ? emptyWeek : undefined,
    );
    const unknown = await send(
      method,
      `${route(scheduleIds.newId(), f.otherBranch)}${suffix}`,
      method === 'PUT' ? emptyWeek : undefined,
    );
    expect(existing.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(existing.statusCode);
    expect(existing.json()).toEqual(unknown.json());
  }
});
it.each(['GET', 'POST', 'PATCH', 'archive', 'apply'] as const)(
  'hides business existence on the template %s path',
  async (operation) => {
    const method = operation === 'GET' || operation === 'PATCH' ? operation : 'POST';
    const suffix =
      operation === 'GET' || operation === 'POST'
        ? ''
        : `/${templateId}${operation === 'PATCH' ? '' : `/${operation}`}`;
    const payload =
      operation === 'GET'
        ? undefined
        : operation === 'archive'
          ? { expected_revision: 1 }
          : operation === 'apply'
            ? { branch_id: f.branch, employee_ids: [f.employee.id], weeks: [testWeek] }
            : {
                name_en: 'Synthetic private pattern',
                shifts: [],
                ...(operation === 'PATCH' ? { expected_revision: 1 } : {}),
              };
    const existing = await send(
      method,
      `/v1/businesses/${f.business}/shift-templates${suffix}`,
      payload,
    );
    const unknown = await send(
      method,
      `/v1/businesses/${scheduleIds.newId()}/shift-templates${suffix}`,
      payload,
    );
    expect(existing.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(existing.statusCode);
    expect(existing.json()).toEqual(unknown.json());
  },
);
async function employeeForCase(kind: string) {
  const employee = await f.useCase.execute({
    ...scheduleActor(f),
    input: {
      primary_branch_id: kind === 'other branch' ? f.secondBranch : f.branch,
      name_en: `Synthetic eligibility ${kind}`,
      role_code: 'staff',
      hire_date: '2026-01-01',
    },
  });
  if (kind === 'deleted')
    await f.h.owner`UPDATE employees SET deleted_at=now() WHERE id=${employee.id}`;
  if (kind === 'future hire')
    await f.h.owner`UPDATE employees SET hire_date='2026-10-10' WHERE id=${employee.id}`;
  if (kind === 'ended contract')
    await f.h.owner`UPDATE employees SET contract_end='2026-10-02' WHERE id=${employee.id}`;
  if (kind === 'detached')
    await f.h
      .owner`UPDATE employee_branches SET "to"='2026-10-03' WHERE employee_id=${employee.id}`;
  if (kind === 'disjoint dates') {
    await f.h.owner`UPDATE employees SET hire_date='2026-10-09' WHERE id=${employee.id}`;
    await f.h
      .owner`UPDATE employee_branches SET "to"='2026-10-09' WHERE employee_id=${employee.id}`;
  }
  return employee;
}
it.each(['other branch', 'deleted', 'future hire', 'ended contract', 'detached', 'disjoint dates'])(
  'empty week hides %s eligibility before revision handling, including reads',
  async (kind) => {
    const employee = await employeeForCase(kind);
    const unknownId = scheduleIds.newId();
    for (const method of ['GET', 'PUT'] as const) {
      const suffix = method === 'GET' ? `?week_start=${testWeek}` : '';
      const existing = await send(
        method,
        `${route()}/${employee.id}${suffix}`,
        method === 'PUT' ? emptyWeek : undefined,
      );
      const unknown = await send(
        method,
        `${route()}/${unknownId}${suffix}`,
        method === 'PUT' ? emptyWeek : undefined,
      );
      expect(existing.statusCode).toBe(404);
      expect(unknown.statusCode).toBe(existing.statusCode);
      expect(existing.json()).toEqual(unknown.json());
    }
    expect(
      await f.h.owner`SELECT id FROM staff_schedules WHERE employee_id=${employee.id}`,
    ).toHaveLength(0);
    const grid = await send('GET', `${route()}?week_start=${testWeek}`);
    expect(grid.json().items.map((row: { employee_id: string }) => row.employee_id)).not.toContain(
      employee.id,
    );
  },
);
it.each([false, true])(
  'empty template validates every employee/week before conflict/reason; replace=%s',
  async (replace) => {
    const employee = await employeeForCase('other branch');
    const headerId = scheduleIds.newId();
    await f.h
      .owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    VALUES(${f.company},${headerId},${f.business},${f.branch},${employee.id},${testWeek},'Asia/Kuwait',7)`;
    const url = `/v1/businesses/${f.business}/shift-templates/${templateId}/apply`;
    const input = {
      branch_id: f.branch,
      employee_ids: [f.employee.id, employee.id],
      weeks: [testWeek],
      replace,
    };
    const hidden = await send('POST', url, input, f.cookie);
    const unknown = await send(
      'POST',
      url,
      { ...input, employee_ids: [f.employee.id, scheduleIds.newId()] },
      f.cookie,
    );
    expect(hidden.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(hidden.statusCode);
    expect(hidden.json()).toEqual(unknown.json());
    expect(await f.h.owner`SELECT revision FROM staff_schedules WHERE id=${headerId}`).toEqual([
      { revision: 7 },
    ]);
    expect(
      await f.h.owner`SELECT id FROM staff_schedules WHERE employee_id=${f.employee.id}`,
    ).toHaveLength(0);
    expect(await f.h.owner`SELECT id FROM audit_log WHERE entity_id=${headerId}`).toHaveLength(0);
  },
);
it('checks target eligibility before the archived-template conflict too', async () => {
  const employee = await employeeForCase('other branch');
  const template = await f.createTemplate.execute({
    ...scheduleActor(f),
    input: { name_en: 'Synthetic archived privacy pattern', shifts: [] },
  });
  await f.archiveTemplate.execute({
    ...scheduleActor(f),
    templateId: template.id,
    expectedRevision: 1,
  });
  const url = `/v1/businesses/${f.business}/shift-templates/${template.id}/apply`;
  const input = { branch_id: f.branch, employee_ids: [employee.id], weeks: [testWeek] };
  const hidden = await send('POST', url, input, f.cookie);
  const unknown = await send(
    'POST',
    url,
    { ...input, employee_ids: [scheduleIds.newId()] },
    f.cookie,
  );
  expect(hidden.statusCode).toBe(404);
  expect(unknown.statusCode).toBe(hidden.statusCode);
  expect(hidden.json()).toEqual(unknown.json());
});
it('empty template rejects an ineligible later week atomically, but a one-day eligible empty week is allowed', async () => {
  const employee = await employeeForCase('partial week');
  await f.h
    .owner`UPDATE employees SET hire_date='2026-10-09',contract_end='2026-10-09' WHERE id=${employee.id}`;
  await f.h
    .owner`UPDATE employee_branches SET "from"='2026-10-09',"to"='2026-10-10' WHERE employee_id=${employee.id}`;
  const url = `/v1/businesses/${f.business}/shift-templates/${templateId}/apply`;
  const input = {
    branch_id: f.branch,
    employee_ids: [employee.id],
    weeks: [testWeek, '2026-10-10'],
  };
  const hidden = await send('POST', url, input, f.cookie);
  const unknown = await send(
    'POST',
    url,
    { ...input, employee_ids: [scheduleIds.newId()] },
    f.cookie,
  );
  expect(hidden.statusCode).toBe(404);
  expect(hidden.json()).toEqual(unknown.json());
  expect(
    await f.h.owner`SELECT id FROM staff_schedules WHERE employee_id=${employee.id}`,
  ).toHaveLength(0);
  const saved = await setWeek(f, [], { employee: employee.id });
  expect(saved.revision).toBe(1);
  expect((await send('GET', `${route()}/${employee.id}?week_start=${testWeek}`)).statusCode).toBe(
    200,
  );
  const grid = await send('GET', `${route()}?week_start=${testWeek}`);
  expect(grid.json().items.map((row: { employee_id: string }) => row.employee_id)).toContain(
    employee.id,
  );
});
