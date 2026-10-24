import { useState } from 'react';
import {
  personalOtpRequestInput,
  personalOtpVerifyInput,
  type PersonalOtpRequestInput,
} from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { withTimeout } from '../push/push-calls';
import { runSignInPushCheck, suspendPushForSignIn } from '../push/push-sign-in-check';
import { personalCalls } from './personal-calls';

const SUSPEND_TIMEOUT_MS = 2000;

export function usePersonalSignIn(
  workspace: { company_id: string; business_id: string },
  changed: () => void,
) {
  const [pending, setPending] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const run = async (action: () => Promise<void>, failure: MessageKey) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(failure);
    } finally {
      setPending(false);
    }
  };
  return {
    pending,
    challenge,
    error,
    request: (input: Pick<PersonalOtpRequestInput, 'phone' | 'locale'>) =>
      run(async () => {
        const result = await personalCalls.request(
          personalOtpRequestInput.parse({ ...input, ...workspace }),
        );
        if (result === null) throw new Error('PERSONAL_OTP_REFUSED');
        setChallenge(result.challenge_id);
      }, 'errors.OTP_UNAVAILABLE'),
    verify: (code: string) =>
      run(async () => {
        const result = await personalCalls.verify(
          personalOtpVerifyInput.parse({ ...workspace, challenge_id: challenge, code }),
        );
        if (result === null) throw new Error('PERSONAL_OTP_REFUSED');
        setChallenge(null);
        // جلسة جديدة: نص الإشعارات بيتعلّق الأول وبعدين بيتقارن مرجع المشترك (FR-018).
        await withTimeout(suspendPushForSignIn(), SUSPEND_TIMEOUT_MS).catch(() => undefined);
        void runSignInPushCheck().catch(() => undefined);
        changed();
      }, 'errors.OTP_INVALID'),
    restart: () => {
      setChallenge(null);
      setError(null);
    },
  };
}
