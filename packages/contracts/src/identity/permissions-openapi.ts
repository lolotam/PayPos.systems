import { discountLimit, discountLimitInput } from './discount-limit.js';
import {
  membershipPageQuery,
  membershipPermissionsQuery,
  revokePermissionOverrideInput,
  permissionOverrideInput,
  permissionOverride,
  permissionMembership,
  permissionMembershipPage,
  permissionOverridePage,
  membershipPermissions,
} from './permissions.js';

export const permissionSchemas = [
  discountLimit,
  discountLimitInput,
  membershipPageQuery,
  membershipPermissionsQuery,
  revokePermissionOverrideInput,
  permissionOverrideInput,
  permissionOverride,
  permissionMembership,
  permissionMembershipPage,
  permissionOverridePage,
  membershipPermissions,
];

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
const companyPermissionPaths = {
  '/v1/permissions/memberships/{membershipId}/discount-limit': {
    post: {
      ...operation('setMembershipDiscountLimit', 'DiscountLimit'),
      description:
        'Requires manage:discount-limits:business at the resolved membership scope; self and canonical Owner holders are protected.',
      parameters: [company, member],
      requestBody: { required: true, content: json('DiscountLimitInput') },
    },
  },
  '/v1/permissions/memberships': {
    get: {
      ...operation('listPermissionMemberships', 'PermissionMembershipPage'),
      parameters: [company, ...pagination],
    },
  },
  '/v1/permissions/memberships/{membershipId}': {
    get: {
      ...operation('getMembershipPermissions', 'MembershipPermissions'),
      parameters: [
        company,
        member,
        ...pagination,
        parameter('query', 'history_cursor', false, { type: 'string', format: 'uuid' }),
      ],
    },
  },
  '/v1/permissions/memberships/{membershipId}/overrides': {
    post: {
      ...operation('grantPermissionOverride', 'PermissionOverride', '201'),
      parameters: [company, member],
      requestBody: { required: true, content: json('PermissionOverrideInput') },
    },
  },
  '/v1/permissions/memberships/{membershipId}/overrides/{overrideId}/revoke': {
    post: {
      ...operation('revokePermissionOverride', 'PermissionOverride'),
      parameters: [
        company,
        member,
        parameter('path', 'overrideId', true, { type: 'string', format: 'uuid' }),
      ],
      requestBody: { required: true, content: json('RevokePermissionOverrideInput') },
    },
  },
};

const business = parameter('path', 'businessId', true, { type: 'string', format: 'uuid' });
// نفس العقود والصفحات، لكن الحارس يستهدف النشاط وتصفية العضوية تسبق LIMIT.
export const permissionPaths = {
  ...companyPermissionPaths,
  ...Object.fromEntries(
    Object.entries(companyPermissionPaths)
      .filter(([path]) => !path.endsWith('/discount-limit'))
      .map(([path, methods]) => [
        path.replace('/v1/permissions', '/v1/businesses/{businessId}/permissions'),
        Object.fromEntries(
          Object.entries(methods).map(([method, operation]) => [
            method,
            {
              ...operation,
              operationId: `business_${operation.operationId}`,
              parameters: [business, ...operation.parameters],
            },
          ]),
        ),
      ]),
  ),
};
