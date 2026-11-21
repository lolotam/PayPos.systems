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
  {
    in: 'path',
    name: 'period',
    required: true,
    schema: { type: 'string', pattern: '^(?!0000-)\\d{4}-(0[1-9]|1[0-2])$' },
  },
  {
    in: 'query',
    name: 'employee_id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  },
];

const errors = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };
const forbidden = { description: 'Uniform 403 refusal', content: json('ErrorEnvelope') };

export const commissionEstimatePaths = {
  '/v1/businesses/{businessId}/commissions/periods/{period}/estimate': {
    get: {
      operationId: 'getCommissionEstimate',
      description:
        'The live commission estimate of a business month (FR-021). One full-month engine run per candidate employee, computed on read in a read-only transaction and never stored. Requires read:commissions:business and the commissions feature; a device session is refused. A holder sees only the employees of her effective branch set (CS-Q20): a company- or business-scoped grant without any current DENY sees every employee, while a branch-scoped reader sees only the days she was attached to her branches and her figures are labelled partial. Tips and received corrections pass through unpriced. Reads only.',
      parameters,
      responses: {
        '200': {
          description: 'The visible employees of the month with their priced sources',
          content: json('CommissionEstimate'),
        },
        '400': {
          description: 'Invalid business id, period or employee id',
          content: json('ErrorEnvelope'),
        },
        '401': { description: 'No individual session', content: json('ErrorEnvelope') },
        '403': forbidden,
        default: errors,
      },
    },
  },
};
