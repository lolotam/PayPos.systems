const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});
const workspace = [
  {
    in: 'header',
    name: 'x-company-id',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  },
  { in: 'path', name: 'businessId', required: true, schema: { type: 'string', format: 'uuid' } },
];
const employee = {
  in: 'path',
  name: 'employeeId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const pagination = [
  { in: 'query', name: 'cursor', schema: { type: 'string', format: 'uuid' } },
  {
    in: 'query',
    name: 'limit',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
];
const responses = (schema: string) => ({
  '200': { description: 'Scoped passkey result', content: json(schema) },
  default: {
    description: 'Bilingual refusal; unknown and inaccessible share NOT_FOUND',
    content: json('ErrorEnvelope'),
  },
});
export const unbindPasskeyPaths = {
  '/v1/businesses/{businessId}/employees/{employeeId}/passkeys': {
    get: {
      operationId: 'employeePasskeyHistory',
      parameters: [...workspace, employee, ...pagination],
      responses: responses('EmployeePasskeyHistory'),
    },
  },
  '/v1/businesses/{businessId}/employees/{employeeId}/passkeys/unbind': {
    post: {
      operationId: 'unbindEmployeePasskey',
      parameters: [...workspace, employee],
      description:
        'Scoped manager unbind, self forbidden. Binding/revision fence; mandatory trimmed reason. Audit and event atomic. No auth credential deletion.',
      requestBody: { required: true, content: json('UnbindPasskeyInput') },
      responses: responses('UnboundPasskey'),
    },
  },
  '/v1/businesses/{businessId}/employee-passkeys': {
    get: {
      operationId: 'listPasskeyEmployees',
      parameters: [...workspace, ...pagination],
      responses: responses('PasskeyEmployeePage'),
    },
  },
};
