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
import { EmployeeAccessPhoneForm } from './employee-access-phone-form';
import { EmployeeAccessPinResetForm } from './employee-access-pin-reset-form';
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
          {shown.can_manage && shown.state === 'ACTIVE' ? (
            <EmployeeAccessActiveActions
              companyId={companyId}
              businessId={businessId}
              employeeId={employeeId}
            />
          ) : null}
          {shown.can_cancel && shown.state === 'PENDING' ? (
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

/** أزرار الدخول الفعّال: إعادة ضبط الرقم السري وتغيير الهاتف، وكل واحد بيملك فتح نموذجه. */
function EmployeeAccessActiveActions(props: {
  companyId: string;
  businessId: string;
  employeeId: string;
}) {
  return (
    <>
      <EmployeeAccessPinReset {...props} />
      <EmployeeAccessPhoneChange {...props} />
    </>
  );
}

/** زر تغيير الهاتف ونموذجه: النموذج بيتفتح بقيم فاضية كل مرة فالهاتف والرقم ما بيتخزنوش. */
function EmployeeAccessPhoneChange({
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
  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t(locale, 'staff.changePhone')}
      </Button>
    );
  }
  return (
    <EmployeeAccessPhoneForm
      companyId={companyId}
      businessId={businessId}
      employeeId={employeeId}
      onClose={close}
    />
  );
}

/** زر إعادة الضبط ونموذجه: هو اللي بيملك فتح النموذج، عشان القسم يفضل قصير. */
function EmployeeAccessPinReset({
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
  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t(locale, 'staff.resetPin')}
      </Button>
    );
  }
  return (
    <EmployeeAccessPinResetForm
      companyId={companyId}
      businessId={businessId}
      employeeId={employeeId}
      onClose={close}
    />
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
