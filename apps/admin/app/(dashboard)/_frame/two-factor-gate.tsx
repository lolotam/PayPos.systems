import { redirect } from 'next/navigation';

import { readSession } from '@/session/api/server-session';
import { SessionUnavailable } from '@/session/ui/session-unavailable';

import { TwoFactorRoute } from './two-factor-route';

/**
 * بوابة صفحة المصادقة على الخادم، كما كانت على main: زائر بلا جلسة يُحوَّل إلى الدخول، وتعذّر قراءة الجلسة
 * يعرض شاشة «غير متاح». لا تكفي بوابة تخطيط لوحة الإدارة: التخطيط لا يُعاد رسمه في التنقّل من جهة العميل،
 * فمن انتهت جلسته داخل اللوحة ثم فتح هذه الصفحة كان سيرى نموذج كلمة المرور بدل التحويل.
 * القراءة والشاشتان من `src/session` كما هي، دون تعديل فيه.
 */
export async function TwoFactorGate() {
  const session = await readSession();
  if (session.kind === 'anonymous') redirect('/login');
  if (session.kind === 'error') return <SessionUnavailable />;
  return <TwoFactorRoute />;
}
