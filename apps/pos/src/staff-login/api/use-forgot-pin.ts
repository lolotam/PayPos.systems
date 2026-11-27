import { useEffect, useRef, useState } from 'react';
import { staffPinResetRequestInput, type StaffPinResetRequestInput } from '@pospay/contracts';
import { requestStaffPinReset, resetStaffPinWithOtp } from './staff-calls';

const SIX_DIGITS = /^\d{6}$/;
const FOUR_DIGITS = /^\d{4}$/;

export type ForgotPinStep = 'channel' | 'code' | 'pin';

export type ForgotPinFault =
  | 'identifier'
  | 'codeFormat'
  | 'format'
  | 'mismatch'
  | 'invalid'
  | 'limited'
  | 'unavailable'
  | 'refused';

function useCountdown() {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (remaining === 0) return;
    const timer = setTimeout(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  return { remaining, start: (seconds: number) => setRemaining(seconds) };
}

// نداء واحد في كل مرة وأونلاين بس؛ ولو الشاشة نزلت قبل ما الرد يرجع، الرد بيتجاهل.
function useGuardedCall() {
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);
  const [fault, setFault] = useState<ForgotPinFault | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const perform = async (work: () => Promise<void>) => {
    if (!navigator.onLine || pending) return;
    setPending(true);
    setFault(null);
    try {
      await work();
    } catch {
      if (mounted.current) setFault('refused');
    } finally {
      if (mounted.current) setPending(false);
    }
  };
  return { mounted, pending, fault, setFault, perform };
}

// الكود والرقم السري في الذاكرة بس: ما بيتكتبوش في أي تخزين ولا طابور مزامنة.
function useResetFields() {
  const [code, setCode] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  return { code, setCode, newPin, setNewPin, confirmPin, setConfirmPin };
}

type ResetSession = { readonly request: StaffPinResetRequestInput; readonly challenge: string };

export function useForgotPin(onDone: () => void) {
  const [step, setStep] = useState<ForgotPinStep>('channel');
  const [session, setSession] = useState<ResetSession | null>(null);
  const call = useGuardedCall();
  const countdown = useCountdown();
  const fields = useResetFields();
  const requestCode = (request: StaffPinResetRequestInput) =>
    call.perform(async () => {
      if (!staffPinResetRequestInput.safeParse(request).success) {
        call.setFault('identifier');
        return;
      }
      const result = await requestStaffPinReset(request);
      if (!call.mounted.current || !navigator.onLine) return;
      if (result.kind !== 'accepted') {
        call.setFault(result.kind);
        return;
      }
      setSession({ request, challenge: result.challengeId });
      countdown.start(60);
      fields.setCode('');
      setStep('code');
    });
  const continueToPin = () => {
    call.setFault(SIX_DIGITS.test(fields.code) ? null : 'codeFormat');
    if (SIX_DIGITS.test(fields.code)) setStep('pin');
  };
  const submitReset = async () => {
    if (!navigator.onLine || call.pending || session === null) return;
    const [pin, confirmation, code] = [fields.newPin, fields.confirmPin, fields.code];
    fields.setNewPin('');
    fields.setConfirmPin('');
    if (!FOUR_DIGITS.test(pin) || pin !== confirmation) {
      call.setFault(FOUR_DIGITS.test(pin) ? 'mismatch' : 'format');
      return;
    }
    await call.perform(async () => {
      const outcome = await resetStaffPinWithOtp({ challenge_id: session.challenge, code, pin });
      if (!call.mounted.current) return;
      fields.setCode('');
      if (outcome === 'reset') {
        onDone();
        return;
      }
      call.setFault(outcome);
      setStep('code');
    });
  };
  return {
    ...fields,
    step,
    remaining: countdown.remaining,
    pending: call.pending,
    fault: call.fault,
    requestCode,
    resend: () => (session === null ? Promise.resolve() : requestCode(session.request)),
    continueToPin,
    submitReset,
  };
}
