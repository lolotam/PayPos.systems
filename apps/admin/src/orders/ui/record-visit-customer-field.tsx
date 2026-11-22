'use client';
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
}: {
  scope: SessionServiceScope;
  result: SessionRecordingResult;
  recording: SessionRecordingController;
  form: UseFormReturn<SessionDraftForm>;
  lastKnownCustomerId: { current: string | null };
  online: boolean;
  locked: boolean;
}) {
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
      disabled={!online || locked}
    />
  );
}
