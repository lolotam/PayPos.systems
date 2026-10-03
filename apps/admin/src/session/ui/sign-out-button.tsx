'use client';

import { t } from '@pospay/i18n';
import { Button, LogOut, EmptyState, CircleAlert } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

import { useSignOut } from '../api/use-sign-out';

export function SignOutButton({ tone = 'ink' }: { tone?: 'ink' | 'light' }) {
  const locale = useLocale();
  const signOut = useSignOut();
  return (
    <div className="flex flex-col items-start gap-2">
      {signOut.failed ? (
        <EmptyState
          role="alert"
          tone="danger"
          icon={<CircleAlert />}
          title={t(locale, 'admin.unexpected')}
          className="w-full p-3 [&_h2]:text-sm"
        />
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={
          tone === 'light' ? 'justify-start hover:bg-white/10 hover:text-white' : 'justify-start'
        }
        disabled={signOut.pending}
        onClick={() => void signOut.submit()}
      >
        <LogOut aria-hidden="true" />
        {t(locale, 'admin.signOut')}
      </Button>
    </div>
  );
}
