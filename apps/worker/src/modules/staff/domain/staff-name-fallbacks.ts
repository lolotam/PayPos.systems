import { t } from '@pospay/i18n';

/** الأسماء العامة لأجراس الحضور: الموظفة والفرع، من كتالوج اللغتين (CLAUDE.md §7). */
export const NOT_CLOCKED_IN_NAME_FALLBACK = {
  employeeAr: t('ar', 'inApp.generic_employee'),
  employeeEn: t('en', 'inApp.generic_employee'),
  branchAr: t('ar', 'inApp.generic_branch'),
  branchEn: t('en', 'inApp.generic_branch'),
};

/**
 * الأسماء العامة لأجراس الحضور والمستندات لما الاسم الحقيقي مش متاح.
 * نوع المستند العربي له مفتاحه الخاص (`generic_document_type`): الاسم العام «مستند» كان
 * بيتكرر بعد كلمة «مستند» في القالب (issue #568).
 */
export const STAFF_ALERT_NAME_FALLBACK = {
  ...NOT_CLOCKED_IN_NAME_FALLBACK,
  documentAr: t('ar', 'inApp.generic_document_type'),
  documentEn: t('en', 'inApp.generic_document'),
};
