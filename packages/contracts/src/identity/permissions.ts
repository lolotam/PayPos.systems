import { z } from 'zod';

import { page, pageQuery } from '../pagination/cursor.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

export const permissionScopeType = z.enum(['COMPANY', 'BUSINESS', 'BRANCH']);
export const membershipPageQuery = pageQuery
  .extend({ cursor: id.optional() })
  .meta({ id: 'MembershipPageQuery' });
export const permissionOverrideInput = z
  .strictObject({
    permission_code: z.string().regex(/^[a-z][a-z-]*:[a-z][a-z-]*:(company|business|branch)$/),
    effect: z.enum(['ALLOW', 'DENY']),
    scope_type: permissionScopeType,
    scope_id: id,
    reason: z.string().trim().min(1).max(500),
    expires_at: timestamp.nullable(),
  })
  .meta({ id: 'PermissionOverrideInput' });
export const permissionOverride = permissionOverrideInput
  .extend({
    id,
    granted_by: id,
    granted_at: timestamp,
  })
  .meta({ id: 'PermissionOverride' });
export const permissionMembership = z
  .object({
    id,
    user_id: id.nullable(),
    employee_id: id.nullable(),
    role_code: z.string(),
    role_name_ar: z.string().nullable(),
    role_name_en: z.string(),
    scope_type: permissionScopeType,
    scope_id: id,
    starts_at: timestamp,
    ends_at: timestamp.nullable(),
  })
  .meta({ id: 'PermissionMembership' });
export const permissionMembershipPage = page(permissionMembership).meta({
  id: 'PermissionMembershipPage',
});
export const permissionOverridePage = page(permissionOverride).meta({
  id: 'PermissionOverridePage',
});
export const membershipPermissions = z
  .object({
    membership: permissionMembership,
    role_defaults: z.array(z.string()),
    permission_catalog: z.array(z.string()),
    overrides: permissionOverridePage,
    editing_enabled: z.boolean(),
  })
  .meta({ id: 'MembershipPermissions' });

export type PermissionOverrideInput = z.infer<typeof permissionOverrideInput>;
export type PermissionOverride = z.infer<typeof permissionOverride>;
export type PermissionMembership = z.infer<typeof permissionMembership>;
export type MembershipPermissions = z.infer<typeof membershipPermissions>;
