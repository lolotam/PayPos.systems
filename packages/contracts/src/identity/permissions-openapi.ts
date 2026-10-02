const json = (name: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${name}` } },
});
const parameter = (where: string, name: string, required: boolean, schema: object) => ({
  in: where,
  name,
  required,
  schema,
});
const company = parameter('header', 'x-company-id', true, { type: 'string', format: 'uuid' });
const member = parameter('path', 'membershipId', true, { type: 'string', format: 'uuid' });
const pagination = [
  parameter('query', 'cursor', false, { type: 'string', format: 'uuid' }),
  parameter('query', 'limit', false, { type: 'integer', minimum: 1, maximum: 100, default: 20 }),
];
function operation(operationId: string, schema: string, status = '200') {
  return {
    operationId,
    responses: {
      [status]: { description: 'Permission screen result', content: json(schema) },
      default: { description: 'The API error envelope', content: json('ErrorEnvelope') },
    },
  };
}
export const permissionPaths = {
  '/v1/permissions/memberships': {
    get: {
      ...operation('listPermissionMemberships', 'PermissionMembershipPage'),
      parameters: [company, ...pagination],
    },
  },
  '/v1/permissions/memberships/{membershipId}': {
    get: {
      ...operation('getMembershipPermissions', 'MembershipPermissions'),
      parameters: [company, member, ...pagination],
    },
  },
  '/v1/permissions/memberships/{membershipId}/overrides': {
    post: {
      ...operation('grantPermissionOverride', 'PermissionOverride', '201'),
      parameters: [company, member],
      requestBody: { required: true, content: json('PermissionOverrideInput') },
    },
  },
};
