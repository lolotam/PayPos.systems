const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

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
  {
    in: 'header',
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 255 },
  },
];

export const commissionPeriodRepairPaths = {
  '/v1/businesses/{businessId}/employees/{employeeId}/commission-period-repairs': {
    post: {
      operationId: 'createCommissionPeriodRepair',
      description:
        'Repairs a closed month that has an open NO_PLAN blocked correction (FR-047): stores one repair plan version that applies only inside that month, recomputes the month, posts the corrections into the target the earliest-DRAFT rule chooses and resolves the block, all in one transaction under one ascending statement-lock call. If the recompute then needs a missing salary, the same block row becomes NO_SALARY, nothing is posted and the version and its audit entry stay (CM-52b). Requires manage:commission-plans:business and the commissions feature; a device session is refused. A change of the business month while waiting for the locks is refused with TRANSACTION_RETRY_REQUIRED; retry the request.',
      parameters,
      requestBody: { required: true, content: json('CreateCommissionPeriodRepairInput') },
      responses: {
        '201': {
          description: 'The repair version and the block',
          content: json('CommissionPeriodRepair'),
        },
        '403': { description: 'Uniform 403 refusal', content: json('ErrorEnvelope') },
        '409': {
          description:
            'TRANSACTION_RETRY_REQUIRED (the month rolled over), COMMISSION_PERIOD_CLOSED (no DRAFT month to post into), IDEMPOTENCY_KEY_IN_PROGRESS',
          content: json('ErrorEnvelope'),
        },
        '422': {
          description:
            'COMMISSION_REPAIR_NOT_ALLOWED when no open NO_PLAN block exists for the employee and month (including a NO_SALARY block or a resolved one, and a month before the business started or not yet closed), COMMISSION_PLAN_INVALID with details.code, or IDEMPOTENCY_KEY_REUSED.',
          content: oneOfJson(
            'CommissionRepairNotAllowedError',
            'CommissionPlanInvalidError',
            'CommissionPlanIdempotencyKeyReusedError',
          ),
        },
        default: { description: 'Bilingual refusal', content: json('ErrorEnvelope') },
      },
    },
  },
};
