'use client';
import type { CancelServiceLineInput } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';
import type { RefObject } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { CancelLineFormInput } from '../model/cancel-service-line-values';
import { CancelServiceLineFields } from './cancel-service-line-fields';
import { submitCancellation, type CancelSubmitInput } from './cancel-service-line-submit';

export function CancelServiceLineForm({
  form,
  locale,
  root,
  memberships,
  online,
  pending,
  frozen,
  retain,
  attempt,
  onClose,
}: {
  form: UseFormReturn<CancelLineFormInput, unknown, CancelServiceLineInput>;
  locale: Locale;
  root: string | null;
  memberships: string[];
  online: boolean;
  pending: boolean;
  frozen: boolean;
  retain: RefObject<CancelServiceLineInput | null>;
  attempt: Omit<CancelSubmitInput, 'body'>;
  onClose: () => void;
}) {
  const send = (body: CancelServiceLineInput) => {
    attempt.setRoot(null);
    void submitCancellation({ ...attempt, body });
  };
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        const kept = retain.current;
        if (kept) {
          event.preventDefault();
          send(kept);
          return;
        }
        void form.handleSubmit(send)(event);
      }}
    >
      {root ? <p role="alert">{root}</p> : null}
      <CancelServiceLineFields
        form={form}
        locale={locale}
        memberships={memberships}
        online={online}
        pending={pending}
        frozen={frozen}
        onClose={onClose}
      />
    </form>
  );
}
