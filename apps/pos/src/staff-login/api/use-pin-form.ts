import { useEffect, useRef, useState } from 'react';
import type { StaffPinInput } from '@pospay/contracts';
import { signInStaffPin } from './staff-calls';

export function usePinForm(onSignedIn: () => void) {
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submit = async (input: StaffPinInput) => {
    if (!navigator.onLine || pending) return;
    setPending(true);
    setInvalid(false);
    try {
      const result = await signInStaffPin(input);
      if (!mounted.current || !navigator.onLine) return;
      if (result === null) setInvalid(true);
      else onSignedIn();
    } catch {
      if (mounted.current) setInvalid(true);
    } finally {
      if (mounted.current) setPending(false);
    }
  };
  return { pending, invalid, submit };
}
