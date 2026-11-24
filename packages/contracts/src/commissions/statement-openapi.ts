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
  {
    in: 'path',
    name: 'period',
    required: true,
    schema: { type: 'string', pattern: '^(?!0000-)\\d{4}-(0[1-9]|1[0-2])$' },
  },
];

const errors = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };
const forbidden = { description: 'Uniform 403 refusal', content: json('ErrorEnvelope') };
const idempotencyParameter = {
  in: 'header',
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 255 },
};
const statementPath = '/v1/businesses/{businessId}/commission-statements/{period}';

export const commissionStatementPaths = {
  [statementPath]: {
    get: {
      operationId: 'getCommissionStatement',
      description:
        'The statement view of an open (DRAFT or REVIEWED) business month, computed on read in a read-only transaction: no row, fingerprint or lock is created (FR-025, D-25). generated is false until a review holder has generated it. Requires read:commissions:business and the commissions feature; a device session is refused. A business-wide reader (a current company- or business-scoped grant and no DENY) gets the CommissionStatementView with both current fingerprints, the reviewed ones and the changed-since-review flag with its cause; every other reader gets the CommissionStatementBranchView with her visible rows only and no whole-statement field. An APPROVED or PAID month is refused with COMMISSION_PERIOD_CLOSED until the frozen read ships with the approval part.',
      parameters,
      responses: {
        '200': {
          description: 'The month view, in the shape that matches the reader',
          content: oneOfJson('CommissionStatementView', 'CommissionStatementBranchView'),
        },
        '400': { description: 'Invalid business id or period', content: json('ErrorEnvelope') },
        '401': { description: 'No individual session', content: json('ErrorEnvelope') },
        '403': forbidden,
        '409': { description: 'COMMISSION_PERIOD_CLOSED', content: json('ErrorEnvelope') },
        default: errors,
      },
    },
  },
  [`${statementPath}/generate`]: {
    post: {
      operationId: 'generateCommissionStatement',
      description:
        'Generates the statement of a business month that has ended in the business timezone: under one statement lock it ensures the DRAFT row, computes the view and both fingerprints and stores current_fingerprint (FR-025). On a REVIEWED month it recomputes and stores current_fingerprint only and never touches the status or the reviewed values. Requires review:commissions:business and a business-wide read of commissions; a branch-scoped reader is refused with the uniform 403. A month that has not ended is refused with COMMISSION_PERIOD_NOT_ENDED and an APPROVED or PAID one with COMMISSION_PERIOD_CLOSED. Audits commission_statement.generated.',
      parameters: [...parameters, idempotencyParameter],
      responses: {
        '200': { description: 'The generated view', content: json('CommissionStatementView') },
        '403': forbidden,
        '409': {
          description: 'COMMISSION_PERIOD_CLOSED or IDEMPOTENCY_KEY_IN_PROGRESS',
          content: json('ErrorEnvelope'),
        },
        '422': {
          description: 'COMMISSION_PERIOD_NOT_ENDED or IDEMPOTENCY_KEY_REUSED',
          content: json('ErrorEnvelope'),
        },
        default: errors,
      },
    },
  },
  [`${statementPath}/review`]: {
    post: {
      operationId: 'reviewCommissionStatement',
      description:
        'Reviews a business month statement and certifies it (FR-029): under one statement lock it checks the month has ended and the status is DRAFT, recomputes the input fingerprint and the statement fingerprint the builder gives now, refuses a mismatch with the reviewer’s expected fingerprints (409 COMMISSION_FINGERPRINT_STALE), refuses a blocking issue with 422 COMMISSION_STATEMENT_BLOCKED, then stores REVIEWED with both reviewed fingerprints, the reviewer membership and the time, writes one audit entry and appends one StatementAwaitingApproval notice for the approvers in the same transaction. Requires review:commissions:business and a business-wide read of commissions; a branch-scoped reader is refused with the uniform 403 before any fingerprint is computed or returned. A month that is already REVIEWED is refused with 409 COMMISSION_PERIOD_NOT_DRAFT and an APPROVED or PAID one with 409 COMMISSION_PERIOD_CLOSED.',
      parameters: [...parameters, idempotencyParameter],
      requestBody: { required: true, content: json('CommissionStatementReviewInput') },
      responses: {
        '200': {
          description: 'The reviewed statement',
          content: json('CommissionStatementReviewResult'),
        },
        '403': forbidden,
        '409': {
          description:
            'COMMISSION_FINGERPRINT_STALE, COMMISSION_PERIOD_NOT_DRAFT, COMMISSION_PERIOD_CLOSED or IDEMPOTENCY_KEY_IN_PROGRESS',
          content: json('ErrorEnvelope'),
        },
        '422': {
          description:
            'COMMISSION_STATEMENT_BLOCKED, COMMISSION_PERIOD_NOT_ENDED or IDEMPOTENCY_KEY_REUSED',
          content: json('ErrorEnvelope'),
        },
        default: errors,
      },
    },
  },
  [`${statementPath}/return`]: {
    post: {
      operationId: 'returnCommissionStatement',
      description:
        'Returns a REVIEWED statement to DRAFT (FR-031): a holder of review:commissions:business or approve:commissions:business who is a business-wide reader clears the reviewed values under the statement lock, stores the reason in one insert-only commission_statement_returns row and writes one audit entry without the reason, all in one transaction. A branch-scoped reader is refused with the uniform 403 (CM-33d, CM-38b). An APPROVED or PAID month is refused with 409 COMMISSION_PERIOD_CLOSED under the same lock, an empty reason is refused with 422 COMMISSION_RETURN_REASON_INVALID and any other status that is not REVIEWED with 409 COMMISSION_STATEMENT_NOT_REVIEWED.',
      parameters: [...parameters, idempotencyParameter],
      requestBody: { required: true, content: json('CommissionStatementReturnInput') },
      responses: {
        '200': { description: 'The returned statement', content: json('CommissionStatementReturnResult') },
        '403': forbidden,
        '409': {
          description:
            'COMMISSION_STATEMENT_NOT_REVIEWED, COMMISSION_PERIOD_CLOSED or IDEMPOTENCY_KEY_IN_PROGRESS',
          content: json('ErrorEnvelope'),
        },
        '422': {
          description: 'COMMISSION_RETURN_REASON_INVALID or IDEMPOTENCY_KEY_REUSED',
          content: json('ErrorEnvelope'),
        },
        default: errors,
      },
    },
  },
};
