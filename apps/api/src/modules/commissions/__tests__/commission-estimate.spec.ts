import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  estimateFixture,
  estimatePath,
  type EstimateFixture,
} from './commission-estimate.fixture.ts';

let fixture: EstimateFixture;

beforeAll(async () => {
  fixture = await estimateFixture();
});

afterAll(async () => {
  await fixture?.h.close();
});

const get = (f: EstimateFixture, query = '', actor = f.cookie) =>
  f.h.send('GET', estimatePath(f.business, '2026-11', query), {
    cookie: actor,
    company: f.company,
  });

type EstimateBody = {
  period: string;
  employees: { employee_id: string; total: string; status: string; partial: boolean }[];
  partial: boolean;
  total: string;
};

it('prices the month for the business-wide owner and leaves the database unchanged', async () => {
  const before = await countRows(fixture);
  const response = await get(fixture);

  expect(response.status).toBe(200);
  const body = response.body as EstimateBody;
  expect(body.period).toBe('2026-11');
  expect(body.employees).toHaveLength(2);
  expect(body.employees.map((employee) => employee.employee_id).sort()).toEqual(
    [fixture.employee, fixture.secondEmployee].sort(),
  );
  expect(body.employees.every((employee) => employee.status === 'OK')).toBe(true);
  expect(body.employees.every((employee) => employee.total === '1.000')).toBe(true);
  expect(body.total).toBe('2.000');
  expect(await countRows(fixture)).toEqual(before);
});

it('marks the branch aggregate partial and the business aggregate complete', async () => {
  const branch = await get(fixture, '', fixture.branchCookie);
  const business = await get(fixture);

  const branchBody = branch.body as EstimateBody;
  const businessBody = business.body as EstimateBody;
  // القارئ على مستوى الفروع بيشوف مجموع جزئي من النشاط كله، حتى لو صف الموظفة
  // الظاهر كامل (CM-23g).
  expect(branchBody.partial).toBe(true);
  expect(branchBody.employees[0]?.partial).toBe(false);
  expect(businessBody.partial).toBe(false);
});

it('gives the same in-scope result for an uppercase employee id', async () => {
  const lower = await get(fixture, `?employee_id=${fixture.employee}`);
  const upper = await get(fixture, `?employee_id=${fixture.employee.toUpperCase()}`);

  expect(lower.status).toBe(200);
  expect(upper.status).toBe(200);
  expect(upper.body).toEqual(lower.body);
});

it('shows a branch reader only the days she was attached to her branch', async () => {
  const response = await get(fixture, '', fixture.branchCookie);

  expect(response.status).toBe(200);
  const body = response.body as EstimateBody;
  expect(body.employees).toHaveLength(1);
  expect(body.employees[0]?.employee_id).toBe(fixture.employee);
  expect(body.employees[0]?.total).toBe('1.000');
  expect(body.total).toBe('1.000');
});

it('cannot reveal an inaccessible employee through the employee filter', async () => {
  const hidden = await get(fixture, `?employee_id=${fixture.secondEmployee}`, fixture.branchCookie);
  const absent = await get(
    fixture,
    '?employee_id=01920000-0000-7000-8000-0000000000ff',
    fixture.branchCookie,
  );

  expect(hidden.status).toBe(200);
  expect(hidden.body).toEqual(absent.body);
});

it('shows the service name of a visible row and never of a hidden one', async () => {
  const visible = await get(fixture);
  const visibleBody = visible.body as {
    employees: { employee_id: string; sources: { service_name: string | null }[] }[];
  };
  const own = visibleBody.employees.find(
    (employee) => employee.employee_id === fixture.employee,
  );
  expect(own?.sources[0]?.service_name).toBe('Estimate service');

  const hidden = await get(fixture, '', fixture.branchCookie);
  expect(JSON.stringify(hidden.body)).not.toContain('Hidden service');
});

it('withholds the customer name from the estimate', async () => {
  const response = await get(fixture);
  const text = JSON.stringify(response.body);

  expect(text).not.toContain('customer');
  expect(text).not.toContain('Estimate customer');
});

it('refuses an invalid period or an unknown business', async () => {
  const bad = await fixture.h.send('GET', estimatePath(fixture.business, '2026-13'), {
    cookie: fixture.cookie,
    company: fixture.company,
  });
  expect(bad.status).toBe(400);

  const missing = await fixture.h.send(
    'GET',
    estimatePath('01920000-0000-7000-8000-0000000000ff', '2026-11'),
    { cookie: fixture.cookie, company: fixture.company },
  );
  expect(missing.status).toBe(403);
});

async function countRows(f: EstimateFixture): Promise<number[]> {
  const [lines] = await f.h.owner`SELECT count(*)::int AS count FROM commission_lines`;
  const [statements] = await f.h.owner`SELECT count(*)::int AS count FROM commission_statements`;
  const [corrections] = await f.h.owner`SELECT count(*)::int AS count FROM commission_corrections`;
  const [generations] = await f.h.owner`SELECT count(*)::int AS count FROM commission_period_generations`;
  return [
    lines?.['count'] as number,
    statements?.['count'] as number,
    corrections?.['count'] as number,
    generations?.['count'] as number,
  ];
}
