'use client';
import { t } from '@pospay/i18n';
import { CircleAlert, EmptyState } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { companyNumbersListDenied } from '../model/company-employee-number-message';

/** رفض قراءة القائمة: رسالة «لا صلاحية» عند رفض الصلاحية، وإلا رسالة الخطأ نفسها. */
export function CompanyEmployeeNumbersError({ error }: { error: unknown }) {
  const locale = useLocale();
  return (
    <EmptyState
      role="alert"
      tone="danger"
      icon={<CircleAlert />}
      title={
        companyNumbersListDenied(error)
          ? t(locale, 'companyEmployeeNumbers.noAccess')
          : envelopeMessage(error, locale)
      }
    />
  );
}
