const json = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

function operation(operationId: string, description: string, response: string) {
  return {
    operationId,
    responses: {
      '200': { description, content: json(response) },
      default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
    },
  };
}

// حوار إلغاء السطر بيقرأ عضويات المتصل من غير read:memberships:company، فمسارها منفصل عن صلاحيات الشركة.
export const mePaths = {
  '/v1/me/workspaces': {
    get: operation(
      'listMyWorkspaces',
      'The companies, businesses and branches this session can open',
      'MyWorkspacesResponse',
    ),
  },
  '/v1/me/memberships': {
    get: {
      ...operation(
        'listMyMemberships',
        "The caller's own active memberships in the selected company",
        'MyMembershipsResponse',
      ),
      parameters: [
        {
          in: 'header',
          name: 'x-company-id',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
    },
  },
};
