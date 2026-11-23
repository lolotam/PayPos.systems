'use client';

import { t } from '@pospay/i18n';
import { Button, CircleAlert, EmptyState, ShieldCheck } from '@pospay/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { useLocale } from '@/shared/locale/locale-context';

import { useSetPassword } from '../api/use-set-password';
import { GuestFrame } from '../ui/guest-frame';
import { SetPasswordForm } from '../ui/set-password-form';

export function SetPasswordPage() {
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const token = searchParams.get('token');
  const linkBroken = error !== null || token === null || token === '';
  const setPassword = useSetPassword(linkBroken ? '' : token);

  // التوكن بيعيش في الذاكرة بس (لا لوج ولا تخزين)؛ replaceState بيمسحه من شريط العنوان
  // من غير ما يبلّغ الـ router، فقيمة useSearchParams تفضل متاحة للصفحة بعد التنضيف.
  useEffect(() => {
    if (window.location.search === '') return;
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const invalidLink = linkBroken || setPassword.step === 'invalid-link';
  return (
    <GuestFrame title={t(locale, 'admin.setPasswordTitle')} lead={t(locale, 'admin.setPasswordLead')}>
      {invalidLink ? (
        <EmptyState
          role="alert"
          tone="danger"
          icon={<CircleAlert />}
          title={t(locale, 'admin.setPasswordInvalidLinkTitle')}
          description={t(locale, 'admin.setPasswordInvalidLinkBody')}
        />
      ) : null}
      {!invalidLink && setPassword.step === 'form' ? (
        <SetPasswordForm
          pending={setPassword.pending}
          error={setPassword.error}
          onSubmit={setPassword.submit}
        />
      ) : null}
      {setPassword.step === 'done' ? (
        <EmptyState
          tone="neutral"
          icon={<ShieldCheck />}
          title={t(locale, 'admin.setPasswordDoneTitle')}
          description={t(locale, 'admin.setPasswordDoneBody')}
          action={
            <Button onClick={() => router.push('/login')}>{t(locale, 'admin.goToLogin')}</Button>
          }
        />
      ) : null}
    </GuestFrame>
  );
}
