'use client';

import { t } from '@pospay/i18n';
import { Button, KeyRound } from '@pospay/ui';
import Link from 'next/link';

import { useLocale } from '@/shared/locale/locale-context';

// TODO(spec): the spec does not say who must enrol TOTP. Any signed-in user may open this page.

export function EnrolLink() {
  const locale = useLocale();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="justify-start hover:bg-white/10 hover:text-white"
      asChild
    >
      <Link href="/security/two-factor">
        <KeyRound aria-hidden="true" />
        {t(locale, 'admin.enrolLink')}
      </Link>
    </Button>
  );
}
