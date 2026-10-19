'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useCallback, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeNumbering } from '../api/use-employee-numbering';
import { EmployeeNumberStartForm } from './employee-number-start-form';

export function EmployeeNumberStartDialog({
  companyId,
  userId,
}: {
  companyId: string;
  userId: string;
}) {
  const locale = useLocale();
  const query = useEmployeeNumbering(companyId, userId);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (query.data?.can_manage !== true) return null;
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t(locale, 'staff.startNumbering')}
      </Button>
      {open ? (
        <EmployeeNumberStartForm
          companyId={companyId}
          userId={userId}
          nextNumber={query.data.next_number}
          onClose={close}
        />
      ) : null}
    </div>
  );
}
