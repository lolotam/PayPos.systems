import type { UseFormReturn } from 'react-hook-form';

import { clearPackagePicks } from '../model/session-package-options';
import type { SessionDraftForm } from '../model/session-drafts';
import type {
  SessionRecordingResult,
} from '../model/session-recording-result';
import type { SessionRecordingController } from '../model/use-session-recording';
import type { SessionCustomerSelection } from './session-customer-field';

// الكتابة في حقول الزبونة بتبعت null؛ ده مش تغيير للزبونة، والمسح يحصل فقط بعد تحديد زبونة مختلفة.
export function changeSessionCustomer(
  customer: SessionCustomerSelection | null,
  result: SessionRecordingResult,
  recording: SessionRecordingController,
  form: UseFormReturn<SessionDraftForm>,
  lastKnownCustomerId: { current: string | null },
) {
  const customerChanged = customer !== null && customer.id !== lastKnownCustomerId.current;
  if (customer !== null) lastKnownCustomerId.current = customer.id;
  recording.selectCustomer(customer);
  if (result.sessionId === null && customerChanged)
    form.setValue('lines', clearPackagePicks(form.getValues('lines')));
}
