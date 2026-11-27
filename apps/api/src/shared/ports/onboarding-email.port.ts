/** معامل مسمّى في مظروف الإيميل المشفّر: الاسم والنص المشفّر. */
export interface OnboardingEnvelopeParameter {
  readonly name: string;
  readonly type: 'text';
  readonly value: string;
}

/** حمولة بريد ترحيب موظفة: الرقم المؤقت والدور والمتلقي والعمر. */
export interface StaffWelcomeEnvelopePayload {
  readonly kind: 'staff_welcome_pin';
  readonly email: string;
  readonly pin: string;
  readonly role: string;
  readonly recipient: 'manager' | 'employee';
  readonly targetMaskedEmail: string | null;
  readonly expiresAt: string;
  readonly expiresAtMs: number;
}

/** حمولة بريد دعوة عضو: الرابط والدور والمتلقي والعمر. */
export interface MemberInvitationEnvelopePayload {
  readonly kind: 'member_invitation';
  readonly email: string;
  readonly link: string;
  readonly role: string;
  readonly recipient: 'invitee' | 'owner';
  readonly targetMaskedEmail: string | null;
  readonly expiresAt: string;
  readonly expiresAtMs: number;
}

/** حمولة إيميل الترحيب: رقم سري مؤقت أو رابط دعوة. */
export type OnboardingEnvelopePayload =
  StaffWelcomeEnvelopePayload | MemberInvitationEnvelopePayload;

/** القالب اللي بيتبعت في طلب الإشعار: المفتاح والمراجعة. */
export interface OnboardingEmailTemplate {
  readonly key: string;
  readonly revision: number;
}

/** المظروف المختوم: القالب والوجهة الموقّعة والمعاملات المسمّاة. */
export interface OnboardingSealedEnvelope {
  readonly template: OnboardingEmailTemplate;
  readonly placeholderEmail: string;
  readonly parameters: readonly OnboardingEnvelopeParameter[];
}

/** مدخلات الختم: الشركة والوجهة والحمولة. */
export interface OnboardingSealInput {
  readonly companyId: string;
  readonly email: string;
  readonly payload: OnboardingEnvelopePayload;
}

/**
 * ختم إيميلات الترحيب: القناع والختم المشفّر.
 * البنية دي مربوطة في جذر التطبيق؛ الموديولات بتاخدها جاهزة وما بتعرفش المفتاح.
 */
export interface OnboardingEmailSealer {
  /** يقنّع البريد لعرضه في نص الرسالة. */
  readonly mask: (email: string) => string;
  /** يختم بريد ترحيب موظفة، أو null لما الختم مش متاح أو البريد غير صالح. */
  readonly sealStaffWelcomePin: (input: OnboardingSealInput) => OnboardingSealedEnvelope | null;
  /** يختم بريد دعوة عضو، أو null لما الختم مش متاح أو البريد غير صالح. */
  readonly sealMemberInvitation: (input: OnboardingSealInput) => OnboardingSealedEnvelope | null;
}
