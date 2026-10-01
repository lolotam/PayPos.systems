'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import Link from 'next/link';

import { useLocale } from '@/shared/locale/locale-context';

// TODO(spec): the spec does not say who must enrol TOTP. Any signed-in user may open this page.

export function EnrolLink() {
  const locale = useLocale();
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link href="/security/two-factor">{t(locale, 'admin.enrolLink')}</Link>
    </Button>
  );
}
