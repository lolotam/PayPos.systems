import { staffSessionBinding } from '../../identity/index.ts';

/** رمز حقن جلسة المشغل؛ الاستدعاء يبقي الرمز داخل الهوية. */
export function operatorSessionsToken(): symbol {
  return staffSessionBinding();
}
