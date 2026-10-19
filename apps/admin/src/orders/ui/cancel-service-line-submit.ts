import type { CancelServiceLineInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import type { UseFormReturn } from 'react-hook-form';
import {
  cancelOutcomeKnown,
  classifyCancelError,
  type CancelLineFormInput,
} from '../model/cancel-service-line-values';
type CancelSubmitProps = {
  sessionId: string;
  line: { id: string };
  onSaved: () => void;
  onForbidden: (message: string) => void;
  onAccessDenied?: (message: string) => void;
  onClose: () => void;
};

export type CancelSubmitInput = {
  body: CancelServiceLineInput;
  props: CancelSubmitProps;
  locale: Locale;
  form: UseFormReturn<CancelLineFormInput, unknown, CancelServiceLineInput>;
  mutate: (attempt: {
    sessionId: string;
    lineId: string;
    body: CancelServiceLineInput;
  }) => Promise<unknown>;
  setRoot: (message: string | null) => void;
  setMemberships: (ids: string[]) => void;
  setFrozen: (frozen: boolean) => void;
  retain: { current: CancelServiceLineInput | null };
  mounted: { current: boolean };
};

function applyCancelFailure(error: unknown, input: CancelSubmitInput) {
  const failure = classifyCancelError(error, input.locale);
  if (failure.kind === 'stale') {
    input.setRoot(failure.message);
    const sent = input.form.getValues('expected_revision');
    if (failure.revision !== null && failure.revision > sent)
      input.form.setValue('expected_revision', failure.revision);
    return;
  }
  if (failure.kind === 'forbidden') {
    input.props.onForbidden(failure.message);
    input.props.onClose();
    return;
  }
  if (failure.kind === 'revoked') {
    (input.props.onAccessDenied ?? input.props.onForbidden)(failure.message);
    input.props.onClose();
    return;
  }
  if (failure.kind === 'field') {
    input.form.setError(failure.field, { message: failure.message });
    return;
  }
  if (failure.kind === 'membership') {
    input.setMemberships(failure.ids);
    input.setRoot(failure.message);
    return;
  }
  input.setRoot(failure.message);
}

export async function submitCancellation(input: CancelSubmitInput) {
  try {
    await input.mutate({
      sessionId: input.props.sessionId,
      lineId: input.props.line.id,
      body: input.body,
    });
    input.retain.current = null;
    input.setFrozen(false);
    if (input.mounted.current) input.props.onSaved();
  } catch (error) {
    if (!input.mounted.current) return;
    if (!cancelOutcomeKnown(error)) {
      input.retain.current = input.body;
      input.setFrozen(true);
      input.setRoot(t(input.locale, 'serviceLineCancel.outcomeUnknown'));
      return;
    }
    input.retain.current = null;
    input.setFrozen(false);
    applyCancelFailure(error, input);
  }
}
