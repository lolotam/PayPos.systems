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
  const manageable = !query.isError && query.data?.can_manage === true;
  // الزرار بس بيتقفل من نتيجة الجلب؛ الحوار المفتوح يفضل لحد القفل حتى لو الرفض أو فشل إعادة الجلب.
  if (!manageable && !open) return null;
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" disabled={!manageable} onClick={() => setOpen(true)}>
        {t(locale, 'staff.startNumbering')}
      </Button>
      {open ? (
        <EmployeeNumberStartForm
          companyId={companyId}
          userId={userId}
          nextNumber={query.data?.next_number ?? null}
          readOnly={!manageable}
          onClose={close}
        />
      ) : null}
    </div>
  );
}
