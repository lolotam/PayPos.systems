import { useEffect, useState } from 'react';
import type { StaffOtpRequestInput, StaffOtpVerifyInput } from '@pospay/contracts';
import { requestStaffCode, verifyStaffCode } from './staff-calls';

export function useOtpForm(onSignedIn: () => void) {
  const [phone, setPhone] = useState<StaffOtpRequestInput | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<'invalid' | 'unavailable' | null>(null);
  useEffect(() => {
    if (remaining === 0) return;
    const timer = setTimeout(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  const perform = async (failure: 'invalid' | 'unavailable', work: () => Promise<void>) => {
    if (!navigator.onLine || pending) return;
    setPending(true);
    setError(null);
    try {
      await work();
    } catch {
      setError(failure);
    } finally {
      setPending(false);
    }
  };
  const request = (input: StaffOtpRequestInput) =>
    perform('unavailable', async () => {
      const result = await requestStaffCode(input);
      if (!navigator.onLine) {
        setPhone(null);
        setChallenge(null);
        return;
      }
      if (result.kind !== 'accepted') {
        setError('unavailable');
        return;
      }
      setPhone(input);
      setChallenge(result.acknowledgement.challenge_id);
      setRemaining(60);
    });
  const verify = (input: StaffOtpVerifyInput) =>
    perform('invalid', async () => {
      const result = await verifyStaffCode(input);
      if (result === null || !navigator.onLine) {
        setError('invalid');
        return;
      }
      setPhone(null);
      setChallenge(null);
      onSignedIn();
    });
  return { phone, challenge, remaining, pending, error, request, verify };
}
