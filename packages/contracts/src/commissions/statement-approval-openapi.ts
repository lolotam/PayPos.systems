const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

const errors = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };
const approvePath = '/v1/businesses/{businessId}/commission-statements/{period}/approve';

export const commissionStatementApprovalPaths = {
  [approvePath]: {
    post: {
      operationId: 'approveCommissionStatement',
      description:
        'Approves a REVIEWED business month in one transaction (FR-032, ADR-0054 section 7): the access re-check and the authorized idempotent replay come first, then one ascending statement lock, then the month and status checks, then the coverage gate under the state-row lock (the explicit approval switch answers 403 FEATURE_DISABLED when off, an invalid or non-admitting proof 422 COMMISSION_COVERAGE_NOT_PROVEN), then the fingerprints (409 COMMISSION_FINGERPRINT_STALE), blocking issues (422 COMMISSION_STATEMENT_BLOCKED) and the ADR-0012 pending-event count (409 COMMISSION_UPDATES_PENDING), and finally the freeze of the statement rows, their attachment snapshot and the carries of negative balances (D-22). Requires approve:commissions:business, a business-wide read of commissions and the commissions feature. Nothing opens approval for a company by itself.',
      parameters: [
        {
          in: 'header',
          name: 'x-company-id',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        {
          in: 'path',
          name: 'businessId',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        {
          in: 'path',
          name: 'period',
          required: true,
          schema: { type: 'string', pattern: '^(?!0000-)\\d{4}-(0[1-9]|1[0-2])$' },
        },
        {
          in: 'header',
          name: 'Idempotency-Key',
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 255 },
        },
      ],
      requestBody: { required: true, content: json('CommissionStatementApproveRequest') },
      responses: {
        '200': {
          description: 'The frozen statement of the approved month',
          content: json('CommissionClosedStatementView'),
        },
        '403': {
          description: 'FORBIDDEN, or FEATURE_DISABLED while the approval switch is off',
          content: json('ErrorEnvelope'),
        },
        '409': {
          description:
            'COMMISSION_PERIOD_CLOSED, COMMISSION_STATEMENT_NOT_REVIEWED, COMMISSION_FINGERPRINT_STALE, COMMISSION_UPDATES_PENDING or IDEMPOTENCY_KEY_IN_PROGRESS, or TRANSACTION_RETRY_REQUIRED (retry the request)',
          content: json('ErrorEnvelope'),
        },
        '422': {
          description:
            'COMMISSION_PERIOD_NOT_ENDED, COMMISSION_STATEMENT_BLOCKED, COMMISSION_COVERAGE_NOT_PROVEN or IDEMPOTENCY_KEY_REUSED',
          content: json('ErrorEnvelope'),
        },
        default: errors,
      },
    },
  },
};
