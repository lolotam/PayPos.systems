const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

// الـ 422 بيرجع أكتر من رفض، فبنية oneOf بتقول للعميل إن مفيش غلاف تاني مخفي.
const oneOfJson = (...schemas: string[]) => ({
  'application/json': {
    schema: { oneOf: schemas.map((schema) => ({ $ref: `#/components/schemas/${schema}` })) },
  },
});

const parameters = [
  {
    in: 'header',
    name: 'x-company-id',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  { in: 'path', name: 'businessId', required: true, schema: { type: 'string', format: 'uuid' } },
  { in: 'path', name: 'employeeId', required: true, schema: { type: 'string', format: 'uuid' } },
];

const idempotencyKey = {
  in: 'header',
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 255 },
};

// المؤشر والحدود مطابقة للـ query نفسه، عشان العميل يبقى عارف حدوده من مكان واحد.
const listQueryParameters = [
  { in: 'query', name: 'service_id', schema: { type: 'string', format: 'uuid' } },
  {
    in: 'query',
    name: 'cursor',
    schema: { type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' },
  },
  {
    in: 'query',
    name: 'limit',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
];

const errors = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };
const forbidden = { description: 'Uniform 403 refusal', content: json('ErrorEnvelope') };

export const commissionServiceOverridePaths = {
  '/v1/businesses/{businessId}/employees/{employeeId}/commission-overrides': {
    post: {
      operationId: 'createCommissionServiceOverride',
      description:
        'Creates one insert-only service override for the employee (FR-011). The rule is FOLLOW_PLAN, ZERO, PCT (basis points 0…10000) or FIXED (a KWD amount with exactly three decimals). FOLLOW_PLAN means the employee plan; only the absence of an eligible override falls back to the rule snapshot saved on the sale line. The service is checked in the business before anything is written. Requires manage:commission-plans:business and the commissions feature. The row and its audit entry commit in one transaction; the table is append-only, so a later override supersedes an earlier one by the engine order and never by an update.',
      parameters: [...parameters, idempotencyKey],
      requestBody: { required: true, content: json('CreateCommissionServiceOverrideInput') },
      responses: {
        '201': {
          description: 'Stored service override',
          content: json('CommissionServiceOverride'),
        },
        '400': { description: 'Malformed request body', content: json('ErrorEnvelope') },
        '403': forbidden,
        '404': {
          description: 'EMPLOYEE_NOT_FOUND or SERVICE_NOT_FOUND',
          content: json('ErrorEnvelope'),
        },
        '409': {
          description: 'COMMISSION_PERIOD_CLOSED or IDEMPOTENCY_KEY_IN_PROGRESS',
          content: json('ErrorEnvelope'),
        },
        '422': {
          description:
            'COMMISSION_EFFECTIVE_FROM_PAST when effective_from is before today, or IDEMPOTENCY_KEY_REUSED when the same Idempotency-Key is sent with another body.',
          content: oneOfJson(
            'CommissionEffectiveFromPastError',
            'CommissionPlanIdempotencyKeyReusedError',
          ),
        },
        default: errors,
      },
    },
    get: {
      operationId: 'listCommissionServiceOverrides',
      description:
        'Current and historical service overrides of the employee (FR-013). is_current is the server’s own verdict on the single row the engine applies today for that service, so the client reads it and never recomputes it from the dates; every other row is history, and each row keeps the effective date it was saved with, so a future row stays visible. service_id narrows the list to one service. Requires manage:commission-plans:business and the commissions feature. Reads only.',
      parameters: [...parameters, ...listQueryParameters],
      responses: {
        '200': {
          description: 'Current and historical overrides of the employee',
          content: json('CommissionServiceOverrideList'),
        },
        '400': { description: 'Invalid cursor or query', content: json('ErrorEnvelope') },
        '403': forbidden,
        '404': { description: 'EMPLOYEE_NOT_FOUND', content: json('ErrorEnvelope') },
        default: errors,
      },
    },
  },
};
