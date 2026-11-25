'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useStopEmployeeStaffAccess } from '../api/use-stop-employee-staff-access';

/** زر «إيقاف الدخول»: نداء مباشر بلا نموذج، والخطأ بيظهر تحت الزر والحالة الملتزمة بتحل محل القراءة. */
export function EmployeeAccessStop({
  companyId,
  businessId,
  employeeId,
}: {
  companyId: string;
  businessId: string;
  employeeId: string;
}) {
  const locale = useLocale();
  const stop = useStopEmployeeStaffAccess(companyId, businessId, employeeId);
  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        disabled={stop.isPending}
        onClick={() => stop.mutate()}
      >
        {t(locale, 'staff.stopAccess')}
      </Button>
      {stop.isError ? <p role="alert">{envelopeMessage(stop.error, locale)}</p> : null}
    </div>
  );
}
