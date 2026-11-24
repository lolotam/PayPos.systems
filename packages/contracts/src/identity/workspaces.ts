import { z } from 'zod';
import { responseObject } from '../response-object.js';

import { nameAr, nameEn } from '../bilingual/names.js';
import { country } from '../reference/country.js';
import { timeZone } from '../reference/time-zone.js';
import { id } from '../scalars/id.js';
import { verticalType } from '../tenancy/business.js';

// الشركات والنشاطات والفروع اللي اليوزر عضو فيها — شاشة اختيار الشركة في الأدمن.
// في OpenAPI 3.0.3 لازم الـ enum القابل للـ null يسمح بـ null داخل قائمة القيم بتاعته نفسها.
const workspaceCountry = z
  .enum(country.options)
  .nullable()
  .meta({ enum: [...country.options, null] });

export const workspaceBranch = responseObject({
  id,
  name_ar: nameAr.nullable(),
  name_en: nameEn,
  effective_timezone: timeZone,
  is_active: z.boolean(),
}).meta({ id: 'WorkspaceBranch' });

export const workspaceBusiness = responseObject({
  id,
  name_ar: nameAr.nullable(),
  name_en: nameEn,
  business_type: verticalType,
  country: workspaceCountry,
  branches: z.array(workspaceBranch),
}).meta({ id: 'WorkspaceBusiness' });

/** Names of one company the caller can reach. Identity adds role_code and scope before the response leaves. */
export const workspaceCompanyNames = responseObject({
  id,
  name_ar: nameAr.nullable(),
  name_en: nameEn,
  businesses: z.array(workspaceBusiness),
});

const roleCode = z.string().regex(/^[a-z][a-z_]{0,63}$/);

export const workspaceCompany = workspaceCompanyNames
  .extend({
    role_code: roleCode,
    scope: z.enum(['COMPANY', 'BUSINESS', 'BRANCH']),
  })
  .meta({ id: 'WorkspaceCompany' });

/** قدرات الشريحة المتاحة على السيرفر: اللوحة بتقرأها بدل ما تخمّن وتطلب مسار مقفول. */
export const workspaceCapabilities = responseObject({ staff_access: z.boolean() }).meta({
  id: 'WorkspaceCapabilities',
});

export const myWorkspacesResponse = responseObject({
  companies: z.array(workspaceCompany),
  capabilities: workspaceCapabilities,
}).meta({
  id: 'MyWorkspacesResponse',
});

export type WorkspaceBranch = z.infer<typeof workspaceBranch>;
export type WorkspaceBusiness = z.infer<typeof workspaceBusiness>;
export type WorkspaceCompanyNames = z.infer<typeof workspaceCompanyNames>;
export type WorkspaceCompany = z.infer<typeof workspaceCompany>;
export type WorkspaceCapabilities = z.infer<typeof workspaceCapabilities>;
export type MyWorkspacesResponse = z.infer<typeof myWorkspacesResponse>;

/** قارئ الأدمن بيتحمّل رد API أقدم أثناء النشر، والحقول تفضل إلزامية في عقد الرد الجديد. */
const workspaceBusinessRead = workspaceBusiness.partial({ business_type: true, country: true });
const workspaceCompanyRead = workspaceCompany.extend({
  businesses: z.array(workspaceBusinessRead),
});
export const myWorkspacesReadResponse = myWorkspacesResponse.extend({
  companies: z.array(workspaceCompanyRead),
});
export type WorkspaceBusinessRead = z.infer<typeof workspaceBusinessRead>;
export type WorkspaceCompanyRead = z.infer<typeof workspaceCompanyRead>;
export type MyWorkspacesReadResponse = z.infer<typeof myWorkspacesReadResponse>;
