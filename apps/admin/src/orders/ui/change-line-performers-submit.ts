import type { ChangeLinePerformersInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import type { UseFormReturn } from 'react-hook-form';
import {
  classifyPerformersError,
  performersOutcomeKnown,
  type PerformersFormInput,
} from '../model/change-line-performers-values';

export type PerformersSubmitProps = {
  sessionId: string;
  line: { id: string };
  onSaved: () => void;
  onForbidden: (message: string) => void;
  onAccessDenied?: (message: string) => void;
  onClose: () => void;
  onRefresh?: () => Promise<{ status: string; revision: number } | null>;
};

export type PerformersSubmitInput = {
  body: ChangeLinePerformersInput;
  props: PerformersSubmitProps;
  locale: Locale;
  form: UseFormReturn<PerformersFormInput>;
  mutate: (attempt: {
    sessionId: string;
    lineId: string;
    body: ChangeLinePerformersInput;
  }) => Promise<unknown>;
  setRoot: (message: string | null) => void;
  setMemberships: (ids: string[]) => void;
  setFrozen: (frozen: boolean) => void;
  retain: { current: ChangeLinePerformersInput | null };
  mounted: { current: boolean };
};

function applyPerformersFailure(error: unknown, input: PerformersSubmitInput): boolean {
  const failure = classifyPerformersError(error, input.locale);
  if (failure.kind === 'stale') {
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
    input.form.setError('reason', { message: failure.message });
    return false;
  }
  if (failure.kind === 'membership') input.setMemberships(failure.ids);
  input.setRoot(failure.message);
  return false;
}

// المراجعة الجديدة بتيجي من جلب اليوم بس، عشان المدير يشوف المنفّذين الحاليين قبل ما يضغط تاني.
async function refreshChangedLine(input: PerformersSubmitInput) {
  const load = input.props.onRefresh;
  if (!load) return;
  try {
    const fresh = await load();
    if (!input.mounted.current || !fresh) return;
    if (fresh.status === 'CANCELLED') {
      input.props.onClose();
      return;
    }
    input.form.setValue('expected_revision', fresh.revision);
  } catch {
    // فشل الجلب يسيب رسالة التعارض ظاهرة والمراجعة القديمة، فالضغطة الجاية ترجع نفس الرفض بدل ما تكتب فوق تغيير حد تاني.
  }
}

export async function submitPerformersChange(input: PerformersSubmitInput) {
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
    if (!performersOutcomeKnown(error)) {
      input.retain.current = input.body;
      input.setFrozen(true);
      input.setRoot(t(input.locale, 'serviceLinePerformers.outcomeUnknown'));
      return;
    }
    input.retain.current = null;
    input.setFrozen(false);
    if (applyPerformersFailure(error, input)) await refreshChangedLine(input);
  }
}
