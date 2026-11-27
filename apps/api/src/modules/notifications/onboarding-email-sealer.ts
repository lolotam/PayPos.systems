import {
  deriveOnboardingEnvelopeKey,
  isSafeOnboardingLink,
  maskOnboardingEmail,
  MEMBER_INVITATION_KEY,
  MEMBER_INVITATION_REVISION,
  onboardingPlaceholderEmail,
  sealOnboardingEmailEnvelope,
  STAFF_WELCOME_PIN_KEY,
  STAFF_WELCOME_PIN_REVISION,
  type OnboardingEmailPayload,
} from '@pospay/notifications';

import type {
  MemberInvitationEnvelopePayload,
  OnboardingEmailSealer,
  OnboardingSealInput,
  OnboardingSealedEnvelope,
  StaffWelcomeEnvelopePayload,
} from '../../shared/ports/onboarding-email.port.ts';

/** حمولة بريد ترحيب موظفة بالشكل اللي بيفهمه package الإشعارات. */
function staffWelcomePayload(payload: StaffWelcomeEnvelopePayload): OnboardingEmailPayload {
  return {
    kind: 'staff_welcome_pin',
    email: payload.email,
    pin: payload.pin,
    role: payload.role,
    recipient: payload.recipient,
    targetMaskedEmail: payload.targetMaskedEmail,
    ...(payload.employeeId === undefined ? {} : { employeeId: payload.employeeId }),
    ...(payload.operationId === undefined ? {} : { operationId: payload.operationId }),
    expiresAt: payload.expiresAt,
    expiresAtMs: payload.expiresAtMs,
  };
}

/** حمولة بريد دعوة عضو بالشكل اللي بيفهمه package الإشعارات. */
function memberInvitationPayload(payload: MemberInvitationEnvelopePayload): OnboardingEmailPayload {
  return {
    kind: 'member_invitation',
    email: payload.email,
    link: payload.link,
    role: payload.role,
    recipient: payload.recipient,
    targetMaskedEmail: payload.targetMaskedEmail,
    ...(payload.invitationId === undefined ? {} : { invitationId: payload.invitationId }),
    ...(payload.issuedAt === undefined ? {} : { issuedAt: payload.issuedAt }),
    expiresAt: payload.expiresAt,
    expiresAtMs: payload.expiresAtMs,
  };
}

/**
 * يبني ختم إيميلات الترحيب من مفتاح التشغيل: من غير مفتاح صالح يرجّع undefined عشان المنتجين يتخطّوا قراءة المستلمين.
 *
 * @param onboardingEmailKey مفتاح التشغيل المشترك بين الـ API والـ worker
 * @returns الختم الجاهز للاستخدام، أو undefined لو المفتاح غير صالح أو ناقص
 */
export function createOnboardingEmailSealer(
  onboardingEmailKey: string | null | undefined,
): OnboardingEmailSealer | undefined {
  const key =
    onboardingEmailKey === null || onboardingEmailKey === undefined
      ? null
      : deriveOnboardingEnvelopeKey(onboardingEmailKey);
  if (key === null) return undefined;
  const seal = (
    input: OnboardingSealInput,
    payload: OnboardingEmailPayload,
    templateKey: string,
    templateRevision: number,
  ): OnboardingSealedEnvelope | null => {
    if (input.operationId.length === 0 || input.operationId.length > 255) return null;
    if (payload.kind === 'member_invitation' && !isSafeOnboardingLink(payload.link)) return null;
    const placeholderEmail = onboardingPlaceholderEmail(input.email, key);
    if (placeholderEmail === null) return null;
    return {
      template: { key: templateKey, revision: templateRevision },
      placeholderEmail,
      parameters: sealOnboardingEmailEnvelope(key, payload, {
        companyId: input.companyId,
        operationId: input.operationId,
        templateKey,
        templateRevision,
        placeholderEmail,
      }),
    };
  };
  return {
    mask: (email) => maskOnboardingEmail(email),
    sealStaffWelcomePin: (input) =>
      input.payload.kind !== 'staff_welcome_pin'
        ? null
        : seal(
            input,
            staffWelcomePayload(input.payload),
            STAFF_WELCOME_PIN_KEY,
            STAFF_WELCOME_PIN_REVISION,
          ),
    sealMemberInvitation: (input) =>
      input.payload.kind !== 'member_invitation'
        ? null
        : seal(
            input,
            memberInvitationPayload(input.payload),
            MEMBER_INVITATION_KEY,
            MEMBER_INVITATION_REVISION,
          ),
  };
}
