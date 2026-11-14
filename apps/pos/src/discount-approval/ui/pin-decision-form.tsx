import { zodResolver } from '@hookform/resolvers/zod';
import { staffPinInput, type StaffPinInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { useLocale } from '@/shared/locale/locale-context';
import type { DeviceProposal } from '../api/device-discount-calls';
import type { PinDecision, usePinDecision } from '../api/use-pin-decision';

function decisionLabel(locale: 'ar' | 'en', pending: boolean, decision: PinDecision): string {
  if (pending) return t(locale, 'deviceDiscountApproval.deciding');
  return t(
    locale,
    decision === 'approve' ? 'deviceDiscountApproval.approve' : 'deviceDiscountApproval.reject',
  );
}

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function useDecisionForm(proposal: DeviceProposal, controller: ReturnType<typeof usePinDecision>) {
  const form = useForm<StaffPinInput>({ resolver: zodResolver(staffPinInput) });
  const [reason, setReason] = useState('');
  const online = useOnlineStatus();
  const submit = (decision: PinDecision) => async (input: StaffPinInput) => {
    await controller.decide(proposal, decision, input, reason);
    form.resetField('pin');
  };
  return { form, reason, setReason, online, submit };
}

export function PinDecisionForm({
  proposal,
  controller,
  onCancel,
}: {
  proposal: DeviceProposal;
  controller: ReturnType<typeof usePinDecision>;
  onCancel: () => void;
}) {
  const locale = useLocale();
  const { form, reason, setReason, online, submit } = useDecisionForm(proposal, controller);
  const disabled = !online || controller.pending;
  const resetPin = () => form.resetField('pin', { keepError: true });
  return (
    <form
      className="mt-3 grid gap-3 rounded-lg border p-4"
      noValidate
      onSubmit={form.handleSubmit(submit('approve'), resetPin)}
    >
      <fieldset disabled={disabled} className="grid gap-3">
        <Label htmlFor="discount-phone">{t(locale, 'deviceDiscountApproval.phone')}</Label>
        <Input id="discount-phone" type="tel" autoComplete="off" {...form.register('phone')} />
        <Label htmlFor="discount-pin">{t(locale, 'deviceDiscountApproval.pin')}</Label>
        <Input
          id="discount-pin"
          type="password"
          inputMode="numeric"
          maxLength={4}
          autoComplete="off"
          {...form.register('pin')}
        />
        <Label htmlFor="discount-reason">{t(locale, 'deviceDiscountApproval.reason')}</Label>
        <Input
          id="discount-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {Object.keys(form.formState.errors).length !== 0 ? (
          <p role="alert" className="text-destructive">
            {t(locale, 'deviceDiscountApproval.pinInvalid')}
          </p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="submit">{decisionLabel(locale, controller.pending, 'approve')}</Button>
          <Button
            type="button"
            variant="destructive"
            onClick={form.handleSubmit(submit('reject'), resetPin)}
          >
            {decisionLabel(locale, controller.pending, 'reject')}
          </Button>
        </div>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t(locale, 'deviceDiscountApproval.cancel')}
        </Button>
      </fieldset>
      {!online ? <p role="status">{t(locale, 'deviceDiscountApproval.offline')}</p> : null}
    </form>
  );
}
