'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import Link from 'next/link';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeAppLink } from '../api/use-employee-app-link';

export function EmployeeAppLinkButton(props: {
  companyId: string;
  userId: string;
  businessId: string;
}) {
  const locale = useLocale();
  const read = useEmployeeAppLink(props.companyId, props.userId, props.businessId);
  if (!read.isSuccess) return null;
  return (
    <Button asChild variant="outline">
      <Link href="/staff/employee-app-link">{t(locale, 'employeeAppLink.open')}</Link>
    </Button>
  );
}
