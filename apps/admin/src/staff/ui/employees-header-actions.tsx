'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import Link from 'next/link';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeAppLinkButton } from './employee-app-link-button';

/** الإجراءات الثانوية في ترويسة الموظفين؛ الإجراء الرئيسي (إضافة موظف) يضعه الـPageHeader في طرفه. */
export function EmployeesHeaderActions(props: {
  companyId: string;
  userId: string;
  businessId: string;
}) {
  const locale = useLocale();
  return (
    <>
      <EmployeeAppLinkButton
        companyId={props.companyId}
        userId={props.userId}
        businessId={props.businessId}
      />
      <Button asChild variant="outline">
        <Link href="/staff/document-types">{t(locale, 'employeeDocuments.typesLink')}</Link>
      </Button>
    </>
  );
}
