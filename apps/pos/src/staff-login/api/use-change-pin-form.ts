import { useState } from 'react';
import { changeTemporaryStaffPin } from './staff-calls';

const FOUR_DIGITS = /^\d{4}$/;

export type ChangePinFault = 'format' | 'mismatch' | 'refused';

export function useChangePinForm(proof: string, onChanged: () => void, onExpired: () => void) {
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pending, setPending] = useState(false);
  const [fault, setFault] = useState<ChangePinFault | null>(null);
  const submit = async () => {
    // تغيير الرقم السري أونلاين بس: الدليل قصير الأجل ومينفعش يتأجل في طابور.
    if (!navigator.onLine || pending) return;
    setNewPin('');
    setConfirmPin('');
    setFault(null);
    if (!FOUR_DIGITS.test(newPin)) {
      setFault('format');
      return;
    }
    if (newPin !== confirmPin) {
      setFault('mismatch');
      return;
    }
    setPending(true);
    try {
      const outcome = await changeTemporaryStaffPin({ proof, pin: newPin });
      if (outcome === 'changed') {
        onChanged();
        return;
      }
      if (outcome === 'expired') {
        onExpired();
        return;
      }
      setFault('refused');
    } catch {
      setFault('refused');
    } finally {
      setPending(false);
    }
  };
  return { newPin, setNewPin, confirmPin, setConfirmPin, pending, fault, submit };
}
