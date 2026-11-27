'use client';

import type { MessageKey } from '@pospay/i18n';
import { useEffect, useState } from 'react';

import { useLocale } from '@/shared/locale/locale-context';

import { requestPasswordResetCode, resetPasswordWithCode } from './password-reset-calls';

export type PasswordResetStep = 'request' | 'verify' | 'done';

/**
 * حالة شاشة «نسيت كلمة المرور؟»: طلب الإيميل ثم الكود وكلمة المرور الجديدة ثم تم.
 * عدّاد إعادة الإرسال بيبدأ من الثواني اللي رجعها الـ API ويقف عند الصفر.
 */
export function usePasswordReset() {
  const locale = useLocale();
  const [step, setStep] = useState<PasswordResetStep>('request');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageKey | undefined>();
  const [email, setEmail] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function requestCode(address: string): Promise<void> {
    setPending(true);
    setError(undefined);
    const outcome = await requestPasswordResetCode(address, locale);
    setPending(false);
    if (outcome.kind === 'error') {
      setError(outcome.key);
      // ردّ 429 بيحدد مهلة الانتظار: العدّاد بياخدها بدل ما المستخدم يعيد الضغط على الفاضي.
      if (outcome.retryAfter !== undefined) setCooldown(outcome.retryAfter);
      return;
    }
    setEmail(address);
    setChallengeId(outcome.challengeId);
    setCooldown(outcome.retryAfter);
    setStep('verify');
  }

  async function resend(): Promise<void> {
    if (cooldown > 0 || pending) return;
    await requestCode(email);
  }

  async function reset(code: string, newPassword: string): Promise<void> {
    setPending(true);
    setError(undefined);
    const outcome = await resetPasswordWithCode({ challengeId, code, newPassword });
    setPending(false);
    if (outcome.kind === 'error') {
      setError(outcome.key);
      return;
    }
    setStep('done');
  }

  return { step, pending, error, cooldown, requestCode, resend, reset };
}
