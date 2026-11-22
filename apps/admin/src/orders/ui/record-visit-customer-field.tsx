'use client';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import type { UseFormReturn } from 'react-hook-form';
import type { SessionServiceScope } from '../api/use-session-services';
import type { SessionDraftForm } from '../model/session-drafts';
import type { SessionRecordingResult } from '../model/session-recording-result';
import type { SessionRecordingController } from '../model/use-session-recording';
import { changeSessionCustomer } from './record-service-session-customer';
import { SessionCustomerField } from './session-customer-field';

/**
 * حقل اختيار الزبونة في نموذج تسجيل الزيارة: يمرر نطاق النشاط والفرع لرابط باقات العميلة (42-4)
 * ويحافظ على سلوك تغيير الزبونة ومسح اختيارات الباقة عبر changeSessionCustomer.
 */
export function RecordVisitCustomerField({
  scope,
  result,
  recording,
  form,
  lastKnownCustomerId,
  online,
  locked,
  hideCustomer,
  onAccessDenied,
}: {
  scope: SessionServiceScope;
  result: SessionRecordingResult;
  recording: SessionRecordingController;
  form: UseFormReturn<SessionDraftForm>;
  lastKnownCustomerId: { current: string | null };
  online: boolean;
  locked: boolean;
  hideCustomer: boolean;
  onAccessDenied: () => void;
}) {
  const locale = useLocale();
  if (hideCustomer) return <p role="alert">{t(locale, 'serviceSessions.profileLoadFailed')}</p>;
  const handleDenied = () => {
    // الزيارة المحفوظة تحتفظ بهويتها؛ الاختيار المؤقت فقط اللي يتسقط.
    if (result.sessionId === null && result.customerId !== null)
      changeSessionCustomer(null, result, recording, form, lastKnownCustomerId);
    onAccessDenied();
  };
  return (
    <SessionCustomerField
      companyId={scope.companyId}
      branchId={scope.branchId}
      userId={scope.userId}
      packagesScope={scope}
      value={result.customer}
      profileCustomerId={result.customerId}
      onChange={(customer) =>
        changeSessionCustomer(customer, result, recording, form, lastKnownCustomerId)
      }
      onAccessDenied={handleDenied}
      disabled={!online || locked}
    />
  );
}
