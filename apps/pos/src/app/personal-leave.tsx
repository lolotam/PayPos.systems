import type { PersonalSessionContext } from '@pospay/contracts';
import { OwnLeaveEntry } from './own-leave-entry';

export function personalLeave(session: PersonalSessionContext, epoch: number) {
  return <OwnLeaveEntry context={{ mode: 'personal', ...session, sessionEpoch: epoch }} />;
}
