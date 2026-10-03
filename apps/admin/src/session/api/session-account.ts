import { anonymousStatus, hasUser } from './auth-error';
import { browserAuthClient } from './browser-client';

export type SessionAccount = {
  id: string;
  email: string | null;
  name: string | null;
};

// نفس بيانات الجلسة الحالية؛ الاسم والبريد للعرض فقط وما يغيّروش التحقق من الهوية.
export async function readSessionAccount(): Promise<SessionAccount | null> {
  const result = await browserAuthClient().getSession();
  if (result.error) {
    if (anonymousStatus(result.error)) return null;
    throw result.error;
  }
  if (!hasUser(result.data)) return null;
  const user = result.data.user;
  return {
    id: user.id,
    email: 'email' in user && typeof user.email === 'string' ? user.email : null,
    name: 'name' in user && typeof user.name === 'string' ? user.name : null,
  };
}
