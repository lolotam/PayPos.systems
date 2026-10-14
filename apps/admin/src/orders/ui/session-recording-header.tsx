'use client';
import type { RecordingDiscountLimit } from '@pospay/contracts';
import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import type { SessionServiceScope } from '../api/use-session-services';
import type { SessionDraftForm } from '../model/session-drafts';
import { RecorderMembershipField } from './recorder-membership-field';
import { SessionDraftSummary } from './session-draft-summary';

export function SessionRecordingHeader({ scope, disabled, readOnly = false }: {
  scope: SessionServiceScope; disabled: boolean; readOnly?: boolean;
}) {
  const [limit, setLimit] = useState<RecordingDiscountLimit | null>(null);
  const { control, setValue } = useFormContext<SessionDraftForm>();
  const membership = useWatch({ control, name: 'recorder_membership_id' });
  return <>
    <RecorderMembershipField scope={scope} value={membership ?? null} disabled={disabled} readOnly={readOnly} onLimitChange={setLimit}
      onChange={(next) => setValue('recorder_membership_id', next, { shouldDirty: true })} />
    <SessionDraftSummary limit={limit} />
  </>;
}
