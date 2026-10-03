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
];
const errors = { description: 'Bilingual refusal', content: json('ErrorEnvelope') };
export const staffPaths = {
  '/v1/businesses/{businessId}/employees': {
    post: {
      operationId: 'createEmployee',
      description:
        'Requires manage:employees:business and staff feature. Grants no access. A linked user must have an active membership in this company; unknown and foreign users share EMPLOYEE_USER_LINK_UNAVAILABLE (400). Duplicate names and future hires are allowed. Contract end before hire returns EMPLOYEE_CONTRACT_END_BEFORE_HIRE (400); an active user/business link conflict returns EMPLOYEE_USER_ALREADY_LINKED (409).',
      parameters,
      requestBody: { required: true, content: json('CreateEmployeeInput') },
      responses: {
        '201': { description: 'Created employee', content: json('Employee') },
        '400': errors,
        '409': errors,
        default: errors,
      },
    },
  },
  '/v1/businesses/{businessId}/employees/{employeeId}': {
    get: {
      operationId: 'getEmployee',
      description:
        'Requires manage:employees:business at the persisted employee business and primary branch, with DENY winning, and the staff feature. Branch-only ALLOW is accepted. Inaccessible and missing employees share NOT_FOUND (404).',
      parameters: [
        ...parameters,
        {
          in: 'path',
          name: 'employeeId',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': { description: 'Persisted employee', content: json('Employee') },
        '404': errors,
        default: errors,
      },
    },
  },
};
