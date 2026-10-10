import { expect, it } from 'vitest';
import { ApiError } from '../../../shared/errors.ts';

const locked = {
  message_ar: 'التليفون ده متسجل لموظفة تانية. ابصمي من تليفونك أو بالكارت في الريسبشن.',
  message_en:
    'This phone is registered to another employee. Clock in from your own phone or with the card at reception.',
};
const elsewhere = {
  message_ar:
    'بصمتك متسجلة على تليفون تاني. ابصمي من تليفونك أو بالكارت في الريسبشن، ولو غيّرتي تليفونك اطلبي من المدير يفك الربط.',
  message_en:
    'Your passkey is registered on another phone. Clock in from that phone or with the card at reception. If you changed phones, ask your manager to unbind it.',
};

it.each([
  ['ATTENDANCE_DEVICE_LOCKED', 403, locked],
  ['ATTENDANCE_DEVICE_NOT_ENROLLED', 403, elsewhere],
  ['PASSKEY_DEVICE_TAKEN', 409, locked],
  ['PASSKEY_OTHER_DEVICE', 409, elsewhere],
] as const)('DL-15 maps %s to its exact bilingual recovery message', (code, status, messages) => {
  const error = new ApiError(code);
  expect(error.status).toBe(status);
  expect(error.toEnvelope()).toEqual({ code, ...messages });
});
