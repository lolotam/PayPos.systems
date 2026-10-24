'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import Link from 'next/link';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeAppLinkButton } from './employee-app-link-button';

export function EmployeesHeaderActions(props: {
  companyId: string;
  userId: string;
  businessId: string;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-wrap gap-2">
      <EmployeeAppLinkButton
        companyId={props.companyId}
        userId={props.userId}
        businessId={props.businessId}
      />
      <Button asChild variant="outline">
        <Link href="/staff/document-types">{t(locale, 'employeeDocuments.typesLink')}</Link>
      </Button>
      <Button asChild>
        <Link href="/staff/create">{t(locale, 'staff.create')}</Link>
      </Button>
    </div>
  );
}
