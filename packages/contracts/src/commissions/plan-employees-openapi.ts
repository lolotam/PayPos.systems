import { COMMISSION_PLAN_EMPLOYEE_CURSOR_MAX } from './plan-employees.js';

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

// المؤشر والحدود مطابقة للـ query نفسه، عشان العميل يبقى عارف حدوده من مكان واحد.
const listQueryParameters = [
  {
    in: 'query',
    name: 'cursor',
    schema: {
      type: 'string',
      minLength: 1,
      maxLength: COMMISSION_PLAN_EMPLOYEE_CURSOR_MAX,
      pattern: '^[A-Za-z0-9_-]+$',
    },
  },
  {
    in: 'query',
    name: 'limit',
    schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
  },
];

const errors = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };
const forbidden = { description: 'Uniform 403 refusal', content: json('ErrorEnvelope') };

export const commissionPlanEmployeePaths = {
  '/v1/businesses/{businessId}/commission-plan-employees': {
    get: {
      operationId: 'listCommissionPlanEmployees',
      description:
        'The plan screens’ own employee list (FR-010a). A holder of manage:commission-plans:business without manage:employees:business (the accountant by default) reaches the plan builder through this read; the staff employee routes stay closed to them. The items are the business’s employees with deleted_at IS NULL, ordered by (name_en_key, id), and carry the names and the employee number only — no branch, role, salary, phone, document or user link. time_zone is the business’s own timezone, never a branch’s. The cursor is opaque, bounded and bound to the company, the business and that order; a malformed cursor, or one from another scope, is VALIDATION_FAILED. When a stored name key is too long for the next page’s cursor, the page is refused with 503 COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE: that is stored data needing repair, not a client error, and a last page with no next cursor is still returned (PP-122). Requires manage:commission-plans:business and the commissions feature; a device session is refused. Reads only.',
      parameters: [...parameters, ...listQueryParameters],
      responses: {
        '200': {
          description: 'The business employees the plan builder offers',
          content: json('CommissionPlanEmployeeList'),
        },
        '400': { description: 'Invalid cursor or query', content: json('ErrorEnvelope') },
        '401': { description: 'No individual session', content: json('ErrorEnvelope') },
        '403': forbidden,
        '503': {
          description:
            'COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE: a stored key is too long for the next cursor',
          content: json('ErrorEnvelope'),
        },
        default: errors,
      },
    },
  },
};
