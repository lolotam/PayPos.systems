'use client';
import { t } from '@pospay/i18n';
import { defaultShiftMinutes } from '@pospay/domain';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeDefaultHours } from '../api/use-employee-default-hours';
import { useScheduleWorkspaceBranches } from '../api/use-schedule-settings';
import { scheduleDayKeys } from '../model/schedule-form';
import { EmployeeDefaultHoursForm } from './employee-default-hours-form';

export function EmployeeDefaultHoursSection(props: {
  companyId: string; businessId: string; userId: string; employeeId: string;
}) {
  const locale = useLocale();
  const { current, save, accessDenied } = useEmployeeDefaultHours(props.companyId, props.businessId, props.userId, props.employeeId);
  const names = useScheduleWorkspaceBranches({ ...props, branchId: '' });
  if (accessDenied || !current.isFetchedAfterMount || !current.data || current.isError) return null;
  return <section aria-label={t(locale, 'employeeDefaultHours.title')} className="flex flex-col gap-4">
    <h3 className="font-bold">{t(locale, 'employeeDefaultHours.title')}</h3>
    {current.data.branches.map((branch) => {
      const name = names.find((candidate) => candidate.id === branch.branch_id);
      return <div key={branch.branch_id} className="flex flex-col gap-3">
        <h4>{name ? (locale === 'ar' && name.name_ar ? name.name_ar : name.name_en) : t(locale, 'employeeDefaultHours.branch')}</h4>
        {!branch.linked ? <p>{t(locale, 'employeeDefaultHours.unlinked')}</p> : null}
        {branch.linked && !branch.shifts.length ? <p>{t(locale, 'employeeDefaultHours.notSet')}</p> : null}
        {current.data?.can_manage && branch.linked ? <EmployeeDefaultHoursForm
          key={`${branch.branch_id}-${branch.updated_at ?? ''}`} shifts={branch.shifts} pending={save.isPending}
          onSave={(input, onSuccess) => save.mutate({ branchId: branch.branch_id, input }, { onSuccess: () => onSuccess?.() })} /> :
          branch.shifts.map((shift) => <p key={shift.day}>
            {t(locale, `shell.schedule_${scheduleDayKeys[shift.day] ?? 'sat'}`)} · <bdi>{shift.start}–{shift.end}</bdi>
            {shift.break_start ? <> · {t(locale, 'shell.schedule_break')} <bdi>{shift.break_start}–{shift.break_end}</bdi></> : null}
            {' · '}{t(locale, 'employeeDefaultHours.duration').replace('{minutes}', String(defaultShiftMinutes(shift)))}
          </p>)}
      </div>;
    })}
    {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
    {save.isSuccess ? <p role="status">{t(locale, 'employeeDefaultHours.saved')}</p> : null}
  </section>;
}
