import { expect, it, vi } from 'vitest';

import { buildOpenApiDocument } from '../../openapi.js';
import {
  commissionPlanEmployeeList,
  commissionPlanEmployeeListItem,
  commissionPlanEmployeeListQuery,
} from '../plan-employees.js';

const employeeId = '01920000-0000-7000-8000-000000000301';

const item = {
  id: employeeId,
  name_ar: 'سارة',
  name_en: 'Sarah',
  employee_number: 7,
};

const page = { time_zone: 'Asia/Kuwait', items: [item], next_cursor: null };

it('the query takes the cursor and the limit, and refuses anything else', () => {
  expect(commissionPlanEmployeeListQuery.parse({})).toEqual({ limit: 20 });
  expect(commissionPlanEmployeeListQuery.parse({ limit: 1 }).limit).toBe(1);
  expect(commissionPlanEmployeeListQuery.parse({ limit: '50' }).limit).toBe(50);
  expect(commissionPlanEmployeeListQuery.safeParse({ limit: 0 }).success).toBe(false);
  expect(commissionPlanEmployeeListQuery.safeParse({ limit: 51 }).success).toBe(false);
  expect(commissionPlanEmployeeListQuery.safeParse({ limit: 1.5 }).success).toBe(false);
  expect(commissionPlanEmployeeListQuery.safeParse({ cursor: 'abc-123_XYZ' }).success).toBe(true);
  expect(commissionPlanEmployeeListQuery.safeParse({ cursor: 'abc/123' }).success).toBe(false);
  expect(commissionPlanEmployeeListQuery.safeParse({ cursor: 'a'.repeat(513) }).success).toBe(
    false,
  );
  expect(commissionPlanEmployeeListQuery.safeParse({ business_id: employeeId }).success).toBe(
    false,
  );
});

it('the item carries the names and the employee number only', () => {
  expect(commissionPlanEmployeeListItem.parse(item)).toEqual(item);
  expect(commissionPlanEmployeeListItem.safeParse({ ...item, name_ar: null }).success).toBe(true);
  expect(commissionPlanEmployeeListItem.safeParse({ ...item, employee_number: 1 }).success).toBe(
    true,
  );
  expect(
    commissionPlanEmployeeListItem.safeParse({ ...item, employee_number: 999_999 }).success,
  ).toBe(true);
  expect(commissionPlanEmployeeListItem.safeParse({ ...item, employee_number: 0 }).success).toBe(
    false,
  );
  expect(
    commissionPlanEmployeeListItem.safeParse({ ...item, employee_number: 1_000_000 }).success,
  ).toBe(false);
  expect(commissionPlanEmployeeListItem.safeParse({ ...item, employee_number: null }).success).toBe(
    false,
  );
  expect(commissionPlanEmployeeListItem.safeParse({ ...item, employee_number: 1.5 }).success).toBe(
    false,
  );
});

it('the page carries the business timezone, the items and the next cursor', () => {
  expect(commissionPlanEmployeeList.parse(page)).toEqual(page);
  expect(commissionPlanEmployeeList.safeParse({ ...page, time_zone: 'Mars/Olympus' }).success).toBe(
    false,
  );
  expect(commissionPlanEmployeeList.safeParse({ ...page, next_cursor: 'abc/123' }).success).toBe(
    false,
  );
  expect(commissionPlanEmployeeList.safeParse({ ...page, items: [] }).success).toBe(true);
});

it('drops a field the browser does not know yet', () => {
  const parsedPage = commissionPlanEmployeeList.safeParse({ ...page, future_field: 'x' });
  expect(parsedPage.success).toBe(true);
  const pageKeys = parsedPage.success ? Object.keys(parsedPage.data) : [];
  expect(pageKeys).not.toContain('future_field');
  const parsedItem = commissionPlanEmployeeListItem.safeParse({
    ...item,
    branch_id: employeeId,
  });
  expect(parsedItem.success).toBe(true);
  const itemKeys = parsedItem.success ? Object.keys(parsedItem.data) : [];
  expect(itemKeys).not.toContain('branch_id');
});

// الحصرية على الحقول الزيادة بتشتغل في الوضع الصارم (اختبارات الـ API): responseObject strict.
it('refuses an extra key when the responses are strict', async () => {
  vi.stubEnv('POSPAY_STRICT_RESPONSES', '1');
  vi.resetModules();
  try {
    const strict = await import('../plan-employees.js');
    expect(
      strict.commissionPlanEmployeeListItem.safeParse({ ...item, branch_id: employeeId }).success,
    ).toBe(false);
    expect(
      strict.commissionPlanEmployeeList.safeParse({ ...page, future_field: 'x' }).success,
    ).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});

const path = '/v1/businesses/{businessId}/commission-plan-employees';
const document = buildOpenApiDocument();
const paths = document['paths'] as Record<
  string,
  Record<string, { operationId?: string; parameters?: { name?: string; schema?: unknown }[] }>
>;
const schemas = (document['components'] as { schemas: Record<string, unknown> }).schemas;

it('publishes the read under its operation id and its bounded parameters', () => {
  expect(paths[path]?.['get']?.operationId).toBe('listCommissionPlanEmployees');
  const parameters = paths[path]?.['get']?.parameters ?? [];
  const company = parameters.find((parameter) => parameter.name === 'x-company-id');
  const business = parameters.find((parameter) => parameter.name === 'businessId');
  const cursor = parameters.find((parameter) => parameter.name === 'cursor');
  const limit = parameters.find((parameter) => parameter.name === 'limit');
  expect(company).toMatchObject({ in: 'header', required: true });
  expect(business).toMatchObject({ in: 'path', required: true });
  expect(cursor?.schema).toMatchObject({ type: 'string', minLength: 1, maxLength: 512 });
  expect(limit?.schema).toMatchObject({
    type: 'integer',
    minimum: 1,
    maximum: 50,
    default: 20,
  });
});

it('publishes the new schemas as components', () => {
  expect(Object.keys(schemas)).toEqual(
    expect.arrayContaining([
      'CommissionPlanEmployeeListQuery',
      'CommissionPlanEmployeeListItem',
      'CommissionPlanEmployeeList',
    ]),
  );
});
