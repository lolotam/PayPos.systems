'use client';
import type { EmployeeDetail } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import Link from 'next/link';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeIdentity } from './employee-identity';
import { EmployeeNumberEdit } from './employee-number-edit';

/** ترويسة صفحة الموظف: العنوان والاسم والرقم، وتعديل الرقم وإعادة التحميل والعودة للقائمة. */
export function EmployeeDetailHeader({
  companyId,
  businessId,
  userId,
  employee,
  busy,
  onReload,
}: {
  companyId: string;
  businessId: string;
  userId: string;
  employee: EmployeeDetail | undefined;
  busy: boolean;
  onReload: () => void;
}) {
  const locale = useLocale();
  return (
    <PageHeader
      title={t(locale, 'staff.editTitle')}
      description={employee ? <EmployeeIdentity employee={employee} /> : undefined}
      actions={
        <>
          {employee ? (
            <EmployeeNumberEdit
              companyId={companyId}
              businessId={businessId}
              userId={userId}
              employeeId={employee.id}
              employeeNumber={employee.employee_number}
            />
          ) : null}
          <Button variant="outline" disabled={busy} onClick={onReload}>
            {t(locale, 'staff.reload')}
          </Button>
          <Button asChild variant="outline">
            <Link href="/staff">{t(locale, 'staff.cancel')}</Link>
          </Button>
        </>
      }
    />
  );
}
