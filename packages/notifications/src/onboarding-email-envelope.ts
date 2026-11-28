import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

import { canonicalEmail } from './email-identity.ts';

/** بادئة اسم معامل المظروف؛ الأسماء المسموحة في العقد تطابق /^[a-z][a-z0-9_]{0,63}$/. */
export const ONBOARDING_EMAIL_PARAM_PREFIX = 'env_';
/** اسم معامل هوية العملية المرافِقة للمظروف؛ يطابق /^[a-z][a-z0-9_]{0,63}$/. */
export const ONBOARDING_EMAIL_OPERATION_PARAM = 'operation_id';
/** أقصى طول لمقطع المظروف الواحد؛ العقد بيسمح بـ 255 محرف لكل معامل. */
export const ONBOARDING_EMAIL_CHUNK_SIZE = 200;
/** أقصى عدد لمقاطع المظروف بعد خصم معامل `operation_id` من حد العشرين معاملاً في العقد. */
export const ONBOARDING_EMAIL_MAX_CHUNKS = 19;
/** النطاق البديل للعنصر الموقّع: نطاق لا يقبل بريداً حقيقياً. */
export const ONBOARDING_PLACEHOLDER_DOMAIN = 'redacted.invalid';

/** نسخة المظروف: بايت واحد يحدد الصيغة، وبعده التشفير. */
const ENVELOPE_VERSION = 0x01;
/** حجم متجه التهيئة: مقبول لكل AES-GCM. */
const IV_SIZE = 12;
/** حجم وسم المصادقة: 16 بايت. */
const TAG_SIZE = 16;
/** طول وسم العنصر الموقّع بالست عشري؛ 12 بايت من HMAC. */
const PLACEHOLDER_TAG_LENGTH = 24;
/** فاصل النطاق في اشتقاق العنصر الموقّع. */
const PLACEHOLDER_PREFIX = 'pospay:onboarding-email-placeholder:v1\0';
/** ملح اشتقاق مفتاح الختم؛ ثابت ومتعلق بنسخة الصيغة. */
const ENVELOPE_SALT = 'pospay:onboarding-email-envelope:v1';

/** حمولة إيميل الترحيب: إما رقم سري مؤقت للموظفة أو رابط دعوة للعضو. */
export type OnboardingEmailPayload =
  | {
      readonly kind: 'staff_welcome_pin';
      readonly email: string;
      readonly pin: string;
      readonly role: string;
      readonly recipient: 'manager' | 'employee';
      readonly targetMaskedEmail?: string | null;
      readonly employeeId?: string | undefined;
      readonly operationId?: string | undefined;
      readonly pinRevision?: string | undefined;
      readonly expiresAt: string;
      readonly expiresAtMs: number;
    }
  | {
      readonly kind: 'member_invitation';
      readonly email: string;
      readonly link: string;
      readonly role: string;
      readonly recipient: 'invitee' | 'owner';
      readonly targetMaskedEmail?: string | null;
      readonly invitationId?: string | undefined;
      readonly issuedAt?: string | undefined;
      readonly expiresAt: string;
      readonly expiresAtMs: number;
    };

/** البيانات المرتبطة بالتشفير: بتربط المظروف بالشركة والعملية والقالب والوجهة الموقّعة. */
export interface OnboardingEnvelopeAad {
  readonly companyId: string;
  readonly operationId: string;
  readonly templateKey: string;
  readonly templateRevision: number;
  readonly placeholderEmail: string;
}

/** معامل مسمّى في المظروف: الاسم والنص المشفّر. */
export interface OnboardingEnvelopeParameter {
  readonly name: string;
  readonly type: 'text';
  readonly value: string;
}

/**
 * يشتق مفتاح الختم من سر التشغيل؛ السر القصير أو اللي فيه سطر جديد ما بينتجش مفتاح.
 *
 * @param secret سر التشغيل المشترك بين الـ API والـ worker
 * @returns مفتاح 32 بايت، أو null لما السر غير صالح
 */
export function deriveOnboardingEnvelopeKey(secret: string): Buffer | null {
  if (!secret || secret.length < 32 || /[\r\n]/.test(secret)) return null;
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret, 'utf8'),
      Buffer.alloc(0),
      Buffer.from(ENVELOPE_SALT),
      32,
    ),
  );
}

/**
 * يقنّع البريد لعرضه في نص الرسالة: أول حرفين من الجزء المحلي وبقية نجمة، والنطاق زي ما هو.
 *
 * @param email البريد الخام
 * @returns البريد المقنّع للعرض
 */
export function maskOnboardingEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.slice(0, local.length <= 2 ? 1 : 2);
  return `${visible}***@${domain}`;
}

/**
 * يبني العنصر الموقّع للوجهة: بصمة مشتقة من البريد الحقيقي، من غير ما يظهر منه أي جزء.
 * نفس البريد بيطلع نفس العنصر، وبريد مختلف بيطلع عنصر مختلف.
 *
 * @param realEmail البريد الحقيقي
 * @param key مفتاح الختم
 * @returns العنصر الموقّع، أو null لما البريد غير صالح
 */
export function onboardingPlaceholderEmail(realEmail: string, key: Buffer): string | null {
  const canonical = canonicalEmail(realEmail);
  if (canonical === null) return null;
  const tag = createHmac('sha256', key)
    .update(PLACEHOLDER_PREFIX)
    .update(canonical)
    .digest('hex')
    .slice(0, PLACEHOLDER_TAG_LENGTH);
  return `sealed-${tag}@${ONBOARDING_PLACEHOLDER_DOMAIN}`;
}

/**
 * يبني نص البيانات المرتبطة: يربط المظروف بالشركة والعملية والقالب والوجهة الموقّعة.
 *
 * @param aad البيانات المرتبطة
 * @returns نص UTF-8 للتشفير
 */
function onboardingEnvelopeAad(aad: OnboardingEnvelopeAad): string {
  return [
    'pospay:onboarding-email:v1',
    aad.companyId,
    aad.operationId,
    aad.templateKey,
    String(aad.templateRevision),
    aad.placeholderEmail,
  ].join('|');
}

/**
 * يختم حمولة الترحيب في مظروف مشفّر، مقسّم معاملات مسمّاة تتبعت في الـ outbox.
 *
 * @param key مفتاح الختم
 * @param payload الحمولة
 * @param aad البيانات المرتبطة
 * @returns المعاملات المسمّاة، بالترتيب
 */
export function sealOnboardingEmailEnvelope(
  key: Buffer,
  payload: OnboardingEmailPayload,
  aad: OnboardingEnvelopeAad,
): OnboardingEnvelopeParameter[] {
  const canonical = canonicalEmail(payload.email);
  if (canonical === null) throw new Error('ONBOARDING_EMAIL_ENVELOPE_RECIPIENT_INVALID');
  if (aad.operationId.length === 0 || aad.operationId.length > 255)
    throw new Error('ONBOARDING_EMAIL_ENVELOPE_AAD_MISMATCH');
  if (onboardingPlaceholderEmail(canonical, key) !== aad.placeholderEmail)
    throw new Error('ONBOARDING_EMAIL_ENVELOPE_AAD_MISMATCH');
  const iv = randomBytes(IV_SIZE);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(onboardingEnvelopeAad(aad), 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ ...payload, email: canonical }), 'utf8'),
    cipher.final(),
  ]);
  const envelope = Buffer.concat([
    Buffer.from([ENVELOPE_VERSION]),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
  const chunks = chunkEnvelope(envelope.toString('base64url'));
  if (chunks.length > ONBOARDING_EMAIL_MAX_CHUNKS)
    throw new Error('ONBOARDING_EMAIL_ENVELOPE_TOO_LARGE');
  return [
    { name: ONBOARDING_EMAIL_OPERATION_PARAM, type: 'text', value: aad.operationId },
    ...chunks,
  ];
}

/**
 * يقسّم نص المظروف لقطع مسمّاة؛ كل قطعة بتبقى تحت حد العقد، والترتيب بيتحفظ.
 *
 * @param encoded نص المظروف بترميز base64url
 * @returns المعاملات المسمّاة
 */
function chunkEnvelope(encoded: string): OnboardingEnvelopeParameter[] {
  const parameters: OnboardingEnvelopeParameter[] = [];
  for (let index = 0; index * ONBOARDING_EMAIL_CHUNK_SIZE < encoded.length; index += 1) {
    parameters.push({
      name: `${ONBOARDING_EMAIL_PARAM_PREFIX}${index}`,
      type: 'text',
      value: encoded.slice(
        index * ONBOARDING_EMAIL_CHUNK_SIZE,
        (index + 1) * ONBOARDING_EMAIL_CHUNK_SIZE,
      ),
    });
  }
  return parameters;
}

/**
 * يستخرج معرّف العملية المرفق بمعاملات المظروف، أو null عند الغياب أو التكرار.
 *
 * @param parameters المعاملات المسمّاة
 * @returns معرّف العملية، أو null
 */
export function extractOnboardingOperationId(
  parameters: readonly {
    readonly name?: unknown;
    readonly type?: unknown;
    readonly value?: unknown;
  }[],
): string | null {
  let operationId: string | null = null;
  for (const parameter of parameters) {
    if (parameter.name !== ONBOARDING_EMAIL_OPERATION_PARAM) continue;
    if (parameter.type !== 'text' || typeof parameter.value !== 'string') return null;
    if (parameter.value.length === 0 || operationId !== null) return null;
    operationId = parameter.value;
  }
  return operationId;
}

/**
 * يجمّع القطع المسمّاة في نص واحد؛ أي قطعة ناقصة أو زائدة أو مكررة بترفض المظروف كله.
 *
 * @param parameters المعاملات المسمّاة
 * @returns نص المظروف، أو null لما الترتيب مش سليم
 */
function joinEnvelopeChunks(
  parameters: readonly {
    readonly name?: unknown;
    readonly type?: unknown;
    readonly value?: unknown;
  }[],
): string | null {
  const chunks = new Map<number, string>();
  let seenOperation = false;
  for (const parameter of parameters) {
    if (typeof parameter.name !== 'string' || parameter.type !== 'text') return null;
    if (typeof parameter.value !== 'string' || parameter.value.length === 0) return null;
    if (parameter.name === ONBOARDING_EMAIL_OPERATION_PARAM) {
      if (seenOperation) return null;
      seenOperation = true;
      continue;
    }
    if (!parameter.name.startsWith(ONBOARDING_EMAIL_PARAM_PREFIX)) return null;
    const index = parameter.name.slice(ONBOARDING_EMAIL_PARAM_PREFIX.length);
    if (!/^\d+$/.test(index)) return null;
    const position = Number(index);
    if (!Number.isSafeInteger(position) || chunks.has(position)) return null;
    chunks.set(position, parameter.value);
  }
  if (chunks.size === 0) return null;
  let encoded = '';
  for (let index = 0; index < chunks.size; index += 1) {
    const chunk = chunks.get(index);
    if (chunk === undefined) return null;
    encoded += chunk;
  }
  return encoded;
}

/**
 * يفك المظروف ويتحقق من الحمولة كلها: النوع، والبريد، والرقم أو الرابط، والعمر.
 *
 * @param key مفتاح الختم
 * @param parameters المعاملات المسمّاة
 * @param aad البيانات المرتبطة
 * @param now اللحظة الحالية
 * @param options خيارات فك التشفير (تعطيل فحص العمر مطلوب فقط لمطابقة الوجهة قبل الرفض)
 * @returns الحمولة، أو null عند أي تزوير أو انتهاء
 */
export function unsealOnboardingEmailEnvelope(
  key: Buffer,
  parameters: readonly {
    readonly name?: unknown;
    readonly type?: unknown;
    readonly value?: unknown;
  }[],
  aad: OnboardingEnvelopeAad,
  now: Date,
  options: { readonly checkExpiry?: boolean } = {},
): OnboardingEmailPayload | null {
  if (aad.operationId.length === 0) return null;
  const encoded = joinEnvelopeChunks(parameters);
  if (encoded === null) return null;
  let envelope: Buffer;
  try {
    envelope = Buffer.from(encoded, 'base64url');
  } catch {
    return null;
  }
  if (envelope.length <= 1 + IV_SIZE + TAG_SIZE) return null;
  if (envelope[0] !== ENVELOPE_VERSION) return null;
  const iv = envelope.subarray(1, 1 + IV_SIZE);
  const tag = envelope.subarray(1 + IV_SIZE, 1 + IV_SIZE + TAG_SIZE);
  const ciphertext = envelope.subarray(1 + IV_SIZE + TAG_SIZE);
  let plaintext: string;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(onboardingEnvelopeAad(aad), 'utf8'));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  return readOnboardingPayload(parsed, key, aad, now, options.checkExpiry !== false);
}

/** يتحقق من نص اختياري داخل الحمولة: undefined مقبول، وأي نوع تاني أو نص فاضي مرفوض. */
function optionalTextField(
  payload: Record<string, unknown>,
  key: string,
): { readonly ok: true; readonly value: string | undefined } | { readonly ok: false } {
  const raw = payload[key];
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false };
  return { ok: true, value: raw };
}

interface OnboardingBaseFields {
  readonly email: string;
  readonly role: string;
  readonly targetMaskedEmail: string | null;
  readonly expiresAt: string;
  readonly expiresAtMs: number;
}

/** يتحقق من حقول بريد الترحيب بالرقم السري المؤقت بعد التحقق من الأساسيات. */
function readStaffWelcomePayload(
  payload: Record<string, unknown>,
  base: OnboardingBaseFields,
): OnboardingEmailPayload | null {
  const recipient = payload['recipient'];
  if (recipient !== 'manager' && recipient !== 'employee') return null;
  const pin = payload['pin'];
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return null;
  const employeeId = optionalTextField(payload, 'employeeId');
  const operationId = optionalTextField(payload, 'operationId');
  const pinRevision = optionalTextField(payload, 'pinRevision');
  if (!employeeId.ok || !operationId.ok || !pinRevision.ok) return null;
  return {
    kind: 'staff_welcome_pin',
    ...base,
    pin,
    recipient,
    ...(employeeId.value === undefined ? {} : { employeeId: employeeId.value }),
    ...(operationId.value === undefined ? {} : { operationId: operationId.value }),
    ...(pinRevision.value === undefined ? {} : { pinRevision: pinRevision.value }),
  };
}

/** يتحقق من حقول بريد دعوة العضو بعد التحقق من الأساسيات. */
function readMemberInvitationPayload(
  payload: Record<string, unknown>,
  base: OnboardingBaseFields,
): OnboardingEmailPayload | null {
  const recipient = payload['recipient'];
  if (recipient !== 'invitee' && recipient !== 'owner') return null;
  const link = payload['link'];
  if (typeof link !== 'string' || !isSafeOnboardingLink(link)) return null;
  const invitationId = optionalTextField(payload, 'invitationId');
  const issuedAt = optionalTextField(payload, 'issuedAt');
  if (!invitationId.ok || !issuedAt.ok) return null;
  return {
    kind: 'member_invitation',
    ...base,
    link,
    recipient,
    ...(invitationId.value === undefined ? {} : { invitationId: invitationId.value }),
    ...(issuedAt.value === undefined ? {} : { issuedAt: issuedAt.value }),
  };
}

/**
 * يتحقق من شكل الحمولة بعد فك التشفير: كل حقل لازم يطابق القالب بتاعه.
 *
 * @param parsed الحمولة بعد فك التشفير
 * @param key مفتاح الختم
 * @param aad البيانات المرتبطة
 * @param now اللحظة الحالية
 * @param checkExpiry فحص انتهاء الصلاحية
 * @returns الحمولة الصالحة، أو null
 */
function readOnboardingPayload(
  parsed: unknown,
  key: Buffer,
  aad: OnboardingEnvelopeAad,
  now: Date,
  checkExpiry: boolean,
): OnboardingEmailPayload | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const payload = parsed as Record<string, unknown>;
  const kind = payload['kind'];
  if (kind !== 'staff_welcome_pin' && kind !== 'member_invitation') return null;
  const email = payload['email'];
  if (typeof email !== 'string' || canonicalEmail(email) !== email) return null;
  if (onboardingPlaceholderEmail(email, key) !== aad.placeholderEmail) return null;
  const role = payload['role'];
  if (typeof role !== 'string' || role.length === 0 || role.length > 64) return null;
  const targetMaskedEmail = payload['targetMaskedEmail'];
  if (
    targetMaskedEmail !== undefined &&
    targetMaskedEmail !== null &&
    typeof targetMaskedEmail !== 'string'
  )
    return null;
  const expiresAt = payload['expiresAt'];
  const expiresAtMs = payload['expiresAtMs'];
  if (typeof expiresAt !== 'string' || typeof expiresAtMs !== 'number') return null;
  if (!Number.isFinite(expiresAtMs) || (checkExpiry && now.getTime() > expiresAtMs)) return null;
  const base: OnboardingBaseFields = {
    email,
    role,
    targetMaskedEmail: targetMaskedEmail ?? null,
    expiresAt,
    expiresAtMs,
  };
  return kind === 'staff_welcome_pin'
    ? readStaffWelcomePayload(payload, base)
    : readMemberInvitationPayload(payload, base);
}

/** أقصى طول للرابط بالبايت: يضمن بقاء كل مظروف مع operation_id تحت حد 20 معاملاً بالعقد. */
const ONBOARDING_LINK_MAX_BYTES = 1600;

/**
 * يفحص رابط الدعوة: https فقط، مع السماح لـ localhost ونطاقات ‎.test الاختبارية في التطوير والاختبار، ومن غير بيانات دخول، وبحجم يضمن صلاحية المظروف.
 *
 * @param link الرابط الخام
 * @returns true لما الرابط سليم
 */
export function isSafeOnboardingLink(link: string): boolean {
  if (/[\p{Cc}\s"\\]/u.test(link) || Buffer.byteLength(link, 'utf8') > ONBOARDING_LINK_MAX_BYTES)
    return false;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  const safeProtocol =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' &&
      (url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname.endsWith('.test')));
  return safeProtocol && url.username === '' && url.password === '';
}
