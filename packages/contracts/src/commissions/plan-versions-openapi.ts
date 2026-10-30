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

const errors = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };
const forbidden = { description: 'Uniform 403 refusal', content: json('ErrorEnvelope') };

export const commissionPlanVersionPaths = {
  '/v1/businesses/{businessId}/employees/{employeeId}/commission-plan-versions': {
    post: {
      operationId: 'createCommissionPlanVersion',
      parameters: [...parameters, idempotencyKey],
      requestBody: { required: true, content: json('CreateCommissionPlanVersionInput') },
      responses: {
        '201': { description: 'Stored plan version', content: json('CommissionPlanVersion') },
        '403': forbidden,
        '409': {
          description: 'COMMISSION_PERIOD_NOT_DRAFT or COMMISSION_PERIOD_CLOSED',
          content: json('ErrorEnvelope'),
        },
        '422': {
          description:
            'COMMISSION_PLAN_INVALID with details.code, COMMISSION_EFFECTIVE_FROM_PAST when effective_from is before today, or COMMISSION_PERIOD_BEFORE_BUSINESS when a whole_period month precedes the business, or IDEMPOTENCY_KEY_REUSED when the same Idempotency-Key is sent with another body.',
          content: oneOfJson(
            'CommissionPlanInvalidError',
            'CommissionEffectiveFromPastError',
            'CommissionPeriodBeforeBusinessError',
            'CommissionPlanIdempotencyKeyReusedError',
          ),
        },
        default: errors,
      },
    },
    get: {
      operationId: 'listCommissionPlanVersions',
      parameters: [
        ...parameters,
        {
          in: 'query',
          name: 'cursor',
          schema: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        },
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        '200': {
          description: 'Plan versions, newest first',
          content: json('CommissionPlanVersionList'),
        },
        '403': forbidden,
        default: errors,
      },
    },
  },
};
