'use client';
import type { RecordingDiscountLimit } from '@pospay/contracts';
import { useFormContext, useWatch } from 'react-hook-form';
import type { SessionServiceScope } from '../api/use-session-services';
import type { SessionDraftForm } from '../model/session-drafts';
import { RecorderMembershipField } from './recorder-membership-field';

// ملخص المسودة يُرسم في العمود الجانبي للصفحة، فالحد المعتمد يصعد لمالك الملخص بدل أن يُحفظ هنا.
export function SessionRecordingHeader({ scope, disabled, readOnly = false, onLimitChange }: {
  scope: SessionServiceScope; disabled: boolean; readOnly?: boolean; onLimitChange: (limit: RecordingDiscountLimit | null) => void;
}) {
  const { control, setValue } = useFormContext<SessionDraftForm>();
  const membership = useWatch({ control, name: 'recorder_membership_id' });
  return <RecorderMembershipField scope={scope} value={membership ?? null} disabled={disabled} readOnly={readOnly} onLimitChange={onLimitChange}
    onChange={(next) => setValue('recorder_membership_id', next, { shouldDirty: true })} />;
}
