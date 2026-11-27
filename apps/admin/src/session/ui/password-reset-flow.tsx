'use client';

import { t } from '@pospay/i18n';
import { Button, EmptyState, ShieldCheck } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

import { usePasswordReset } from '../api/use-password-reset';
import { GuestFrame } from './guest-frame';
import { PasswordResetRequestForm } from './password-reset-request-form';
import { PasswordResetVerifyForm } from './password-reset-verify-form';

/** مسار «نسيت كلمة المرور؟» على صفحة الدخول: طلب الكود ثم التحقق وكلمة المرور الجديدة ثم تم. */
export function PasswordResetFlow({ onExit }: { onExit: () => void }) {
  const locale = useLocale();
  const reset = usePasswordReset();
  // عنوان الصفحة بيفضل «إعادة التعيين» في الخطوة الأولى والأخيرة، والنجاح بيتقال في الحالة الفارغة.
  const title =
    reset.step === 'verify' ? 'passwordReset.verifyTitle' : 'passwordReset.requestTitle';
  const lead =
    reset.step === 'request'
      ? 'passwordReset.requestLead'
      : reset.step === 'verify'
        ? 'passwordReset.verifyLead'
        : 'passwordReset.doneBody';
  return (
    <GuestFrame title={t(locale, title)} lead={t(locale, lead)}>
      {reset.step === 'request' ? (
        <PasswordResetRequestForm
          pending={reset.pending}
          error={reset.error}
          cooldown={reset.cooldown}
          onSubmit={reset.requestCode}
          onBack={onExit}
        />
      ) : null}
      {reset.step === 'verify' ? (
        <PasswordResetVerifyForm
          pending={reset.pending}
          error={reset.error}
          cooldown={reset.cooldown}
          onSubmit={reset.reset}
          onResend={reset.resend}
          onBack={onExit}
        />
      ) : null}
      {reset.step === 'done' ? (
        <EmptyState
          tone="neutral"
          icon={<ShieldCheck />}
          title={t(locale, 'passwordReset.doneTitle')}
          action={<Button onClick={onExit}>{t(locale, 'admin.goToLogin')}</Button>}
        />
      ) : null}
    </GuestFrame>
  );
}
