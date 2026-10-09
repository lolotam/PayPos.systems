import { expect, it } from 'vitest';
import { staffPaths } from './staff-openapi.js';
import {
  employeeNameMatch,
  employeeNameMatches,
  employeeNameMatchesInput,
} from './employee-name-matches.js';

const id = '01920000-0000-7000-8000-0000000000ab';
const match = { id, name_en: 'Sara', name_ar: null, primary_branch_id: id, role_code: 'staff' };

it('accepts only name fields and an optional canonical exclusion UUID', () => {
  expect(employeeNameMatchesInput.safeParse({}).success).toBe(false);
  expect(
    employeeNameMatchesInput.parse({
      name_en: ' Sara ',
      name_ar: ' سارة ',
      exclude_employee_id: id.toUpperCase(),
    }),
  ).toEqual({ name_en: 'Sara', name_ar: 'سارة', exclude_employee_id: id });
  expect(employeeNameMatchesInput.parse({ name_en: 'Sara' })).toEqual({ name_en: 'Sara' });
  expect(employeeNameMatchesInput.parse({ name_en: 'Sara', name_ar: null }).name_ar).toBeNull();
  for (const change of [
    { company_id: id },
    { name_en: '' },
    { name_en: '  ' },
    { name_en: 'a'.repeat(256) },
    { name_ar: ' ' },
    { name_ar: 'a'.repeat(256) },
    { exclude_employee_id: 'invalid' },
  ])
    expect(employeeNameMatchesInput.safeParse({ name_en: 'Sara', ...change }).success).toBe(false);
  expect(
    employeeNameMatchesInput.safeParse({ name_en: 'a'.repeat(255), name_ar: 'ب'.repeat(255) })
      .success,
  ).toBe(true);
});

it('publishes a body-only read with the same generated request and response shapes', () => {
  const route = staffPaths['/v1/businesses/{businessId}/employees/name-matches'].post;
  expect(route.parameters.map((parameter) => parameter.name)).toEqual([
    'x-company-id',
    'businessId',
  ]);
  expect(route.requestBody.content['application/json'].schema).toMatchObject({
    type: 'object',
    required: ['name_en'],
    additionalProperties: false,
    properties: { name_en: { minLength: 1, maxLength: 255 } },
  });
  expect(route.responses['200'].content['application/json'].schema).toMatchObject({
    type: 'object',
    required: ['matches', 'visible_total', 'hidden_count'],
    properties: { matches: { type: 'array', maxItems: 10 } },
  });
  expect(employeeNameMatchesInput.meta()?.id).toBe('EmployeeNameMatchesInput');
  expect(employeeNameMatches.meta()?.id).toBe('EmployeeNameMatches');
});

it('validates the visible projection, ten-row cap and non-negative integer totals', () => {
  expect(employeeNameMatch.parse(match)).toEqual(match);
  const response = { matches: [match], visible_total: 1, hidden_count: 0 };
  expect(employeeNameMatches.parse(response)).toEqual(response);
  expect(
    employeeNameMatches.safeParse({ ...response, matches: Array.from({ length: 10 }, () => match) })
      .success,
  ).toBe(true);
  for (const change of [
    { matches: Array.from({ length: 11 }, () => match) },
    { visible_total: -1 },
    { hidden_count: -1 },
    { visible_total: 1.5 },
    { hidden_count: 0.5 },
  ])
    expect(employeeNameMatches.safeParse({ ...response, ...change }).success).toBe(false);
  for (const change of [
    { id: 'invalid' },
    { primary_branch_id: 'invalid' },
    { role_code: 'device' },
    { name_ar: undefined },
  ])
    expect(employeeNameMatch.safeParse({ ...match, ...change }).success).toBe(false);
});
