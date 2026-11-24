'use client';
import type { StaffAccessState } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

/** قراءة الحالة المعروضة: الدور والفرع وآخر ثلاثة أرقام من الهاتف فقط. */
export function EmployeeAccessReadout({ state }: { state: StaffAccessState }) {
  const locale = useLocale();
  const role =
    state.role === null
      ? '—'
      : state.role === 'reception'
        ? t(locale, 'staff.roleReception')
        : t(locale, 'staff.roleStaff');
  return (
    <dl className="flex flex-col gap-1">
      <div className="flex gap-2">
        <dt>{t(locale, 'staff.accessRole')}</dt>
        <dd>{role}</dd>
      </div>
      <div className="flex gap-2">
        <dt>{t(locale, 'staff.accessBranch')}</dt>
        <dd dir="ltr">{state.branch_id ?? '—'}</dd>
      </div>
      <div className="flex gap-2">
        <dt>{t(locale, 'staff.accessPhone')}</dt>
        <dd dir="ltr">{state.phone_last3 ?? '—'}</dd>
      </div>
    </dl>
  );
}
