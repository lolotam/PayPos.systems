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

/**
 * أوسع وصول Membership واحدة: الشركة كلها، أو نشاط واحد، أو فروعه.
 * بيتقاس على الشركة (أوسع عضوية فيها) وعلى كل نشاط على حدة (أوسع وصول اليوزر عليه).
 */
export const workspaceScope = z.enum(['COMPANY', 'BUSINESS', 'BRANCH']);

export const workspaceBusiness = responseObject({
  id,
  name_ar: nameAr.nullable(),
  name_en: nameEn,
  business_type: verticalType,
  country: workspaceCountry,
  branches: z.array(workspaceBranch),
  /**
   * معرّف ملف الشعار المربوط بالنشاط (TQ-1). غايب لما النشاط مالوش شعار أو لسه ما اتقراش.
   * القراءة بس للأعضاء اللي بتغطي النشاط؛ الرفع والاستبدال والحذف على manage:business-identity:business.
   */
  logo_file_id: id.nullable().optional(),
  /**
   * أوسع وصول اليوزر على النشاط ده: الشركة كلها، أو النشاط نفسه، أو فرع واحد فيه.
   * عضوية على الشركة مش بتكفي — اليوزر ممكن يكون وصل النشاط عن طريق فرع بس.
   * غايب في رد API أقدم، والقارئ بيرجع لنطاق الشركة كبديل.
   */
  scope: workspaceScope.optional(),
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
    scope: workspaceScope,
    /**
     * المالك الأساسي للشركة: اليوزر عنده عضوية المالك العامة على الشركة نفسها، حتى لو
     * أضيق دور فعّال عنده أقدم من دي. الأدمن بيحتاجها عشان يقبل مدخل دعوات الأعضاء
     * لغير صاحب الدور 'owner' (AC-ACT-22). غايب لما مش مالك.
     */
    is_owner: z.boolean().optional(),
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
  // API أقدم أثناء النشر ما بيبعتش capabilities: غيابها معناه إن القدرة مقفولة.
  capabilities: workspaceCapabilities.optional(),
});
export type WorkspaceBusinessRead = z.infer<typeof workspaceBusinessRead>;
export type WorkspaceCompanyRead = z.infer<typeof workspaceCompanyRead>;
export type MyWorkspacesReadResponse = z.infer<typeof myWorkspacesReadResponse>;
