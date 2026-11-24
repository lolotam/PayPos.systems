'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useCallback, useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';
import { useCancelPendingStaffAccess } from '../api/use-cancel-pending-staff-access';
import { useEmployeeStaffAccess } from '../api/use-employee-staff-access';
import { EmployeeAccessGrantForm } from './employee-access-grant-form';
import { EmployeeAccessReadout } from './employee-access-readout';

function stateLine(state: 'NONE' | 'PENDING' | 'ACTIVE' | 'STOPPED', locale: 'ar' | 'en'): string {
  if (state === 'NONE') return t(locale, 'staff.accessNone');
  if (state === 'PENDING') return t(locale, 'staff.accessPending');
  if (state === 'STOPPED') return t(locale, 'staff.accessStopped');
  return t(locale, 'staff.accessActive');
}

/** قسم دخول الموظفة في لوحة الموظفين: الحالة وزر الإعطاء وزر إلغاء المعلق بلا أي هاتف كامل. */
export function EmployeeAccessSection({
  companyId,
  businessId,
  employeeId,
}: {
  companyId: string;
  businessId: string;
  employeeId: string;
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // القدرة مقفولة على السيرفر: القسم بيختفي وبيترد على مفيش طلب أصلاً (AC-ACT-17).
  const staffAccess = useWorkspace().staffAccess === true;
  const query = useEmployeeStaffAccess(companyId, businessId, employeeId, staffAccess);
  const cancel = useCancelPendingStaffAccess(companyId, businessId, employeeId);
  const state = query.data;
  if (!staffAccess) return null;
  // البوابة 503 تعني القدرة مطفأة على السيرفر — القسم يختفي بلا رسالة (plan §1.1).
  if (query.isError) {
    if ((query.error as { code?: string } | null)?.code === 'NOT_READY') return null;
    return <p role="alert">{envelopeMessage(query.error, locale)}</p>;
  }
  const shown = state ?? null;
  return (
    <section className="flex flex-col gap-2" aria-label={t(locale, 'staff.accessTitle')}>
      <h3>{t(locale, 'staff.accessTitle')}</h3>
      {shown !== null ? (
        <>
          <p>{stateLine(shown.state, locale)}</p>
          {shown.state === 'ACTIVE' || shown.state === 'PENDING' ? (
            <EmployeeAccessReadout state={shown} />
          ) : null}
          {shown.can_manage && shown.state !== 'ACTIVE' ? (
            <Button type="button" variant="outline" onClick={() => setOpen(true)}>
              {t(locale, 'staff.giveAccess')}
            </Button>
          ) : null}
          {shown.can_manage && shown.state === 'PENDING' ? (
            <PendingCancel cancel={cancel} locale={locale} />
          ) : null}
        </>
      ) : null}
      {open ? (
        <EmployeeAccessGrantForm
          companyId={companyId}
          businessId={businessId}
          employeeId={employeeId}
          onClose={close}
        />
      ) : null}
    </section>
  );
}

function PendingCancel({
  cancel,
  locale,
}: {
  cancel: ReturnType<typeof useCancelPendingStaffAccess>;
  locale: 'ar' | 'en';
}) {
  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        disabled={cancel.isPending}
        onClick={() => cancel.mutate()}
      >
        {t(locale, 'staff.cancelPending')}
      </Button>
      {cancel.isError ? <p role="alert">{envelopeMessage(cancel.error, locale)}</p> : null}
    </div>
  );
}
