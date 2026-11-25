import { useEffect, useRef, useState } from 'react';
import type { StaffPinInput } from '@pospay/contracts';
import { signInStaffPin, type StaffPinSignInOutcome } from './staff-calls';

type StaffPinRefusal =
  { readonly kind: 'change_required'; readonly proof: string } | { readonly kind: 'expired' };

// الرفض بييجي بنفس صنف النتيجة، فالنوع narrowing بيفصله عن الجلسة اللي مفيهاش kind.
function isRefusal(result: StaffPinSignInOutcome): result is StaffPinRefusal {
  return result !== null && 'kind' in result;
}

export function usePinForm(onSignedIn: () => void, onChangeRequired?: (proof: string) => void) {
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<'invalid' | 'expired' | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submit = async (input: StaffPinInput) => {
    if (!navigator.onLine || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await signInStaffPin(input);
      if (!mounted.current || !navigator.onLine) return;
      if (isRefusal(result)) {
        if (result.kind === 'expired') setError('expired');
        else if (onChangeRequired === undefined) setError('invalid');
        else onChangeRequired(result.proof);
      } else if (result === null) setError('invalid');
      else onSignedIn();
    } catch {
      if (mounted.current) setError('invalid');
    } finally {
      if (mounted.current) setPending(false);
    }
  };
  return { pending, invalid: error === 'invalid', expired: error === 'expired', error, submit };
}
