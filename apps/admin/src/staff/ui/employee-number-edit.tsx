'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useCallback, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeNumberEditCapability } from '../api/use-employee-number-edit-capability';
import { EmployeeNumberEditForm } from './employee-number-edit-form';

export function EmployeeNumberEdit({
  companyId,
  businessId,
  userId,
  employeeId,
  employeeNumber,
}: {
  companyId: string;
  businessId: string;
  userId: string;
  employeeId: string;
  employeeNumber: number;
}) {
  const locale = useLocale();
  const capability = useEmployeeNumberEditCapability(companyId, businessId, userId, employeeId);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const allowed = !capability.isError && capability.data?.can_edit_number === true;
  // الحوار المفتوح بعد الرفض بيفضل لحد ما المستخدم يقفله؛ الزرار يختفي بعد القفل بس.
  if (!allowed && !open) return null;
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" disabled={!allowed} onClick={() => setOpen(true)}>
        {t(locale, 'staff.editNumber')}
      </Button>
      {open ? (
        <EmployeeNumberEditForm
          companyId={companyId}
          businessId={businessId}
          userId={userId}
          employeeId={employeeId}
          employeeNumber={employeeNumber}
          readOnly={!allowed}
          onClose={close}
        />
      ) : null}
    </div>
  );
}
