'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useCallback, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeNumberCapability } from '../api/use-employee-number-capability';
import { EmployeeNumberEditForm } from './employee-number-edit-form';

export function EmployeeNumberEdit({
  companyId,
  businessId,
  userId,
  employeeId,
  primaryBranchId,
  employeeNumber,
}: {
  companyId: string;
  businessId: string;
  userId: string;
  employeeId: string;
  primaryBranchId: string;
  employeeNumber: number | null;
}) {
  const locale = useLocale();
  const capability = useEmployeeNumberCapability(companyId, businessId, userId, primaryBranchId);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (capability.data?.can_type_number !== true) return null;
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t(locale, 'staff.editNumber')}
      </Button>
      {open ? (
        <EmployeeNumberEditForm
          companyId={companyId}
          businessId={businessId}
          userId={userId}
          employeeId={employeeId}
          employeeNumber={employeeNumber}
          onClose={close}
        />
      ) : null}
    </div>
  );
}
