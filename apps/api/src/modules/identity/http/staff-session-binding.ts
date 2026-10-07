import { STAFF_SESSIONS } from './staff-otp.controller.ts';

/**
 * يعيد رمز حقن جلسات الوردية. المستدعي يستدعي الدالة ولا يمرر الرمز نفسه.
 *
 * @returns الرمز الذي تسجله الهوية
 */
export function staffSessionBinding(): symbol {
  return STAFF_SESSIONS;
}
