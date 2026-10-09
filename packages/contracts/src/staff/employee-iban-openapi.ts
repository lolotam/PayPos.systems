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
  { in: 'path', name: 'employeeId', required: true, schema: { type: 'string', format: 'uuid' } },
];
const errors = {
  description:
    'Bilingual refusal; inaccessible, missing, foreign and deleted employees share NOT_FOUND.',
  content: json('ErrorEnvelope'),
};
export const employeeIbanPaths = {
  '/v1/businesses/{businessId}/employees/{employeeId}/iban': {
    get: {
      operationId: 'getEmployeeIban',
      parameters,
      description:
        'Salary readers receive full bank details; employee managers receive only the last four IBAN characters. Uniform 404 otherwise. Staff feature required after access.',
      responses: {
        '200': {
          description: 'Current bank account, masked by access',
          content: json('EmployeeIbanView'),
        },
        '404': errors,
        default: errors,
      },
    },
    put: {
      operationId: 'setEmployeeIban',
      parameters,
      description:
        'Requires salary read and manage. Append-only revision with mandatory reason; stale revision or duplicate current IBAN returns 409 without identifying details. Same values are a no-op. No Idempotency-Key. Uniform 404 for inaccessible employees.',
      requestBody: { required: true, content: json('SetEmployeeIbanInput') },
      responses: {
        '200': { description: 'Current bank account', content: json('EmployeeIbanView') },
        '400': errors,
        '404': errors,
        '409': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/employees/{employeeId}/iban/history': {
    get: {
      operationId: 'employeeIbanHistory',
      description:
        'Full bank account history for salary readers only. Masked readers and inaccessible employees receive uniform 404.',
      parameters: [
        ...parameters,
        { in: 'query', name: 'cursor', schema: { type: 'integer', minimum: 1 } },
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        '200': { description: 'Descending revisions', content: json('EmployeeIbanHistoryPage') },
        '404': errors,
        default: errors,
      },
    },
  },
};
