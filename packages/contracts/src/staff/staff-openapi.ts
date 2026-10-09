import { schedulesPaths } from './schedules-openapi.js';
import { z } from 'zod';
import { employeeNameMatches, employeeNameMatchesInput } from './employee-name-matches.js';
const nameMatchesJson = (schema: typeof employeeNameMatches | typeof employeeNameMatchesInput) => ({
  'application/json': {
    schema: z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input', metadata: z.registry() }),
  },
});
const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});
const parameters = [
  {
    in: 'header',
    name: 'x-company-id',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  { in: 'path', name: 'businessId', required: true, schema: { type: 'string', format: 'uuid' } },
];
const errors = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };
export const staffPaths = {
  ...schedulesPaths,
  '/v1/businesses/{businessId}/employees/name-matches': {
    post: {
      operationId: 'employeeNameMatches',
      description:
        'Read-only advisory name check in the same business. Requires manage:employees:business and staff feature. Names stay in the body; invisible matches set only hidden_exists, never a count or details.',
      parameters,
      requestBody: { required: true, content: nameMatchesJson(employeeNameMatchesInput) },
      responses: {
        '200': {
          description: 'EmployeeNameMatches',
          content: nameMatchesJson(employeeNameMatches),
        },
        '400': errors,
        '403': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/employees/{employeeId}/salaries': {
    get: {
      operationId: 'salaryHistory',
      description:
        'Restricted salary history. Missing and inaccessible share 404. Owner or explicit personal read grant; DENY wins. Requires staff feature.',
      parameters: [
        ...parameters,
        {
          in: 'path',
          name: 'employeeId',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        { in: 'query', name: 'cursor', schema: { type: 'string', format: 'date' } },
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        '200': { description: 'Salary history page', content: json('SalaryHistoryPage') },
        '404': errors,
        default: errors,
      },
    },
    post: {
      operationId: 'setSalary',
      description:
        'Set monthly basic salary on any date. Same date replaces entry and increments revision. Requires read and manage salary access; row, audit and SalaryChanged commit together.',
      parameters: [
        ...parameters,
        {
          in: 'path',
          name: 'employeeId',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        {
          in: 'header',
          name: 'Idempotency-Key',
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 255 },
        },
      ],
      requestBody: { required: true, content: json('SetSalaryInput') },
      responses: {
        '200': { description: 'Set salary', content: json('EmployeeSalary') },
        '400': errors,
        '404': errors,
        '409': errors,
        '422': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/employees': {
    get: {
      operationId: 'listEmployees',
      description:
        'Cursor-paginated employees; persisted primary and all active branches require manage:employees:business. DENY wins. Requires staff feature.',
      parameters: [
        ...parameters,
        { in: 'query', name: 'cursor', schema: { type: 'string', format: 'uuid' } },
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        '200': { description: 'Employee page', content: json('EmployeePage') },
        default: errors,
      },
    },
    post: {
      operationId: 'createEmployee',
      description:
        'Requires manage:employees:business at the primary branch and staff feature. Missing, other-business and other-company primary branches share EMPLOYEE_BRANCH_NOT_FOUND (404), before target permission, feature or employee diagnostics. Grants no access. A linked user must have an active membership in this company; unknown and foreign users share EMPLOYEE_USER_LINK_UNAVAILABLE (400). Duplicate names and future hires are allowed. Contract end before hire returns EMPLOYEE_CONTRACT_END_BEFORE_HIRE (400); an active user/business link conflict returns EMPLOYEE_USER_ALREADY_LINKED (409).',
      parameters,
      requestBody: { required: true, content: json('CreateEmployeeInput') },
      responses: {
        '201': { description: 'Created employee', content: json('Employee') },
        '400': errors,
        '404': errors,
        '409': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/employees/{employeeId}': {
    patch: {
      operationId: 'updateEmployee',
      description:
        'Full editable employee replacement against expected_revision. All persisted and requested branches require manage:employees:business and staff feature. After persisted-source access, missing, other-business and other-company requested branches share EMPLOYEE_BRANCH_NOT_FOUND (404), before target permission, feature, revision or employee diagnostics. Never grants access. Preserves branch history using the supplied branch_effective_date, with start-inclusive/end-exclusive intervals. Closing requires a date strictly after the start. Overlap with open or closed history returns EMPLOYEE_BRANCH_HISTORY_OVERLAP (409); closed history is immutable (EMPLOYEE_BRANCH_HISTORY_IMMUTABLE, 409). Adjacent intervals are allowed. Stale revision returns EMPLOYEE_REVISION_CONFLICT (409).',
      parameters: [
        ...parameters,
        {
          in: 'path',
          name: 'employeeId',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      requestBody: { required: true, content: json('UpdateEmployeeInput') },
      responses: {
        '200': { description: 'Updated employee', content: json('EmployeeDetail') },
        '400': errors,
        '403': errors,
        '404': errors,
        '409': errors,
        default: errors,
      },
    },
    get: {
      operationId: 'getEmployee',
      description:
        'Requires manage:employees:business at the persisted employee business and primary branch, with DENY winning, and the staff feature. Branch-only ALLOW is accepted. Inaccessible and missing employees share NOT_FOUND (404).',
      parameters: [
        ...parameters,
        {
          in: 'path',
          name: 'employeeId',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': { description: 'Persisted employee', content: json('EmployeeDetail') },
        '404': errors,
        default: errors,
      },
    },
  },
};
