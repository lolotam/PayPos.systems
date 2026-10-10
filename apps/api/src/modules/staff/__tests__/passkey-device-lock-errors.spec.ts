import { expect, it } from 'vitest';
import { ApiError } from '../../../shared/errors.ts';

const locked = {
  message_ar: 'هذا الهاتف مسجّل لموظف آخر. سجّل الحضور من هاتفك أو بالبطاقة عند الاستقبال.',
  message_en:
    'This phone is registered to another employee. Clock in from your own phone or with the card at reception.',
};
const elsewhere = {
  message_ar:
    'مفتاح المرور الخاص بك مسجّل على هاتف آخر. سجّل الحضور من ذلك الهاتف أو بالبطاقة عند الاستقبال، وإذا غيّرت هاتفك فاطلب من المدير فك الربط.',
  message_en:
    'Your passkey is registered on another phone. Clock in from that phone or with the card at reception. If you changed phones, ask your manager to unbind it.',
};
const enrolTaken = {
  message_ar:
    'هذا الهاتف مسجّل لموظف آخر، فلا يمكن تسجيل مفتاح مرورك عليه. سجّل من هاتفك، واستخدم البطاقة عند الاستقبال حتى ذلك الحين.',
  message_en:
    'This phone is registered to another employee, so your passkey cannot be enrolled on it. Enrol from your own phone; until then, use the card at reception.',
};
const enrolElsewhere = {
  message_ar:
    'لديك مفتاح مرور مسجّل على هاتف آخر. سجّل من ذلك الهاتف، أو اطلب من المدير فك الربط إذا غيّرت هاتفك.',
  message_en:
    'You already have a passkey on another phone. Enrol from that phone, or ask your manager to unbind it if you changed phones.',
};

it.each([
  ['ATTENDANCE_DEVICE_LOCKED', 403, locked],
  ['ATTENDANCE_DEVICE_NOT_ENROLLED', 403, elsewhere],
  ['PASSKEY_DEVICE_TAKEN', 409, enrolTaken],
  ['PASSKEY_OTHER_DEVICE', 409, enrolElsewhere],
] as const)('DL-15 maps %s to its exact bilingual recovery message', (code, status, messages) => {
  const error = new ApiError(code);
  expect(error.status).toBe(status);
  expect(error.toEnvelope()).toEqual({ code, ...messages });
});
