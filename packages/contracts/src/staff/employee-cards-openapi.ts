const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});
const errors = { description: 'Error envelope', content: json('ErrorEnvelope') };
const company = {
  in: 'header',
  name: 'x-company-id',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const business = { in: 'path', name: 'businessId', required: true, schema: { type: 'string', format: 'uuid' } };
const employee = { in: 'path', name: 'employeeId', required: true, schema: { type: 'string', format: 'uuid' } };
const card = { in: 'path', name: 'cardId', required: true, schema: { type: 'string', format: 'uuid' } };
const idempotency = {
  in: 'header',
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 255 },
};
const base = '/v1/businesses/{businessId}/employees/{employeeId}/cards';

export const employeeCardPaths = {
  [base]: {
    get: {
      operationId: 'readEmployeeCards',
      description: 'The active attendance card for the employee, with manage capability.',
      parameters: [company, business, employee],
      responses: {
        '200': { description: 'Employee cards view', content: json('EmployeeCardsView') },
        default: errors,
      },
    },
    post: {
      operationId: 'issueEmployeeCard',
      description:
        'Issue an active attendance card; the previous active card is replaced and both changes are audited.',
      parameters: [company, business, employee, idempotency],
      requestBody: { required: true, content: json('IssueEmployeeCardInput') },
      responses: {
        '200': { description: 'Issued card', content: json('EmployeeCard') },
        default: errors,
      },
    },
  },
  [`${base}/{cardId}/revoke`]: {
    post: {
      operationId: 'revokeEmployeeCard',
      description: 'Revoke an active attendance card; the change is audited.',
      parameters: [company, business, employee, card, idempotency],
      responses: {
        '200': { description: 'Revoked card', content: json('EmployeeCard') },
        default: errors,
      },
    },
  },
};
