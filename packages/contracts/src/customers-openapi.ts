const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

// مسار الاستقبال لموديول العملاء؛ منفصل عن openapi.ts عشان كل موديول يملك مساراته.
export const customerPaths = {
  '/v1/customers/find-or-create': {
    post: {
      operationId: 'findOrCreateCustomer',
      requestBody: { required: true, content: json('FindOrCreateCustomerInput') },
      responses: {
        '200': { description: 'Customer with masked phone', content: json('Customer') },
        default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
      },
      parameters: [
        {
          in: 'header',
          name: 'x-company-id',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      description:
        'Requires create:customers:company and the customers feature. Existing name and locale are preserved.',
    },
  },
};
