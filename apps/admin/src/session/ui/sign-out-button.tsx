'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

import { useSignOut } from '../api/use-sign-out';

export function SignOutButton() {
  const locale = useLocale();
  const signOut = useSignOut();
  return (
    <div className="flex items-center gap-2">
      {signOut.failed ? (
        <span role="alert" className="text-sm text-destructive">
          {t(locale, 'admin.unexpected')}
        </span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={signOut.pending}
        onClick={() => void signOut.submit()}
      >
        {t(locale, 'admin.signOut')}
      </Button>
    </div>
  );
}
