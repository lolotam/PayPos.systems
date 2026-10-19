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
  onRefresh?: () => Promise<{ status: string; revision: number } | null>;
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

function applyCancelFailure(error: unknown, input: CancelSubmitInput): boolean {
  const failure = classifyCancelError(error, input.locale);
  if (failure.kind === 'stale') {
    input.setRoot(failure.message);
    return true;
  }
  if (failure.kind === 'already') {
    input.setRoot(failure.message);
    return true;
  }
  if (failure.kind === 'forbidden') {
    input.props.onForbidden(failure.message);
    input.props.onClose();
    return false;
  }
  if (failure.kind === 'revoked') {
    (input.props.onAccessDenied ?? input.props.onForbidden)(failure.message);
    input.props.onClose();
    return false;
  }
  if (failure.kind === 'field') {
    input.form.setError(failure.field, { message: failure.message });
    return false;
  }
  if (failure.kind === 'membership') {
    input.setMemberships(failure.ids);
    input.setRoot(failure.message);
    return false;
  }
  input.setRoot(failure.message);
  return false;
}

// السيرفر بيرد بتعارض المراجعة قبل «اتلغى»، فجلب اليوم هو اللي بيقفل الحوار ويظهر العلامة.
async function revealCancelledLine(input: CancelSubmitInput) {
  const load = input.props.onRefresh;
  if (!load) return;
  try {
    const fresh = await load();
    if (!input.mounted.current || !fresh) return;
    if (fresh.status === 'CANCELLED') {
      input.props.onClose();
      return;
    }
    // المراجعة بتيجي من السطر بعد الجلب بس، عشان المدير يشوف السعر الحالي قبل ما يضغط تاني.
    input.form.setValue('expected_revision', fresh.revision);
  } catch {
    // فشل الجلب يسيب رسالة الرفض ظاهرة، والحوار ما يتقفلش على صف لسه ظاهر إنه نشط.
  }
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
    if (applyCancelFailure(error, input)) await revealCancelledLine(input);
  }
}
