'use client';
import type { ScheduleShift, SetEmployeeDefaultShiftsInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useId, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeDefaultHoursBulkFields } from './employee-default-hours-bulk-fields';

export function EmployeeDefaultHoursBulkAction({ pending, onApply }: {
  pending: boolean; onApply: (shifts: ScheduleShift[]) => void;
}) {
  const locale = useLocale();
  const form = useFormContext<SetEmployeeDefaultShiftsInput>();
  const [snapshot, setSnapshot] = useState<ScheduleShift[] | null>(null);
  const panelId = useId();
  return <div className="flex flex-col gap-3">
    <Button type="button" variant="outline" aria-expanded={snapshot !== null} aria-controls={panelId}
      onClick={() => setSnapshot(snapshot === null ? form.getValues('shifts') : null)}>
      {t(locale, 'employeeDefaultHours.sameHours')}
    </Button>
    {snapshot !== null ? <EmployeeDefaultHoursBulkFields id={panelId} shifts={snapshot} pending={pending}
      onApply={(shifts) => { onApply(shifts); setSnapshot(null); }} /> : null}
  </div>;
}
