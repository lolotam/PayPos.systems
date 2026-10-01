import { redirect } from 'next/navigation';

import { readSession } from '../api/server-session';
import { EnrolPage } from './enrol-page';
import { SessionUnavailable } from '../ui/session-unavailable';

export async function EnrolGate() {
  const session = await readSession();
  if (session.kind === 'anonymous') redirect('/login');
  if (session.kind === 'error') return <SessionUnavailable />;
  return <EnrolPage />;
}
