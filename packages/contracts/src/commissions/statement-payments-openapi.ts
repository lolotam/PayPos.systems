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
  { in: 'path', name: 'period', required: true, schema: { $ref: '#/components/schemas/CommissionStatementPeriod' } },
];

const idempotencyKey = {
  in: 'header',
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 255 },
};

const errors = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };
const forbidden = { description: 'Uniform 403 refusal', content: json('ErrorEnvelope') };

export const commissionStatementPaymentPaths = {
  '/v1/businesses/{businessId}/commission-statements/{period}/mark-paid': {
    post: {
      operationId: 'markCommissionStatementPaid',
      parameters: [...parameters, idempotencyKey],
      requestBody: { required: true, content: json('MarkCommissionStatementPaidInput') },
      responses: {
        '200': {
          description: 'The statement now reads PAID with its payment record',
          content: json('MarkCommissionStatementPaidResponse'),
        },
        '403': forbidden,
        '409': {
          description:
            'COMMISSION_STATEMENT_NOT_APPROVED when the statement is DRAFT or REVIEWED, or COMMISSION_STATEMENT_ALREADY_PAID when it is PAID and a new Idempotency-Key is sent (CM-41).',
          content: oneOfJson(
            'CommissionStatementNotApprovedError',
            'CommissionStatementAlreadyPaidError',
          ),
        },
        '422': {
          description:
            'COMMISSION_PAID_ON_INVALID when paid_on is after today or before the approval month, or IDEMPOTENCY_KEY_REUSED when the same Idempotency-Key is sent with another body (CM-41).',
          content: oneOfJson(
            'CommissionPaidOnInvalidError',
            'CommissionStatementIdempotencyKeyReusedError',
          ),
        },
        default: errors,
      },
    },
  },
};
