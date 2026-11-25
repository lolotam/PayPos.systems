import {
  readCommissionFeatureEnabled,
  readCommissionScope,
} from '../src/modules/identity/persistence/commission-read-scope.ts';
import { readCommissionRequesterMembership } from '../src/modules/identity/persistence/commission-requester-membership.ts';

/**
 * القراءات الحقيقية اللي app.ts بيربطها في تصدير كشف العمولات (النطاق والميزة وعضوية الطالب)، من برّه الوحدات،
 * عشان اختبار تدفق الطلب والتحميل يشتغل على نفس الصلاحيات من غير ما وحدة العمولات تستورد identity.
 */
export const statementExportReaders = {
  scope: readCommissionScope,
  featureEnabled: readCommissionFeatureEnabled,
  requesterMembership: readCommissionRequesterMembership,
};
