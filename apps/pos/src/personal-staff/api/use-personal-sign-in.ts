import { useState } from 'react';
import {
  personalOtpRequestInput,
  personalOtpVerifyInput,
  type PersonalOtpRequestInput,
} from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { personalCalls } from './personal-calls';

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
        changed();
      }, 'errors.OTP_INVALID'),
    restart: () => {
      setChallenge(null);
      setError(null);
    },
  };
}
